import { and, count, desc, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { db } from '#/db/index'
import type { PaySubscription } from '#/db/pay-schema'
import { payFreemiumProjects } from '#/db/pay-schema'
import { getStripe } from '#/lib/stripe/client.server'
import {
  accessFor,
  discardPendingUpdate,
  getCurrentSubscription,
  syncSubscription,
} from '#/lib/stripe/subscriptions.server'
import type { AddonKey } from './catalog'
import {
  addonForLookupKey,
  addons,
  FREE_PROJECT_LIMIT,
  findAddon,
  PLUS_PROJECT_LIMIT,
  plusPlan,
} from './catalog'

const MODULE = 'freemium'

/* ---------- plan state ---------- */

export interface FreemiumPlanState {
  plan: 'free' | 'plus'
  subscriptionId: string | null
  status: string | null
  cancelAtPeriodEnd: boolean
  cancelAt: string | null
  currentPeriodEnd: string | null
  trialEnd: string | null
  addons: { seats: number; analytics: boolean; support: boolean }
  monthlyTotal: number
  currency: string
  projectLimit: number
}

/** Plus while the subscription grants access (active, trialing, or retrying a failed payment). */
function liveRow(row: PaySubscription | null): PaySubscription | null {
  return row && accessFor(row.status) !== 'none' ? row : null
}

export function planStateFrom(row: PaySubscription | null): FreemiumPlanState {
  const live = liveRow(row)
  const quantityOf = (key: AddonKey) =>
    live?.items.find((item) => addonForLookupKey(item.lookupKey)?.key === key)?.quantity ?? 0

  return {
    plan: live ? 'plus' : 'free',
    subscriptionId: live?.id ?? null,
    status: row?.status ?? null,
    cancelAtPeriodEnd: live?.cancelAtPeriodEnd ?? false,
    cancelAt: live?.cancelAt?.toISOString() ?? null,
    currentPeriodEnd: live?.currentPeriodEnd?.toISOString() ?? null,
    trialEnd: live?.trialEnd?.toISOString() ?? null,
    addons: {
      seats: quantityOf('seats'),
      analytics: quantityOf('analytics') > 0,
      support: quantityOf('support') > 0,
    },
    monthlyTotal: (live?.items ?? []).reduce(
      (sum, item) => sum + (item.unitAmount ?? 0) * item.quantity,
      0,
    ),
    currency: live?.currency ?? 'usd',
    projectLimit: live ? PLUS_PROJECT_LIMIT : FREE_PROJECT_LIMIT,
  }
}

export async function getPlanState(clerkUserId: string): Promise<FreemiumPlanState> {
  return planStateFrom(await getCurrentSubscription(clerkUserId, MODULE))
}

/* ---------- the app's own data, limited by plan ---------- */

export async function listProjects(clerkUserId: string) {
  const rows = await db
    .select()
    .from(payFreemiumProjects)
    .where(eq(payFreemiumProjects.clerkUserId, clerkUserId))
    .orderBy(desc(payFreemiumProjects.createdAt))
  return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt.toISOString() }))
}

/** The free limit is the app's rule, checked against the plan the webhooks last stored. */
export async function createProject(clerkUserId: string, name: string): Promise<void> {
  const { plan, projectLimit } = await getPlanState(clerkUserId)
  const [{ total }] = await db
    .select({ total: count() })
    .from(payFreemiumProjects)
    .where(eq(payFreemiumProjects.clerkUserId, clerkUserId))
  if (total >= projectLimit) {
    throw new Error(
      plan === 'free'
        ? `Free includes ${FREE_PROJECT_LIMIT} projects. Upgrade to Plus for more.`
        : `You've reached ${projectLimit} projects.`,
    )
  }
  await db.insert(payFreemiumProjects).values({ clerkUserId, name })
}

export async function deleteProject(clerkUserId: string, id: number): Promise<void> {
  await db
    .delete(payFreemiumProjects)
    .where(and(eq(payFreemiumProjects.id, id), eq(payFreemiumProjects.clerkUserId, clerkUserId)))
}

/* ---------- prices ---------- */

/** Live unit prices by lookup key. */
export async function loadPrices(): Promise<Record<string, { id: string; unitAmount: number | null }>> {
  const lookupKeys = [plusPlan.lookupKey, ...addons.map((addon) => addon.lookupKey)]
  const { data } = await getStripe().prices.list({ lookup_keys: lookupKeys, active: true, limit: 10 })
  const prices: Record<string, { id: string; unitAmount: number | null }> = {}
  for (const price of data) {
    if (price.lookup_key) {
      prices[price.lookup_key] = { id: price.id, unitAmount: price.unit_amount }
    }
  }
  return prices
}

function requirePrice(prices: Record<string, { id: string }>, lookupKey: string): string {
  const price = prices[lookupKey]
  if (!price) {
    throw new Error('The freemium plans are not in your sandbox yet. Run npm run stripe:seed freemium.')
  }
  return price.id
}

/* ---------- add-on changes ---------- */

export type AddonChange =
  | { addon: 'seats'; quantity: number }
  | { addon: 'analytics' | 'support'; enabled: boolean }

