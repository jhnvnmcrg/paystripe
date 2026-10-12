import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#/db/index'
import { payCheckoutSessions, paySubscriptions } from '#/db/pay-schema'
import { getOptionalUserId, requireUserId } from '#/lib/auth.server'
import { listInvoices } from '#/lib/stripe/billing.server'
import { createLabCheckoutSession } from '#/lib/stripe/checkout.server'
import { getStripe } from '#/lib/stripe/client.server'
import { getCurrentSubscription, isLiveStatus } from '#/lib/stripe/subscriptions.server'
import { addons, plusPlan } from './catalog'
import {
  applyAddonChange,
  createProject,
  deleteProject,
  getPlanState,
  listProjects,
  loadPrices,
  planStateFrom,
  previewAddonChange,
  setCancelAtPeriodEnd,
  upgradeLineItems,
} from './freemium.server'

const MODULE = 'freemium' as const

const addonChange = z.discriminatedUnion('addon', [
  z.object({ addon: z.literal('seats'), quantity: z.number().int().min(0).max(20) }),
  z.object({ addon: z.enum(['analytics', 'support']), enabled: z.boolean() }),
])

async function loadAccount(userId: string) {
  const row = await getCurrentSubscription(userId, MODULE)
  return {
    planState: planStateFrom(row),
    projects: await listProjects(userId),
    invoices: row ? await listInvoices(row.stripeCustomerId) : [],
  }
}

/** Prices by lookup key, in cents, for the page to show. */
async function loadPriceAmounts(): Promise<Record<string, number | null>> {
  const prices = await loadPrices()
  const amounts: Record<string, number | null> = {}
  for (const [lookupKey, price] of Object.entries(prices)) {
    amounts[lookupKey] = price.unitAmount
  }
  return amounts
}

export const getFreemiumStore = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getFreemiumStore' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()
    let prices: Record<string, number | null> = {}
    let catalogError: string | null = null
    try {
      prices = await loadPriceAmounts()
    } catch (error) {
      catalogError = error instanceof Error ? error.message : 'Could not load prices from Stripe.'
    }
    const account = userId
      ? await loadAccount(userId)
      : { planState: planStateFrom(null), projects: [], invoices: [] }
    return {
      signedIn: Boolean(userId),
      prices,
      catalogError,
      seeded: Boolean(prices[plusPlan.lookupKey]) && addons.every((addon) => prices[addon.lookupKey]),
      ...account,
    }
  })
})

export const getFreemiumAccount = createServerFn({ method: 'GET' }).handler(async () => {
  setResponseHeader('Cache-Control', 'no-store')
  return loadAccount(await requireUserId())
})

export const createFreemiumProject = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(60) }))
  .handler(async ({ data }) => {
    await createProject(await requireUserId(), data.name)
    return { created: true }
  })

export const deleteFreemiumProject = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.number().int() }))
  .handler(async ({ data }) => {
    await deleteProject(await requireUserId(), data.id)
    return { deleted: true }
  })

/** Upgrade from Free: Plus plus any add-ons picked, as line items on one subscription. */
export const startFreemiumUpgrade = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      seats: z.number().int().min(0).max(20),
      analytics: z.boolean(),
      support: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'startFreemiumUpgrade' }, async () => {
      const userId = await requireUserId()
      const current = await getCurrentSubscription(userId, MODULE)
      if (current && isLiveStatus(current.status)) {
        throw new Error('You already have Plus. Change add-ons below.')
      }
      const session = await createLabCheckoutSession({
        module: MODULE,
        clerkUserId: userId,
        successPath: '/stripe/freemium/success',
        cancelPath: '/stripe/freemium?canceled=1',
        params: {
          mode: 'subscription',
          line_items: await upgradeLineItems(data),
          subscription_data: { metadata: { lab_module: MODULE } },
        },
      })
      if (!session.url) {
        throw new Error('Stripe did not return a Checkout URL.')
      }
      return { url: session.url }
    })
  })

export const getFreemiumCheckout = createServerFn({ method: 'GET' })
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
      return { state: 'not-found' as const, planState: null }
    }
    const session = await getStripe().checkout.sessions.retrieve(data.sessionId)
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
    const row = subscriptionId
      ? await db.query.paySubscriptions.findFirst({ where: eq(paySubscriptions.id, subscriptionId) })
      : undefined
    return row
      ? { state: 'ready' as const, planState: planStateFrom(row) }
      : { state: 'waiting' as const, planState: null }
  })

/** What an add-on change would charge today. Nothing changes yet. */
export const previewFreemiumAddon = createServerFn({ method: 'POST' })
  .validator(addonChange)
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'previewFreemiumAddon' }, async () =>
      previewAddonChange(await requireUserId(), data),
    )
  })

/** Applies a previewed change, with the preview's proration date. */
export const applyFreemiumAddon = createServerFn({ method: 'POST' })
  .validator(z.object({ change: addonChange, prorationDate: z.number().int() }))
  .handler(async ({ data }) => {
    return Sentry.startSpan({ name: 'applyFreemiumAddon' }, async () =>
      applyAddonChange(await requireUserId(), data.change, data.prorationDate),
    )
  })

/** Back to Free at the end of the period (`cancel: true`), or keep Plus after all. */
export const setFreemiumDowngrade = createServerFn({ method: 'POST' })
  .validator(z.object({ cancel: z.boolean() }))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await setCancelAtPeriodEnd(userId, data.cancel)
    return getPlanState(userId)
  })
