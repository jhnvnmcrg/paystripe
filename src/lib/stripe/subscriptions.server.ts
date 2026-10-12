import { and, desc, eq, isNull } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import type { PaySubscription, StoredSubscriptionItem } from '#/db/pay-schema'
import { payCustomers, paySubscriptions, payTestClockRuns } from '#/db/pay-schema'
import type { LabModuleSlug } from '#/lib/lab/modules'
import { isLabModuleSlug } from '#/lib/lab/modules'
import { getStripe } from '#/lib/stripe/client.server'

/*
 * Shared by every subscription module (SaaS, gated tools, freemium, membership, usage).
 * The local copy is always rewritten from a fresh fetch, never from an event's
 * snapshot, so events arriving out of order can't leave it stale.
 */

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }
  return typeof value === 'string' ? value : value.id
}

function toDate(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(seconds * 1000) : null
}

function isMissingResource(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'resource_missing'
}

/** Whose subscription this is: a user's real Customer, or one of their time-travel customers. */
async function findOwner(
  tx: DbTransaction,
  stripeCustomerId: string,
): Promise<{ clerkUserId: string; testClockRunId: string | null } | null> {
  const real = await tx.query.payCustomers.findFirst({
    where: eq(payCustomers.stripeCustomerId, stripeCustomerId),
  })
  if (real) {
    return { clerkUserId: real.clerkUserId, testClockRunId: null }
  }
  const run = await tx.query.payTestClockRuns.findFirst({
    where: eq(payTestClockRuns.stripeCustomerId, stripeCustomerId),
  })
  return run ? { clerkUserId: run.clerkUserId, testClockRunId: run.id } : null
}

/**
 * The module that sells a subscription, read through Stripe's objects:
 * subscription, then price, then product, whose metadata the seed sets.
 */
function moduleOf(subscription: Stripe.Subscription): LabModuleSlug | null {
  for (const item of subscription.items.data) {
    const product = item.price.product
    const fromProduct =
      typeof product === 'object' && !product.deleted ? product.metadata.lab_module : undefined
    const candidate = fromProduct ?? subscription.metadata.lab_module
    if (candidate && isLabModuleSlug(candidate)) {
      return candidate
    }
  }
  return null
}

function toItems(subscription: Stripe.Subscription): StoredSubscriptionItem[] {
  return subscription.items.data.map((item) => {
    const product = item.price.product
    return {
      id: item.id,
      priceId: item.price.id,
      lookupKey: item.price.lookup_key,
      productId: typeof product === 'string' ? product : product.id,
      productName: typeof product === 'object' && !product.deleted ? product.name : '',
      quantity: item.quantity ?? 1,
      unitAmount: item.price.unit_amount,
      interval: item.price.recurring?.interval ?? null,
    }
  })
}

export interface SyncResult {
  row: PaySubscription
  previousStatus: string | null
}

/**
 * Re-fetches a subscription and stores its current state.
 * Returns null for subscriptions that aren't the lab's, or that no longer exist
 * (a deleted test clock takes its subscriptions with it).
 */
export async function syncSubscription(
  tx: DbTransaction,
  subscriptionId: string,
): Promise<SyncResult | null> {
  let subscription: Stripe.Subscription
  try {
    subscription = await getStripe().subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    })
  } catch (error) {
    if (isMissingResource(error)) {
      return null
    }
    throw error
  }

  const customerId = idOf(subscription.customer)
  const owner = customerId ? await findOwner(tx, customerId) : null
  const module = moduleOf(subscription)
  if (!customerId || !owner || !module) {
    return null
  }

  // The billing period lives on each item (API 2025-03-31 onward); the first item is the plan.
  const first = subscription.items.data[0]
  const values = {
    id: subscription.id,
    module,
    clerkUserId: owner.clerkUserId,
    stripeCustomerId: customerId,
    status: subscription.status,
    priceLookupKey: first?.price.lookup_key ?? null,
    items: toItems(subscription),
    currency: subscription.currency,
    currentPeriodStart: toDate(first?.current_period_start),
    currentPeriodEnd: toDate(first?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: toDate(subscription.cancel_at),
    canceledAt: toDate(subscription.canceled_at),
    trialEnd: toDate(subscription.trial_end),
    testClockRunId: owner.testClockRunId,
    updatedAt: new Date(),
  }

  const previous = await tx.query.paySubscriptions.findFirst({
    where: eq(paySubscriptions.id, subscription.id),
  })
  const [row] = await tx
    .insert(paySubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: paySubscriptions.id, set: values })
    .returning()

  return { row, previousStatus: previous?.status ?? null }
}

/** The subscription an invoice belongs to (API 2025-03-31 onward keeps it under `parent`). */
export function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription)
}

/**
 * A declined `pending_if_incomplete` change isn't gone: it stays pending for up
 * to 23 hours and applies if its invoice is paid in that time. Voiding the
 * invoice discards it now, so "nothing changed" stays true.
 */
export async function discardPendingUpdate(subscription: Stripe.Subscription): Promise<void> {
  const invoiceId = idOf(subscription.latest_invoice)
  if (subscription.pending_update && invoiceId) {
    await getStripe().invoices.voidInvoice(invoiceId)
  }
}

/** After a subscription checkout, store the new subscription straight away. */
export async function syncCheckoutSubscription(
  tx: DbTransaction,
  session: Stripe.Checkout.Session,
): Promise<SyncResult | null> {
  const subscriptionId = idOf(session.subscription)
  return subscriptionId ? syncSubscription(tx, subscriptionId) : null
}

export type Access = 'full' | 'grace' | 'none'

/**
 * What a status means for the customer. `past_due` keeps access while Stripe
 * retries the failed payment; most products do this rather than lock people out at once.
 */
export function accessFor(status: string | null | undefined): Access {
  if (status === 'active' || status === 'trialing') {
    return 'full'
  }
  if (status === 'past_due') {
    return 'grace'
  }
  return 'none'
}

/** Statuses where the customer still has a subscription to manage. */
const LIVE_STATUSES = ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete']

/**
 * The user's current subscription for a module on their real customer
 * (time-travel runs excluded): the live one if there is one, else the most recent.
 */
export async function getCurrentSubscription(
  clerkUserId: string,
  module: LabModuleSlug,
): Promise<PaySubscription | null> {
  const rows = await db
    .select()
    .from(paySubscriptions)
    .where(
      and(
        eq(paySubscriptions.clerkUserId, clerkUserId),
        eq(paySubscriptions.module, module),
        isNull(paySubscriptions.testClockRunId),
      ),
    )
    .orderBy(desc(paySubscriptions.updatedAt))
  return rows.find((row) => LIVE_STATUSES.includes(row.status)) ?? rows[0] ?? null
}

export function isLiveStatus(status: string): boolean {
  return LIVE_STATUSES.includes(status)
}