/** Turns "set seats to 5" or "turn analytics off" into subscription item edits. */
function itemEdits(
  change: AddonChange,
  row: PaySubscription,
  prices: Record<string, { id: string }>,
): Stripe.SubscriptionUpdateParams.Item[] {
  const addon = findAddon(change.addon)
  if (!addon) {
    throw new Error('That add-on does not exist.')
  }
  const existing = row.items.find((item) => item.lookupKey === addon.lookupKey)
  const quantity =
    change.addon === 'seats'
      ? Math.max(0, Math.min(change.quantity, addon.maxQuantity))
      : change.enabled
        ? 1
        : 0

  if (quantity === 0) {
    return existing ? [{ id: existing.id, deleted: true }] : []
  }
  if (existing) {
    return existing.quantity === quantity ? [] : [{ id: existing.id, quantity }]
  }
  return [{ price: requirePrice(prices, addon.lookupKey), quantity }]
}

async function requirePlus(clerkUserId: string): Promise<PaySubscription> {
  const row = liveRow(await getCurrentSubscription(clerkUserId, MODULE))
  if (!row) {
    throw new Error('Add-ons need Plus. Upgrade first.')
  }
  return row
}

export interface AddonPreview {
  prorationDate: number
  /** What the card is charged the moment the change is confirmed. */
  amountDueNow: number
  /** Negative when removing something: credit kept for the next invoice. */
  total: number
  currency: string
  lines: Array<{ description: string; amount: number }>
}

/**
 * Asks Stripe what the change would cost, without changing anything.
 * The proration date is fixed here and must be reused when confirming,
 * otherwise a few seconds' difference changes the prorated amounts.
 */
export async function previewAddonChange(
  clerkUserId: string,
  change: AddonChange,
): Promise<AddonPreview> {
  const row = await requirePlus(clerkUserId)
  const items = itemEdits(change, row, await loadPrices())
  if (items.length === 0) {
    throw new Error('Nothing would change.')
  }

  const prorationDate = Math.floor(Date.now() / 1000)
  const preview = await getStripe().invoices.createPreview({
    customer: row.stripeCustomerId,
    subscription: row.id,
    subscription_details: {
      items,
      proration_behavior: 'always_invoice',
      proration_date: prorationDate,
    },
  })

  return {
    prorationDate,
    amountDueNow: preview.amount_due,
    total: preview.total,
    currency: preview.currency,
    lines: preview.lines.data.map((line) => ({
      description: line.description ?? 'Adjustment',
      amount: line.amount,
    })),
  }
}

export interface AddonResult {
  charged: number
  total: number
  currency: string
  invoiceUrl: string | null
}

/**
 * Applies the previewed change. `always_invoice` charges the prorated amount now;
 * `pending_if_incomplete` keeps the old items if that charge fails.
 */
export async function applyAddonChange(
  clerkUserId: string,
  change: AddonChange,
  prorationDate: number,
): Promise<AddonResult> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (prorationDate > nowSeconds || nowSeconds - prorationDate > 10 * 60) {
    throw new Error('That preview is out of date. Preview the change again.')
  }

  const row = await requirePlus(clerkUserId)
  const items = itemEdits(change, row, await loadPrices())
  if (items.length === 0) {
    throw new Error('Nothing would change.')
  }

  const updated = await getStripe().subscriptions.update(row.id, {
    items,
    proration_behavior: 'always_invoice',
    proration_date: prorationDate,
    payment_behavior: 'pending_if_incomplete',
    expand: ['latest_invoice'],
  })

  if (updated.pending_update) {
    await discardPendingUpdate(updated)
    throw new Error("Your card was declined, so the add-on wasn't changed.")
  }

  // Store the new items now; the webhooks that follow agree.
  await db.transaction((tx) => syncSubscription(tx, row.id))

  const invoice = typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null
  return {
    charged: invoice?.amount_paid ?? 0,
    total: invoice?.total ?? 0,
    currency: invoice?.currency ?? row.currency,
    invoiceUrl: invoice?.hosted_invoice_url ?? null,
  }
}

/* ---------- upgrade and downgrade ---------- */

export interface UpgradeChoice {
  seats: number
  analytics: boolean
  support: boolean
}

/** Plus is always the first line; add-ons can't be bought without it. */
export async function upgradeLineItems(choice: UpgradeChoice) {
  const prices = await loadPrices()
  const lines: Array<{ price: string; quantity: number }> = [
    { price: requirePrice(prices, plusPlan.lookupKey), quantity: 1 },
  ]
  const seats = findAddon('seats')
  if (choice.seats > 0 && seats) {
    lines.push({ price: requirePrice(prices, seats.lookupKey), quantity: Math.min(choice.seats, seats.maxQuantity) })
  }
  for (const key of ['analytics', 'support'] as const) {
    const addon = findAddon(key)
    if (choice[key] && addon) {
      lines.push({ price: requirePrice(prices, addon.lookupKey), quantity: 1 })
    }
  }
  return lines
}

/** Back to Free at the end of the paid period, or undo that. */
export async function setCancelAtPeriodEnd(clerkUserId: string, cancel: boolean): Promise<void> {
  const row = await requirePlus(clerkUserId)
  await getStripe().subscriptions.update(row.id, { cancel_at_period_end: cancel })
  await db.transaction((tx) => syncSubscription(tx, row.id))
}
