import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getOptionalUserId, requireUserId } from '#/lib/auth.server'
import { getStripe } from '#/lib/stripe/client.server'
import { findOwnOrder, startOrderCheckout } from '#/lib/stripe/orders.server'
import { requestRefund, resolveTestDispute } from '#/lib/stripe/seller-actions.server'
import { digitalAssets, findDigitalAsset, launchPromotion } from './catalog'
import {
  getDownloadCheckoutResult,
  isSigningReady,
  issueDownloadLink,
  listDownloadOrders,
} from './downloads.server'

const MODULE = 'downloads' as const

export interface DigitalAssetOffer {
  id: string
  name: string
  description: string
  format: string
  /** The live Stripe price, or null if the seed hasn't run. */
  price: { unitAmount: number | null; currency: string } | null
}

/** Assets with their live Stripe prices, the launch code's state, and the user's library. */
export const getDownloadStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getDownloadStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()
    const stripe = getStripe()

    let catalogError: string | null = null
    let prices: Array<{ lookupKey: string | null; unitAmount: number | null; currency: string }> = []
    let promotionActive = false
    try {
      const [priceList, codes] = await Promise.all([
        stripe.prices.list({
          lookup_keys: digitalAssets.map((asset) => asset.lookupKey),
          active: true,
          limit: 10,
        }),
        stripe.promotionCodes.list({ code: launchPromotion.code, active: true, limit: 1 }),
      ])
      prices = priceList.data.map((price) => ({
        lookupKey: price.lookup_key,
        unitAmount: price.unit_amount,
        currency: price.currency,
      }))
      promotionActive = codes.data.length > 0
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load prices from Stripe.'
    }

    const assets: DigitalAssetOffer[] = digitalAssets.map((asset) => {
      const price = prices.find((candidate) => candidate.lookupKey === asset.lookupKey)
      return {
        id: asset.id,
        name: asset.name,
        description: asset.description,
        format: asset.format,
        price: price ? { unitAmount: price.unitAmount, currency: price.currency } : null,
      }
    })

    return {
      signedIn: Boolean(userId),
      assets,
      catalogError,
      signingReady: isSigningReady(),
      promotion: {
        code: launchPromotion.code,
        percentOff: launchPromotion.percentOff,
        active: promotionActive,
      },
      orders: userId ? await listDownloadOrders(userId) : [],
    }
  })
})

/** Just the library, for polling while a webhook is on its way. */
export const getDownloadOrders = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const userId = await getOptionalUserId()
  return userId ? listDownloadOrders(userId) : []
})

/**
 * One Checkout Session for the whole cart: a line item per asset.
 * The client sends asset IDs only; prices come from Stripe by lookup key.
 */
export const startDownloadCheckout = createServerFn({ method: 'POST' })
  .validator(z.object({ assetIds: z.array(z.string()).min(1).max(digitalAssets.length) }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startDownloadCheckout' }, async () => {
      const userId = await requireUserId()
      const assets = [...new Set(data.assetIds)].map((id) => {
        const asset = findDigitalAsset(id)
        if (!asset) {
          throw new Error('That product does not exist.')
        }
        return asset
      })

      const { data: prices } = await getStripe().prices.list({
        lookup_keys: assets.map((asset) => asset.lookupKey),
        active: true,
        limit: 10,
      })
      const lineItems = assets.map((asset) => {
        const price = prices.find((candidate) => candidate.lookup_key === asset.lookupKey)
        if (!price) {
          throw new Error(
            'These products are not in your sandbox yet. Run npm run stripe:seed downloads.',
          )
        }
        return { price: price.id, quantity: 1 }
      })

      const { url } = await startOrderCheckout({
        module: MODULE,
        clerkUserId: userId,
        successPath: '/stripe/downloads/success',
        cancelPath: '/stripe/downloads?canceled=1',
        params: {
          mode: 'payment',
          line_items: lineItems,
          // Overrides the Checkout Studio default: shows the "Add promotion code" link.
          allow_promotion_codes: true,
          payment_intent_data: { description: `Stripe Lab downloads (${assets.length} items)` },
        },
      })
      return { url }
    })
  })

/** What the success page polls until the webhook has created the downloads. */
export const getDownloadCheckout = createServerFn({ method: 'GET' })
  .validator(z.object({ sessionId: z.string().startsWith('cs_') }))
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await requireUserId()
    return getDownloadCheckoutResult(userId, data.sessionId)
  })

/**
 * A fresh signed link for one of your downloads. `short` makes it expire after
 * 5 seconds, so you can watch an expired link get refused.
 */
export const getDownloadLink = createServerFn({ method: 'POST' })
  .validator(z.object({ grantId: z.uuid(), short: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return issueDownloadLink(userId, data.grantId, data.short ? 5 : undefined)
  })

/** Demo seller action: refund all or part of a downloads order you own. */
export const refundDownloadOrder = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.uuid(), amount: z.number().int().positive().optional() }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'refundDownloadOrder' }, async () => {
      const userId = await requireUserId()
      await requestRefund(await findOwnOrder(userId, MODULE, data.orderId), data.amount)
      return { requested: true }
    })
  })

/** Demo seller action: win or lose a test dispute on a downloads order you own. */
export const resolveDownloadDispute = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.uuid(), outcome: z.enum(['won', 'lost']) }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'resolveDownloadDispute' }, async () => {
      const userId = await requireUserId()
      await resolveTestDispute(await findOwnOrder(userId, MODULE, data.orderId), data.outcome)
      return { submitted: true }
    })
  })
