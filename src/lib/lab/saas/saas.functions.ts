import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/index'
import { payCheckoutSessions, paySubscriptions } from '#/db/pay-schema'
import { getOptionalUserId, getUserEmail, requireUserId } from '#/lib/auth.server'
import { createLabCheckoutSession } from '#/lib/stripe/checkout.server'
import { getStripe } from '#/lib/stripe/client.server'
import { getCurrentSubscription, isLiveStatus } from '#/lib/stripe/subscriptions.server'
import { findSaasPlan, lookupKeyFor, saasPlans } from './catalog'
import {
  advanceTimeTravel,
  createPortalLink,
  endTimeTravel,
  findPlanPrice,
  getRealSubscription,
  getTimeTravel,
  retryTimeTravelInvoice,
  setTimeTravelCard,
  startTimeTravel,
  toSubscriptionView,
} from './saas.server'

const MODULE = 'saas' as const

const planInput = z.object({
  plan: z.enum(['starter', 'pro', 'team']),
  interval: z.enum(['month', 'year']),
  seats: z.number().int().min(1).max(50),
})

/** Live prices by plan and interval, so the pricing table shows what Stripe will charge. */
async function loadPrices() {
  const lookupKeys = saasPlans.flatMap((plan) => [
    lookupKeyFor(plan.key, 'month'),
    lookupKeyFor(plan.key, 'year'),
  ])
  const { data } = await getStripe().prices.list({ lookup_keys: lookupKeys, active: true, limit: 20 })
  const prices: Record<string, number | null> = {}
  for (const price of data) {
    if (price.lookup_key) {
      prices[price.lookup_key] = price.unit_amount
    }
  }
  return prices
}

/** Everything the SaaS page needs. */
export const getSaasStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getSaasStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()

    let prices: Record<string, number | null> = {}
    let catalogError: string | null = null
    try {
      prices = await loadPrices()
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load prices from Stripe.'
    }

    const account = userId ? await getRealSubscription(userId) : { subscription: null, invoices: [] }
    return {
      signedIn: Boolean(userId),
      prices,
      catalogError,
      ...account,
      timeTravel: userId ? await getTimeTravel(userId) : null,
    }
  })
})

/** The subscription, invoices and time-travel state, for polling while webhooks arrive. */
export const getSaasAccount = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const userId = await requireUserId()
  return { ...(await getRealSubscription(userId)), timeTravel: await getTimeTravel(userId) }
})

/**
 * Opens Checkout in subscription mode. Pro gets a 14-day trial. A customer who
 * already subscribes is sent to the Customer Portal instead, where plan changes belong.
 */
export const startSaasCheckout = createServerFn({ method: 'POST' })
  .validator(planInput)
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startSaasCheckout' }, async () => {
      const userId = await requireUserId()
      const plan = findSaasPlan(data.plan)
      if (!plan) {
        throw new Error('That plan does not exist.')
      }

      const current = await getCurrentSubscription(userId, MODULE)
      if (current && isLiveStatus(current.status)) {
        throw new Error('You already have a plan. Change it from Manage billing.')
      }

      const price = await findPlanPrice(data.plan, data.interval)
      const seats = plan.perSeat
        ? Math.min(Math.max(data.seats, plan.minSeats ?? 1), plan.maxSeats ?? 50)
        : 1

      const session = await createLabCheckoutSession({
        module: MODULE,
        clerkUserId: userId,
        successPath: '/stripe/saas/success',
        cancelPath: '/stripe/saas?canceled=1',
        params: {
          mode: 'subscription',
          line_items: [
            {
              price: price.id,
              quantity: seats,
              // Team buyers can still change the seat count on Stripe's page.
              adjustable_quantity: plan.perSeat
                ? { enabled: true, minimum: plan.minSeats, maximum: plan.maxSeats }
                : undefined,
            },
          ],
          subscription_data: {
            trial_period_days: plan.trialDays,
            metadata: { lab_module: MODULE },
          },
        },
      })
      if (!session.url) {
        throw new Error('Stripe did not return a Checkout URL.')
      }
      return { url: session.url }
    })
  })

/**
 * What the success page polls: has the webhook stored the subscription yet?
 * The session is fetched from Stripe to learn which subscription it created.
 */
export const getSaasCheckout = createServerFn({ method: 'GET' })
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
      ? { state: 'ready' as const, subscription: toSubscriptionView(row) }
      : { state: 'waiting' as const, subscription: null }
  })

/** A link to Stripe's Customer Portal for your real subscription or the time-travel customer. */
export const openSaasPortal = createServerFn({ method: 'POST' })
  .validator(z.object({ target: z.enum(['real', 'time-travel']) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return { url: await createPortalLink(userId, data.target) }
  })

export const startSaasTimeTravel = createServerFn({ method: 'POST' })
  .validator(planInput.extend({ trial: z.boolean() }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startSaasTimeTravel' }, async () => {
      const userId = await requireUserId()
      await startTimeTravel(userId, { ...data, email: await getUserEmail(userId) })
      return { started: true }
    })
  })

export const advanceSaasTimeTravel = createServerFn({ method: 'POST' })
  .validator(z.object({ by: z.enum(['week', 'month']) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await advanceTimeTravel(userId, data.by)
    return { advancing: true }
  })

export const setSaasTimeTravelCard = createServerFn({ method: 'POST' })
  .validator(z.object({ card: z.enum(['failing', 'working']) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await setTimeTravelCard(userId, data.card)
    return { card: data.card }
  })

export const retrySaasTimeTravelInvoice = createServerFn({ method: 'POST' }).handler(async () => {
  const userId = await requireUserId()
  await retryTimeTravelInvoice(userId)
  return { retried: true }
})

export const endSaasTimeTravel = createServerFn({ method: 'POST' }).handler(async () => {
  const userId = await requireUserId()
  await endTimeTravel(userId)
  return { ended: true }
})
