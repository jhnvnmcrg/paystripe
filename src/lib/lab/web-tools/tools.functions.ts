import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/index'
import { payCheckoutSessions } from '#/db/pay-schema'
import { getOptionalUserId, requireUserId } from '#/lib/auth.server'
import { createPortalSession, listInvoices } from '#/lib/stripe/billing.server'
import { createLabCheckoutSession } from '#/lib/stripe/checkout.server'
import { getStripe } from '#/lib/stripe/client.server'
import { getOrCreateStripeCustomer } from '#/lib/stripe/customers.server'
import { accessFor, getCurrentSubscription, isLiveStatus } from '#/lib/stripe/subscriptions.server'
import type { ToolsPlanKey } from './catalog'
import { findToolsPlan, TOOLS_PORTAL_KEY, toolFeatures, toolsPlans, toolsPlanForLookupKey } from './catalog'
import {
  createApiKey,
  exportProjectsCsv,
  getApiKeyInfo,
  getEntitlements,
  removeBackground,
} from './tools.server'

const MODULE = 'web-tools' as const

export interface ToolsPlanOffer {
  key: ToolsPlanKey
  name: string
  description: string
  price: number | null
  /** Feature names as attached to the Product in Stripe (the catalog, if not seeded yet). */
  features: string[]
  featuresFromStripe: boolean
}

/** Each plan with its live price and the features Stripe says it includes. */
async function loadPlans(): Promise<ToolsPlanOffer[]> {
  const stripe = getStripe()
  const { data: prices } = await stripe.prices.list({
    lookup_keys: toolsPlans.map((plan) => plan.lookupKey),
    active: true,
    limit: 10,
  })

  return Promise.all(
    toolsPlans.map(async (plan) => {
      const price = prices.find((candidate) => candidate.lookup_key === plan.lookupKey)
      let features: string[] = []
      let featuresFromStripe = false
      if (price) {
        const { data } = await stripe.products.listFeatures(plan.productId, { limit: 20 })
        features = data.map((item) => item.entitlement_feature.name)
        featuresFromStripe = true
      }
      if (features.length === 0) {
        features = plan.features.map(
          (key) => toolFeatures.find((feature) => feature.lookupKey === key)?.name ?? key,
        )
      }
      return {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        price: price?.unit_amount ?? null,
        features,
        featuresFromStripe,
      }
    }),
  )
}

async function loadAccount(userId: string) {
  const [row, entitlements, apiKey] = await Promise.all([
    getCurrentSubscription(userId, MODULE),
    getEntitlements(userId),
    getApiKeyInfo(userId),
  ])
  const plan = row ? toolsPlanForLookupKey(row.priceLookupKey) : undefined
  return {
    subscription: row
      ? {
          planKey: plan?.key ?? null,
          planName: plan?.name ?? row.items[0]?.productName ?? 'Unknown plan',
          status: row.status,
          access: accessFor(row.status),
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          cancelAt: row.cancelAt?.toISOString() ?? null,
          currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
          trialEnd: row.trialEnd?.toISOString() ?? null,
        }
      : null,
    invoices: row ? await listInvoices(row.stripeCustomerId) : [],
    entitlements,
    apiKey,
  }
}

/** Everything the tools page needs. */
export const getToolsStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getToolsStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()
    let plans: ToolsPlanOffer[] = []
    let catalogError: string | null = null
    try {
      plans = await loadPlans()
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load plans from Stripe.'
    }
    const account = userId
      ? await loadAccount(userId)
      : { subscription: null, invoices: [], entitlements: [], apiKey: null }
    return { signedIn: Boolean(userId), plans, catalogError, ...account }
  })
})

/** The account part alone, for polling while webhooks arrive. */
export const getToolsAccount = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  return loadAccount(await requireUserId())
})

export const startToolsCheckout = createServerFn({ method: 'POST' })
  .validator(z.object({ plan: z.enum(['basic', 'pro']) }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startToolsCheckout' }, async () => {
      const userId = await requireUserId()
      const plan = findToolsPlan(data.plan)
      if (!plan) {
        throw new Error('That plan does not exist.')
      }
      const current = await getCurrentSubscription(userId, MODULE)
      if (current && isLiveStatus(current.status)) {
        throw new Error('You already have a plan. Change it from Manage billing.')
      }

      const {
        data: [price],
      } = await getStripe().prices.list({ lookup_keys: [plan.lookupKey], active: true, limit: 1 })
      if (!price) {
        throw new Error('The tools plans are not in your sandbox yet. Run npm run stripe:seed web-tools.')
      }

      const session = await createLabCheckoutSession({
        module: MODULE,
        clerkUserId: userId,
        successPath: '/stripe/web-tools/success',
        cancelPath: '/stripe/web-tools?canceled=1',
        params: {
          mode: 'subscription',
          line_items: [{ price: price.id, quantity: 1 }],
          subscription_data: { metadata: { lab_module: MODULE } },
        },
      })
      if (!session.url) {
        throw new Error('Stripe did not return a Checkout URL.')
      }
      return { url: session.url }
    })
  })

/** What the success page polls: are the plan's features unlocked yet? */
export const getToolsCheckout = createServerFn({ method: 'GET' })
  .validator(z.object({ sessionId: z.string().startsWith('cs_') }))
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await requireUserId()
    const route = await db.query.payCheckoutSessions.findFirst({
      where: and(
        eq(payCheckoutSessions.sessionId, data.sessionId),
        eq(payCheckoutSessions.clerkUserId, userId),
        eq(payCheckoutSessions.module, MODULE),
      ),
    })
    if (!route) {
      return { state: 'not-found' as const, entitlements: [] }
    }
    const entitlements = await getEntitlements(userId)
    return { state: entitlements.length > 0 ? ('ready' as const) : ('waiting' as const), entitlements }
  })

export const openToolsPortal = createServerFn({ method: 'POST' }).handler(async () => {
  const userId = await requireUserId()
  const url = await createPortalSession({
    customerId: await getOrCreateStripeCustomer(userId),
    configurationKey: TOOLS_PORTAL_KEY,
    returnPath: '/stripe/web-tools',
  })
  return { url }
})

/* The tools. Each one checks the entitlement on the server before doing anything. */

export const runBackgroundRemover = createServerFn({ method: 'POST' }).handler(async () => {
  return removeBackground(await requireUserId())
})

export const exportProjects = createServerFn({ method: 'POST' }).handler(async () => {
  return { csv: await exportProjectsCsv(await requireUserId()) }
})

export const createToolsApiKey = createServerFn({ method: 'POST' }).handler(async () => {
  return { key: await createApiKey(await requireUserId()) }
})
