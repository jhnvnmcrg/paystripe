import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/index'
import { payCheckoutSessions, payCreditAccounts, payCreditLedger, payOrders } from '#/db/pay-schema'
import { getOptionalUserId, requireUserId } from '#/lib/auth.server'
import { createLabCheckoutSession } from '#/lib/stripe/checkout.server'
import { getStripe } from '#/lib/stripe/client.server'
import { findOwnOrder, startOrderCheckout } from '#/lib/stripe/orders.server'
import { requestRefund, resolveTestDispute } from '#/lib/stripe/seller-actions.server'
import { creditPacks, findPack } from './catalog'
import {
  findPackPriceId,
  getAccount,
  listLedger,
  listPurchases,
  loadPackPrices,
  saveAutoRecharge,
  spendCredits,
} from './credits.server'

const MODULE = 'credits' as const
const SUCCESS_PATH = '/stripe/credits/success'

const packKey = z.enum(['starter', 'pro', 'studio'])

async function loadWallet(userId: string) {
  return {
    account: await getAccount(userId),
    ledger: await listLedger(userId),
    purchases: await listPurchases(userId),
  }
}

export const getCreditsStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getCreditsStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()
    let prices: Record<string, number | null> = {}
    let catalogError: string | null = null
    try {
      prices = await loadPackPrices()
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load prices from Stripe.'
    }
    return {
      signedIn: Boolean(userId),
      prices,
      catalogError,
      seeded: creditPacks.every((pack) => prices[pack.lookupKey]),
      wallet: userId ? await loadWallet(userId) : null,
    }
  })
})

export const getCreditsWallet = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  return loadWallet(await requireUserId())
})

/**
 * Buys a pack. `setup_future_usage: 'off_session'` asks Checkout to save the
 * card with the customer's consent, so auto-recharge can charge it later.
 */
export const startPackCheckout = createServerFn({ method: 'POST' })
  .validator(z.object({ pack: packKey }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startPackCheckout' }, async () => {
      const pack = findPack(data.pack)
      if (!pack) {
        throw new Error('That pack does not exist.')
      }
      return startOrderCheckout({
        module: MODULE,
        clerkUserId: await requireUserId(),
        successPath: SUCCESS_PATH,
        cancelPath: '/stripe/credits?canceled=1',
        params: {
          mode: 'payment',
          line_items: [{ price: await findPackPriceId(pack), quantity: 1 }],
          payment_intent_data: { setup_future_usage: 'off_session', metadata: { lab_module: MODULE } },
        },
      })
    })
  })

/** Replaces the saved card without charging anything: Checkout in setup mode. */
export const startCardSetup = createServerFn({ method: 'POST' }).handler(async () => {
  return Sentry.startSpan({ name: 'startCardSetup' }, async () => {
    const session = await createLabCheckoutSession({
      module: MODULE,
      clerkUserId: await requireUserId(),
      successPath: SUCCESS_PATH,
      cancelPath: '/stripe/credits?canceled=1',
      params: {
        mode: 'setup',
        // Setup mode needs a currency to know which payment methods to offer.
        currency: 'usd',
        setup_intent_data: { description: 'Card for automatic credit top-ups', metadata: { lab_module: MODULE } },
      },
    })
    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL.')
    }
    return { url: session.url }
  })
})

/** What the success page polls: a paid pack's credits, or a newly saved card. */
export const getCreditsCheckout = createServerFn({ method: 'GET' })
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
    const waiting = { state: 'waiting' as const, kind: null, credits: 0, balance: 0, card: null }
    if (!route) {
      return { ...waiting, state: 'not-found' as const }
    }

    const session = await getStripe().checkout.sessions.retrieve(data.sessionId, { expand: ['setup_intent'] })
    if (session.mode === 'setup') {
      const intent = typeof session.setup_intent === 'object' ? session.setup_intent : null
      const method = typeof intent?.payment_method === 'string' ? intent.payment_method : intent?.payment_method?.id
      const account = await db.query.payCreditAccounts.findFirst({
        where: eq(payCreditAccounts.clerkUserId, userId),
      })
      return method && account?.paymentMethodId === method
        ? {
            ...waiting,
            state: 'ready' as const,
            kind: 'card' as const,
            balance: account.balance,
            card: { brand: account.cardBrand ?? 'card', last4: account.cardLast4 },
          }
        : waiting
    }

    const order = route.refId ? await db.query.payOrders.findFirst({ where: eq(payOrders.id, route.refId) }) : undefined
    if (!order || order.status === 'pending') {
      return waiting
    }
    if (order.status === 'failed' || order.status === 'expired') {
      return { ...waiting, state: 'failed' as const }
    }
    const [granted] = await db
      .select({ credits: sql<number>`coalesce(sum(${payCreditLedger.delta}), 0)`.mapWith(Number) })
      .from(payCreditLedger)
      .where(and(eq(payCreditLedger.orderId, order.id), eq(payCreditLedger.kind, 'purchase')))
    if (!granted || granted.credits === 0) {
      return waiting
    }
    return {
      ...waiting,
      state: 'ready' as const,
      kind: 'pack' as const,
      credits: granted.credits,
      balance: (await getAccount(userId)).balance,
    }
  })

export const spendOnAction = createServerFn({ method: 'POST' })
  .validator(z.object({ action: z.enum(['image', 'sms', 'job']) }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'spendOnAction' }, async () => spendCredits(await requireUserId(), data.action))
  })

export const saveRechargeSettings = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean(), threshold: z.number().int().min(1).max(100_000), pack: packKey }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'saveRechargeSettings' }, async () => ({
      recharge: await saveAutoRecharge(await requireUserId(), data),
    }))
  })

export const refundCreditOrder = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.string().uuid(), amount: z.number().int().positive().optional() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await requestRefund(await findOwnOrder(userId, MODULE, data.orderId), data.amount)
    return { requested: true }
  })

export const resolveCreditDispute = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.string().uuid(), outcome: z.enum(['won', 'lost']) }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await resolveTestDispute(await findOwnOrder(userId, MODULE, data.orderId), data.outcome)
    return { submitted: true }
  })
