import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/index'
import { payCheckoutSessions, payContributions, payOrders, paySubscriptions } from '#/db/pay-schema'
import { getOptionalUserId, requireUserId } from '#/lib/auth.server'
import { listInvoices } from '#/lib/stripe/billing.server'
import { createLabCheckoutSession } from '#/lib/stripe/checkout.server'
import { getStripe } from '#/lib/stripe/client.server'
import { findOwnOrder, startOrderCheckout } from '#/lib/stripe/orders.server'
import { requestRefund, resolveTestDispute } from '#/lib/stripe/seller-actions.server'
import { getCurrentSubscription, isLiveStatus } from '#/lib/stripe/subscriptions.server'
import { customSupport, tierLookupKey, tiers, tipJar } from './catalog'
import {
  changeCustomAmount,
  createMembershipPortalLink,
  customSupportPriceData,
  findTierPrice,
  findTipPrice,
  getFeed,
  getMemberSummary,
  getSupporterWall,
  loadPrices,
  setCancelAtPeriodEnd,
  setWallName,
  toMembershipView,
} from './membership.server'

const MODULE = 'membership' as const
const SUCCESS_PATH = '/stripe/membership/success'

const dollars = z.number().int().min(customSupport.minimumDollars).max(customSupport.maximumDollars)

async function loadAccount(userId: string) {
  const row = await getCurrentSubscription(userId, MODULE)
  return {
    membership: row ? toMembershipView(row) : null,
    invoices: row ? await listInvoices(row.stripeCustomerId) : [],
    summary: await getMemberSummary(userId),
  }
}

/** How much of the feed the viewer's level opens. */
async function feedAccess(userId: string | null) {
  const { posts } = await getFeed(userId)
  return { unlocked: posts.filter((post) => post.body !== null).length, total: posts.length }
}

/** One live membership at a time: tier changes go through Manage billing instead. */
async function requireNotMember(userId: string) {
  const current = await getCurrentSubscription(userId, MODULE)
  if (current && isLiveStatus(current.status)) {
    throw new Error("You're already a member. Change it from your membership below.")
  }
}

export const getMembershipStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getMembershipStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()
    let prices: Record<string, number | null> = {}
    let catalogError: string | null = null
    try {
      prices = await loadPrices()
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load prices from Stripe.'
    }
    const tierKeys = tiers.flatMap((tier) => [tierLookupKey(tier.key, 'month'), tierLookupKey(tier.key, 'year')])
    return {
      signedIn: Boolean(userId),
      prices,
      catalogError,
      seeded: [...tierKeys, tipJar.lookupKey].every((key) => key in prices),
      wall: await getSupporterWall(userId),
      feed: await feedAccess(userId),
      ...(userId ? await loadAccount(userId) : { membership: null, invoices: [], summary: null }),
    }
  })
})

/** The membership, contributions, wall and feed access, for polling while webhooks arrive. */
export const getMembershipAccount = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const userId = await requireUserId()
  return {
    ...(await loadAccount(userId)),
    wall: await getSupporterWall(userId),
    feed: await feedAccess(userId),
  }
})

