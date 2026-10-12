import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { db } from '#/db/index'
import { getOptionalUserId, requireUserId } from '#/lib/auth.server'
import { getStripe } from '#/lib/stripe/client.server'
import { findOwnOrder, startOrderCheckout } from '#/lib/stripe/orders.server'
import { requestRefund, resolveTestDispute } from '#/lib/stripe/seller-actions.server'
import {
  carriers,
  findShopSku,
  HOLD_MINUTES,
  MAX_PER_LINE,
  shippingCountries,
  shopShippingRates,
  shopSkus,
  skuLabel,
} from './catalog'
import {
  findShippingRateIds,
  getShopCheckoutResult,
  holdStock,
  listInventory,
  listShopOrders,
  markShipped,
  releaseHeldStock,
  resetStock,
  restockSoldStock,
} from './shop.server'

const MODULE = 'shop' as const

export interface ShopProductOffer {
  sku: string
  name: string
  variant: string | null
  description: string
  price: { unitAmount: number | null; currency: string } | null
}

/** Products with live Stripe prices, current stock, shipping options and the user's orders. */
export const getShopStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getShopStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()

    let catalogError: string | null = null
    let prices: Array<{ lookupKey: string | null; unitAmount: number | null; currency: string }> = []
    try {
      const list = await getStripe().prices.list({
        lookup_keys: shopSkus.map((item) => item.lookupKey),
        active: true,
        limit: 20,
      })
      prices = list.data.map((price) => ({
        lookupKey: price.lookup_key,
        unitAmount: price.unit_amount,
        currency: price.currency,
      }))
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load prices from Stripe.'
    }

    const products: ShopProductOffer[] = shopSkus.map((item) => {
      const price = prices.find((candidate) => candidate.lookupKey === item.lookupKey)
      return {
        sku: item.sku,
        name: item.name,
        variant: item.variant ?? null,
        description: item.description,
        price: price ? { unitAmount: price.unitAmount, currency: price.currency } : null,
      }
    })

    return {
      signedIn: Boolean(userId),
      products,
      catalogError,
      inventory: await listInventory(),
      shippingRates: shopShippingRates,
      holdMinutes: HOLD_MINUTES,
      maxPerLine: MAX_PER_LINE,
      orders: userId ? await listShopOrders(userId) : [],
    }
  })
})

/** Stock levels, for refreshing after checkouts and seller actions. */
export const getShopInventory = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  return listInventory()
})

/** Just the orders, for polling while a webhook is on its way. */
export const getShopOrders = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const userId = await getOptionalUserId()
  return userId ? listShopOrders(userId) : []
})

/**
 * Holds stock for the cart, then opens a Checkout Session that collects a
 * shipping address and phone number and offers the seeded shipping rates.
 * The session expires when the hold does, so unpaid stock always comes back.
 */
