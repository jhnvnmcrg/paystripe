import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/index'
import { payCheckoutSessions, paySubscriptions } from '#/db/pay-schema'
import { getOptionalUserId, getUserEmail, requireUserId } from '#/lib/auth.server'
import { listInvoices } from '#/lib/stripe/billing.server'
import { createLabCheckoutSession } from '#/lib/stripe/checkout.server'
import { getStripe } from '#/lib/stripe/client.server'
import { accessFor, getCurrentSubscription, isLiveStatus } from '#/lib/stripe/subscriptions.server'
import { usageMeters } from './catalog'
import {
  advanceUsageTimeTravel,
  createUsagePortalLink,
  endUsageTimeTravel,
  getUsageTimeTravel,
  listAlerts,
  listRecentUsage,
  loadUsagePrices,
  readMeters,
  recordUsage,
  removeUsageAlert,
  retryUsageEvent,
  sendTimeTravelUsage,
  setCancelAtPeriodEnd,
  setUsageAlert,
  startUsageTimeTravel,
  toUsageSubscriptionView,
  usageLineItems,
} from './usage.server'

const MODULE = 'usage' as const

const usageInput = z.object({
  meter: z.enum(['requests', 'images']),
  value: z.number().int().min(1).max(10_000),
})

async function loadAccount(userId: string) {
  const row = await getCurrentSubscription(userId, MODULE)
  return {
    subscription: row ? toUsageSubscriptionView(row) : null,
    recent: await listRecentUsage(userId, null),
    alerts: await listAlerts(userId),
    invoices: row ? await listInvoices(row.stripeCustomerId) : [],
  }
}

export const getUsageStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getUsageStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()
    let seeded = false
    let catalogError: string | null = null
    try {
      const prices = await loadUsagePrices()
      seeded = usageMeters.every((meter) => prices[meter.lookupKey])
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load prices from Stripe.'
    }
    return {
      signedIn: Boolean(userId),
      seeded,
      catalogError,
      ...(userId
        ? { ...(await loadAccount(userId)), timeTravel: await getUsageTimeTravel(userId) }
        : { subscription: null, recent: [], alerts: [], invoices: [], timeTravel: null }),
    }
  })
})

/** Local records only (fast), for polling after each action. */
export const getUsageAccount = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  return loadAccount(await requireUserId())
})

/** Stripe's side: meter summaries and the invoice preview. Slower, so fetched on its own. */
export const getUsageMeters = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const row = await getCurrentSubscription(await requireUserId(), MODULE)
  if (!row || accessFor(row.status) === 'none') {
    return null
  }
  return readMeters(row)
})

export const getUsageTimeTravelState = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  return getUsageTimeTravel(await requireUserId())
})

/** Subscribes with only metered prices: nothing is due today. */
export const startUsageCheckout = createServerFn({ method: 'POST' }).handler(async () => {
  return Sentry.startSpan({ name: 'startUsageCheckout' }, async () => {
    const userId = await requireUserId()
    const current = await getCurrentSubscription(userId, MODULE)
    if (current && isLiveStatus(current.status)) {
      throw new Error('You already have API access.')
    }
    const session = await createLabCheckoutSession({
      module: MODULE,
      clerkUserId: userId,
      successPath: '/stripe/usage/success',
      cancelPath: '/stripe/usage?canceled=1',
      params: {
        mode: 'subscription',
        line_items: await usageLineItems(),
        subscription_data: { metadata: { lab_module: MODULE } },
      },
    })
    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL.')
    }
    return { url: session.url }
  })
})

export const getUsageCheckout = createServerFn({ method: 'GET' })
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
      return { state: 'not-found' as const, subscription: null }
    }
    const session = await getStripe().checkout.sessions.retrieve(data.sessionId)
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
    const row = subscriptionId
      ? await db.query.paySubscriptions.findFirst({ where: eq(paySubscriptions.id, subscriptionId) })
      : undefined
    return row
      ? { state: 'ready' as const, subscription: toUsageSubscriptionView(row) }
      : { state: 'waiting' as const, subscription: null }
  })

/** The toy API: serve the "requests", then count them against the customer. */
export const sendUsage = createServerFn({ method: 'POST' })
  .validator(usageInput)
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'sendUsage' }, async () => {
      await recordUsage(await requireUserId(), data.meter, data.value)
      return { recorded: true }
    })
  })

export const retryUsage = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await retryUsageEvent(await requireUserId(), data.id)
    return { recorded: true }
  })

export const saveUsageAlert = createServerFn({ method: 'POST' })
  .validator(z.object({ meter: z.enum(['requests', 'images']), threshold: z.number().int().min(1).max(1_000_000) }))
  .handler(async ({ data }) => {
    await setUsageAlert(await requireUserId(), data.meter, data.threshold)
    return { saved: true }
  })

export const deleteUsageAlert = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().startsWith('alrt_') }))
  .handler(async ({ data }) => {
    await removeUsageAlert(await requireUserId(), data.id)
    return { removed: true }
  })

export const setUsageCancel = createServerFn({ method: 'POST' })
  .validator(z.object({ cancel: z.boolean() }))
  .handler(async ({ data }) => {
    await setCancelAtPeriodEnd(await requireUserId(), data.cancel)
    return { cancel: data.cancel }
  })

export const openUsagePortal = createServerFn({ method: 'POST' }).handler(async () => {
  return { url: await createUsagePortalLink(await requireUserId()) }
})

export const startUsageTimeTravelRun = createServerFn({ method: 'POST' }).handler(async () => {
  return Sentry.startSpan({ name: 'startUsageTimeTravel' }, async () => {
    const userId = await requireUserId()
    await startUsageTimeTravel(userId, await getUserEmail(userId))
    return { started: true }
  })
})

export const sendUsageTimeTravel = createServerFn({ method: 'POST' })
  .validator(usageInput)
  .handler(async ({ data }) => {
    await sendTimeTravelUsage(await requireUserId(), data.meter, data.value)
    return { recorded: true }
  })

export const advanceUsageTimeTravelRun = createServerFn({ method: 'POST' }).handler(async () => {
  await advanceUsageTimeTravel(await requireUserId())
  return { advancing: true }
})

export const endUsageTimeTravelRun = createServerFn({ method: 'POST' }).handler(async () => {
  await endUsageTimeTravel(await requireUserId())
  return { ended: true }
})