/** Join a tier: an ordinary subscription Checkout with a Price made by the seed. */
export const startMembershipCheckout = createServerFn({ method: 'POST' })
  .validator(z.object({ tier: z.enum(['supporter', 'insider', 'patron']), interval: z.enum(['month', 'year']) }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startMembershipCheckout' }, async () => {
      const userId = await requireUserId()
      await requireNotMember(userId)
      const price = await findTierPrice(data.tier, data.interval)
      const session = await createLabCheckoutSession({
        module: MODULE,
        clerkUserId: userId,
        successPath: SUCCESS_PATH,
        cancelPath: '/stripe/membership?canceled=1',
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

/** Pay what you want, monthly: the amount goes in as `price_data`, so no Price exists beforehand. */
export const startCustomSupportCheckout = createServerFn({ method: 'POST' })
  .validator(z.object({ dollars }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startCustomSupportCheckout' }, async () => {
      const userId = await requireUserId()
      await requireNotMember(userId)
      const session = await createLabCheckoutSession({
        module: MODULE,
        clerkUserId: userId,
        successPath: SUCCESS_PATH,
        cancelPath: '/stripe/membership?canceled=1',
        params: {
          mode: 'subscription',
          line_items: [{ price_data: customSupportPriceData(data.dollars), quantity: 1 }],
          subscription_data: { metadata: { lab_module: MODULE } },
        },
      })
      if (!session.url) {
        throw new Error('Stripe did not return a Checkout URL.')
      }
      return { url: session.url }
    })
  })

/**
 * A one-time tip. The amount is typed on Stripe's page, so the Price with
 * `custom_unit_amount` has to be the only line item, with quantity 1.
 */
export const startTipCheckout = createServerFn({ method: 'POST' }).handler(async () => {
  return Sentry.startSpan({ name: 'startTipCheckout' }, async () => {
    const userId = await requireUserId()
    const price = await findTipPrice()
    return startOrderCheckout({
      module: MODULE,
      clerkUserId: userId,
      successPath: SUCCESS_PATH,
      cancelPath: '/stripe/membership?canceled=1',
      params: {
        mode: 'payment',
        line_items: [{ price: price.id, quantity: 1 }],
        // The button on Stripe's page says "Donate" instead of "Pay".
        submit_type: 'donate',
        custom_fields: [
          {
            key: 'message',
            label: { type: 'custom', custom: 'Message for the supporter wall' },
            type: 'text',
            optional: true,
            text: { maximum_length: 140 },
          },
        ],
        payment_intent_data: { description: 'Tip for Stripe Lab Studio' },
      },
    })
  })
})

/** What the success page polls: is the membership or tip stored yet? */
export const getMembershipCheckout = createServerFn({ method: 'GET' })
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
    const waiting = { state: 'waiting' as const, membership: null, tip: null }
    if (!route) {
      return { ...waiting, state: 'not-found' as const }
    }

    const session = await getStripe().checkout.sessions.retrieve(data.sessionId)
    if (session.mode === 'subscription') {
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      const row = subscriptionId
        ? await db.query.paySubscriptions.findFirst({ where: eq(paySubscriptions.id, subscriptionId) })
        : undefined
      return row ? { state: 'ready' as const, membership: toMembershipView(row), tip: null } : waiting
    }

    const order = route.refId
      ? await db.query.payOrders.findFirst({ where: eq(payOrders.id, route.refId) })
      : undefined
    if (!order || order.status === 'pending') {
      return waiting
    }
    if (order.status === 'failed' || order.status === 'expired') {
      return { ...waiting, state: 'failed' as const }
    }
    const contribution = await db.query.payContributions.findFirst({
      where: eq(payContributions.orderId, order.id),
    })
    return {
      state: 'ready' as const,
      membership: null,
      tip: {
        amount: order.amountTotal ?? 0,
        currency: order.currency ?? 'usd',
        message: contribution?.message ?? null,
      },
    }
  })

export const changeMembershipAmount = createServerFn({ method: 'POST' })
  .validator(z.object({ dollars }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'changeMembershipAmount' }, async () =>
      changeCustomAmount(await requireUserId(), data.dollars),
    )
  })

/** Cancel at the end of the period (`cancel: true`), or stay after all. */
export const setMembershipCancel = createServerFn({ method: 'POST' })
  .validator(z.object({ cancel: z.boolean() }))
  .handler(async ({ data }) => {
    await setCancelAtPeriodEnd(await requireUserId(), data.cancel)
    return { cancel: data.cancel }
  })

export const openMembershipPortal = createServerFn({ method: 'POST' }).handler(async () => {
  return { url: await createMembershipPortalLink(await requireUserId()) }
})

export const saveWallName = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().max(40) }))
  .handler(async ({ data }) => {
    await setWallName(await requireUserId(), data.name || null)
    return { saved: true }
  })

export const refundTip = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.string().uuid(), amount: z.number().int().positive().optional() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await requestRefund(await findOwnOrder(userId, MODULE, data.orderId), data.amount)
    return { requested: true }
  })

export const resolveTipDispute = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.string().uuid(), outcome: z.enum(['won', 'lost']) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await resolveTestDispute(await findOwnOrder(userId, MODULE, data.orderId), data.outcome)
    return { submitted: true }
  })

/** The feed, with locked posts' text left out on the server. */
export const getMembershipFeed = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  const userId = await getOptionalUserId()
  return { signedIn: Boolean(userId), ...(await getFeed(userId)) }
})