export const startShopCheckout = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      items: z
        .array(z.object({ sku: z.string(), quantity: z.number().int().min(1).max(MAX_PER_LINE) }))
        .min(1)
        .max(shopSkus.length),
    }),
  )
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startShopCheckout' }, async () => {
      const userId = await requireUserId()

      // Merge repeated SKUs, then resolve each to its catalog entry (unknown SKUs are refused).
      const quantities = new Map<string, number>()
      for (const line of data.items) {
        quantities.set(line.sku, (quantities.get(line.sku) ?? 0) + line.quantity)
      }
      const lines = [...quantities].map(([sku, quantity]) => {
        const item = findShopSku(sku)
        if (!item) {
          throw new Error('That product does not exist.')
        }
        if (quantity > MAX_PER_LINE) {
          throw new Error(`You can buy at most ${MAX_PER_LINE} of each item.`)
        }
        return { sku, quantity, item }
      })

      const stripe = getStripe()
      const [{ data: prices }, shippingRateIds] = await Promise.all([
        stripe.prices.list({
          lookup_keys: lines.map((line) => line.item.lookupKey),
          active: true,
          limit: 20,
        }),
        findShippingRateIds(),
      ])
      const lineItems = lines.map((line) => {
        const price = prices.find((candidate) => candidate.lookup_key === line.item.lookupKey)
        if (!price) {
          throw new Error('These products are not in your sandbox yet. Run npm run stripe:seed shop.')
        }
        return { price: price.id, quantity: line.quantity }
      })

      // One expiry for both the stock hold and the Checkout Session.
      const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000)

      const { url } = await startOrderCheckout({
        module: MODULE,
        clerkUserId: userId,
        successPath: '/stripe/shop/success',
        cancelPath: '/stripe/shop?canceled=1',
        reserve: (tx, orderId) => holdStock(tx, orderId, lines, expiresAt),
        release: async (orderId) => {
          await db.transaction((tx) => releaseHeldStock(tx, orderId))
        },
        params: {
          mode: 'payment',
          line_items: lineItems,
          shipping_address_collection: { allowed_countries: [...shippingCountries] },
          shipping_options: shippingRateIds.map((id) => ({ shipping_rate: id })),
          // Overrides the Checkout Studio default: couriers need a phone number.
          phone_number_collection: { enabled: true },
          expires_at: Math.floor(expiresAt.getTime() / 1000),
          payment_intent_data: {
            description: `Stripe Lab shop: ${lines.map((line) => `${line.quantity} x ${skuLabel(line.item)}`).join(', ')}`,
          },
        },
      })
      return { url }
    })
  })

/** What the success page polls until the webhook has confirmed the order. */
export const getShopCheckout = createServerFn({ method: 'GET' })
  .validator(z.object({ sessionId: z.string().startsWith('cs_') }))
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await requireUserId()
    return getShopCheckoutResult(userId, data.sessionId)
  })

/** Seller action: ends an open checkout now, instead of waiting for it to expire. */
export const expireShopCheckout = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const order = await findOwnOrder(userId, MODULE, data.orderId)
    if (order.status !== 'pending' || !order.checkoutSessionId) {
      throw new Error('Only an open checkout can be expired.')
    }
    // The checkout.session.expired webhook closes the order and releases the stock.
    await getStripe().checkout.sessions.expire(order.checkoutSessionId)
    return { expired: true }
  })

/** Seller action: hand the order to a carrier. */
export const markShopOrderShipped = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      orderId: z.uuid(),
      carrier: z.enum(carriers),
      trackingNumber: z.string().trim().min(4).max(40),
    }),
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await markShipped(userId, data.orderId, data.carrier, data.trackingNumber)
    return { shipped: true }
  })

/** Seller action: after a refund, put the sold units back on the shelf. */
export const restockShopOrder = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const order = await findOwnOrder(userId, MODULE, data.orderId)
    if (!['refunded', 'partially_refunded', 'dispute_lost'].includes(order.status)) {
      throw new Error('Restock after a refund. This order still counts as sold.')
    }
    const restocked = await db.transaction((tx) => restockSoldStock(tx, order.id))
    return { restocked }
  })

/** Seller action: put every SKU back to its starting stock, for running the demo again. */
export const resetShopStock = createServerFn({ method: 'POST' }).handler(async () => {
  await requireUserId()
  await resetStock()
  return listInventory()
})

/** Demo seller action: refund all or part of a shop order you own. */
export const refundShopOrder = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.uuid(), amount: z.number().int().positive().optional() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await requestRefund(await findOwnOrder(userId, MODULE, data.orderId), data.amount)
    return { requested: true }
  })

/** Demo seller action: win or lose a test dispute on a shop order you own. */
export const resolveShopDispute = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.uuid(), outcome: z.enum(['won', 'lost']) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await resolveTestDispute(await findOwnOrder(userId, MODULE, data.orderId), data.outcome)
    return { submitted: true }
  })
