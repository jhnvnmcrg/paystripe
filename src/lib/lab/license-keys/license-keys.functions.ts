import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getOptionalUserId, requireUserId } from '#/lib/auth.server'
import { getStripe } from '#/lib/stripe/client.server'
import { startOrderCheckout } from '#/lib/stripe/orders.server'
import { findLicenseProduct, licenseProducts } from './catalog'
import {
  clearActivations,
  findOwnLicenseOrder,
  getLicenseCheckoutResult,
  listLicenseOrders,
} from './licenses.server'

const MODULE = 'license-keys'

export interface LicenseProductOffer {
  lookupKey: string
  name: string
  description: string
  perks: string[]
  maxActivations: number
  /** The live Stripe price, or null if the seed hasn't run. */
  price: { unitAmount: number | null; currency: string } | null
}

/** Products with their live Stripe prices, plus the signed-in user's orders. */
export const getLicenseStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getLicenseStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()

    let catalogError: string | null = null
    let prices: Array<{ lookupKey: string | null; unitAmount: number | null; currency: string }> = []
    try {
      const list = await getStripe().prices.list({
        lookup_keys: licenseProducts.map((product) => product.lookupKey),
        active: true,
        limit: 10,
      })
      prices = list.data.map((price) => ({
        lookupKey: price.lookup_key,
        unitAmount: price.unit_amount,
        currency: price.currency,
      }))
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load prices from Stripe.'
    }

    const products: LicenseProductOffer[] = licenseProducts.map((product) => {
      const price = prices.find((candidate) => candidate.lookupKey === product.lookupKey)
      return {
        lookupKey: product.lookupKey,
        name: product.name,
        description: product.description,
        perks: product.perks,
        maxActivations: product.maxActivations,
        price: price ? { unitAmount: price.unitAmount, currency: price.currency } : null,
      }
    })

    return {
      signedIn: Boolean(userId),
      products,
      catalogError,
      orders: userId ? await listLicenseOrders(userId) : [],
    }
  })
})

/** Just the orders, for polling while a refund or dispute webhook is on its way. */
export const getLicenseOrders = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const userId = await getOptionalUserId()
  return userId ? listLicenseOrders(userId) : []
})

/**
 * Creates a pending order and a Checkout Session for one license.
 * The client sends a lookup key, never a price ID or amount: the server decides what's charged.
 */
export const startLicenseCheckout = createServerFn({ method: 'POST' })
  .validator(z.object({ lookupKey: z.string().min(1) }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startLicenseCheckout' }, async () => {
      const userId = await requireUserId()
      const product = findLicenseProduct(data.lookupKey)
      if (!product) {
        throw new Error('That product does not exist.')
      }

      const {
        data: [price],
      } = await getStripe().prices.list({
        lookup_keys: [product.lookupKey],
        active: true,
        limit: 1,
      })
      if (!price) {
        throw new Error(
          'This product is not in your sandbox yet. Run npm run stripe:seed license-keys.',
        )
      }

      const { url } = await startOrderCheckout({
        module: MODULE,
        clerkUserId: userId,
        successPath: '/stripe/license-keys/success',
        cancelPath: '/stripe/license-keys?canceled=1',
        params: {
          mode: 'payment',
          line_items: [{ price: price.id, quantity: 1 }],
          payment_intent_data: { description: `Stripe Lab license: ${product.name}` },
        },
      })
      return { url }
    })
  })

/** What the success page polls until the webhook has issued the key. */
export const getLicenseCheckout = createServerFn({ method: 'GET' })
  .validator(z.object({ sessionId: z.string().startsWith('cs_') }))
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await requireUserId()
    return getLicenseCheckoutResult(userId, data.sessionId)
  })

/**
 * Demo admin: refunds an order you own, in full or in part.
 * Only asks Stripe for the refund. The `charge.refunded` webhook updates the order and the keys.
 */
export const refundLicenseOrder = createServerFn({ method: 'POST' })
  .validator(
    z.object({ orderId: z.uuid(), amount: z.number().int().positive().optional() }),
  )
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'refundLicenseOrder' }, async () => {
      const userId = await requireUserId()
      const order = await findOwnLicenseOrder(userId, data.orderId)
      if (!order.paymentIntentId || !['paid', 'partially_refunded'].includes(order.status)) {
        throw new Error('Only paid orders can be refunded.')
      }
      const remaining = (order.amountTotal ?? 0) - order.amountRefunded
      if (data.amount !== undefined && data.amount > remaining) {
        throw new Error('That is more than is left to refund.')
      }

      // Keyed to the order's refund state, so a double-click can't refund twice.
      await getStripe().refunds.create(
        {
          payment_intent: order.paymentIntentId,
          amount: data.amount,
          metadata: { lab_module: MODULE, order_id: order.id },
        },
        { idempotencyKey: `refund:${order.id}:${order.amountRefunded}:${data.amount ?? 'rest'}` },
      )
      return { requested: true }
    })
  })

/**
 * Demo admin: answers a test dispute. In a sandbox, the evidence text
 * `winning_evidence` or `losing_evidence` decides the outcome.
 * The `charge.dispute.closed` webhook then reinstates or revokes the keys.
 */
export const resolveLicenseDispute = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.uuid(), outcome: z.enum(['won', 'lost']) }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'resolveLicenseDispute' }, async () => {
      const userId = await requireUserId()
      const order = await findOwnLicenseOrder(userId, data.orderId)
      if (order.status !== 'disputed' || !order.paymentIntentId) {
        throw new Error('This order has no open dispute.')
      }

      const stripe = getStripe()
      const {
        data: [dispute],
      } = await stripe.disputes.list({ payment_intent: order.paymentIntentId, limit: 1 })
      if (!dispute) {
        throw new Error('Stripe has not opened the dispute yet. Try again in a few seconds.')
      }

      await stripe.disputes.update(dispute.id, {
        evidence: {
          uncategorized_text: data.outcome === 'won' ? 'winning_evidence' : 'losing_evidence',
        },
        submit: true,
      })
      return { submitted: true }
    })
  })

/** Frees every device slot on one of your keys. */
export const clearLicenseDevices = createServerFn({ method: 'POST' })
  .validator(z.object({ licenseId: z.uuid() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await clearActivations(userId, data.licenseId)
    return { cleared: true }
  })
