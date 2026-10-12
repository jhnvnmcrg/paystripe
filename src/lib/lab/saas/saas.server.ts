import { and, eq } from 'drizzle-orm'
import { db } from '#/db/index'
import type { PaySubscription } from '#/db/pay-schema'
import { paySubscriptions, payTestClockRuns } from '#/db/pay-schema'
import type { InvoiceView } from '#/lib/stripe/billing.server'
import { createPortalSession, listInvoices } from '#/lib/stripe/billing.server'
import { getStripe } from '#/lib/stripe/client.server'
import { getOrCreateStripeCustomer } from '#/lib/stripe/customers.server'
import type { Access } from '#/lib/stripe/subscriptions.server'
import { accessFor, getCurrentSubscription, syncSubscription } from '#/lib/stripe/subscriptions.server'
import type { BillingInterval, SaasPlanKey } from './catalog'
import { findSaasPlan, lookupKeyFor, planForLookupKey, SAAS_PORTAL_KEY } from './catalog'

const MODULE = 'saas'

/* ---------- views ---------- */

export interface SubscriptionView {
  id: string
  planKey: SaasPlanKey | null
  planName: string
  interval: BillingInterval | null
  seats: number
  status: string
  access: Access
  amount: number | null
  currency: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  cancelAt: string | null
  trialEnd: string | null
}

export function toSubscriptionView(row: PaySubscription): SubscriptionView {
  const plan = planForLookupKey(row.priceLookupKey)
  const item = row.items[0]
  const seats = item?.quantity ?? 1
  return {
    id: row.id,
    planKey: plan?.plan.key ?? null,
    planName: plan?.plan.name ?? item?.productName ?? 'Unknown plan',
    interval: plan?.interval ?? null,
    seats,
    status: row.status,
    access: accessFor(row.status),
    amount: item?.unitAmount !== null && item?.unitAmount !== undefined ? item.unitAmount * seats : null,
    currency: row.currency,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelAt: row.cancelAt?.toISOString() ?? null,
    trialEnd: row.trialEnd?.toISOString() ?? null,
  }
}

/* ---------- the real subscription ---------- */

export async function getRealSubscription(clerkUserId: string) {
  const row = await getCurrentSubscription(clerkUserId, MODULE)
  if (!row) {
    return { subscription: null, invoices: [] }
  }
  return { subscription: toSubscriptionView(row), invoices: await listInvoices(row.stripeCustomerId) }
}

/** The price behind a plan and interval, looked up by its lookup key. */
export async function findPlanPrice(plan: SaasPlanKey, interval: BillingInterval) {
  const lookupKey = lookupKeyFor(plan, interval)
  const {
    data: [price],
  } = await getStripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (!price) {
    throw new Error('The SaaS plans are not in your sandbox yet. Run npm run stripe:seed saas.')
  }
  return price
}

/* ---------- Customer Portal ---------- */

/**
 * A link to Stripe's hosted billing page, for the real customer or the
 * time-travel one. Plan changes, card updates and cancellations come back as webhooks.
 */
export async function createPortalLink(
  clerkUserId: string,
  target: 'real' | 'time-travel',
): Promise<string> {
  let customerId: string
  if (target === 'real') {
    customerId = await getOrCreateStripeCustomer(clerkUserId)
  } else {
    const run = await findRun(clerkUserId)
    if (!run) {
      throw new Error('There is no time-travel run to manage.')
    }
    customerId = run.stripeCustomerId
  }

  return createPortalSession({
    customerId,
    configurationKey: SAAS_PORTAL_KEY,
    returnPath: '/stripe/saas',
  })
}

/* ---------- time travel (test clocks) ---------- */

async function findRun(clerkUserId: string) {
  return db.query.payTestClockRuns.findFirst({
    where: and(eq(payTestClockRuns.clerkUserId, clerkUserId), eq(payTestClockRuns.module, MODULE)),
  })
}

async function requireRun(clerkUserId: string) {
  const run = await findRun(clerkUserId)
  if (!run) {
    throw new Error('Start a time-travel run first.')
  }
  return run
}

export interface TimeTravelView {
  clockTime: string
  clockStatus: string
  subscription: SubscriptionView | null
  invoices: InvoiceView[]
  /** Which card the clock's customer will be charged with next. */
  card: { last4: string | null; failing: boolean }
}

export async function getTimeTravel(clerkUserId: string): Promise<TimeTravelView | null> {
  const run = await findRun(clerkUserId)
  if (!run) {
    return null
  }
  const stripe = getStripe()
  const [clock, customer, row] = await Promise.all([
    stripe.testHelpers.testClocks.retrieve(run.testClockId),
    stripe.customers.retrieve(run.stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    }),
    run.subscriptionId
      ? db.query.paySubscriptions.findFirst({ where: eq(paySubscriptions.id, run.subscriptionId) })
      : undefined,
  ])

  let last4: string | null = null
  if (!customer.deleted) {
    const method = customer.invoice_settings.default_payment_method
    last4 = typeof method === 'object' && method ? (method.card?.last4 ?? null) : null
  }

  return {
    clockTime: new Date(clock.frozen_time * 1000).toISOString(),
    clockStatus: clock.status,
    subscription: row ? toSubscriptionView(row) : null,
    invoices: await listInvoices(run.stripeCustomerId),
    // 4000 0000 0000 0341 attaches fine but declines every charge.
    card: { last4, failing: last4 === '0341' },
  }
}

/**
 * Creates a test clock, a customer on it with a working card, and a subscription.
 * Everything on the clock moves when the clock is advanced; real time doesn't matter.
 */
export async function startTimeTravel(
  clerkUserId: string,
  options: {
    plan: SaasPlanKey
    interval: BillingInterval
    seats: number
    trial: boolean
    email: string | undefined
  },
): Promise<void> {
  if (await findRun(clerkUserId)) {
    throw new Error('End the current time-travel run before starting another.')
  }
  const plan = findSaasPlan(options.plan)
  if (!plan) {
    throw new Error('That plan does not exist.')
  }
  const stripe = getStripe()
  const price = await findPlanPrice(options.plan, options.interval)

  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: `Stripe Lab SaaS time travel (${clerkUserId.slice(-6)})`,
  })
  const customer = await stripe.customers.create({
    test_clock: clock.id,
    email: options.email,
    name: 'Time-travel customer',
    payment_method: 'pm_card_visa',
    invoice_settings: { default_payment_method: 'pm_card_visa' },
    metadata: { clerk_user_id: clerkUserId, lab_test_clock: 'true' },
  })

  const [run] = await db
    .insert(payTestClockRuns)
    .values({ clerkUserId, module: MODULE, testClockId: clock.id, stripeCustomerId: customer.id })
    .returning()

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price.id, quantity: plan.perSeat ? options.seats : 1 }],
    trial_period_days: options.trial && plan.trialDays ? plan.trialDays : undefined,
    metadata: { lab_module: MODULE },
  })
  await db
    .update(payTestClockRuns)
    .set({ subscriptionId: subscription.id })
    .where(eq(payTestClockRuns.id, run.id))

  // Store it now; the webhooks that follow keep it current.
  await db.transaction((tx) => syncSubscription(tx, subscription.id))
}

/**
 * Moves the clock forward. Two extra hours let a renewal invoice, which Stripe
 * finalizes about an hour after creating it, be charged within the same jump.
 */
export async function advanceTimeTravel(clerkUserId: string, by: 'week' | 'month'): Promise<void> {
  const run = await requireRun(clerkUserId)
  const stripe = getStripe()
  const clock = await stripe.testHelpers.testClocks.retrieve(run.testClockId)
  if (clock.status !== 'ready') {
    throw new Error('The clock is still moving. Try again in a moment.')
  }

  const next = new Date(clock.frozen_time * 1000)
  if (by === 'month') {
    next.setUTCMonth(next.getUTCMonth() + 1)
  } else {
    next.setUTCDate(next.getUTCDate() + 7)
  }
  next.setUTCHours(next.getUTCHours() + 2)

  await stripe.testHelpers.testClocks.advance(run.testClockId, {
    frozen_time: Math.floor(next.getTime() / 1000),
  })
}

/** Swaps the card future invoices are charged to: one that declines, or one that works. */
export async function setTimeTravelCard(clerkUserId: string, card: 'failing' | 'working'): Promise<void> {
  const run = await requireRun(clerkUserId)
  const stripe = getStripe()
  const method = await stripe.paymentMethods.attach(
    card === 'failing' ? 'pm_card_chargeCustomerFail' : 'pm_card_visa',
    { customer: run.stripeCustomerId },
  )
  await stripe.customers.update(run.stripeCustomerId, {
    invoice_settings: { default_payment_method: method.id },
  })
}

/** Charges the open invoice again now, instead of waiting for Stripe's next automatic retry. */
export async function retryTimeTravelInvoice(clerkUserId: string): Promise<void> {
  const run = await requireRun(clerkUserId)
  const stripe = getStripe()
  const {
    data: [invoice],
  } = await stripe.invoices.list({ customer: run.stripeCustomerId, status: 'open', limit: 1 })
  if (!invoice?.id) {
    throw new Error('There is no unpaid invoice to retry.')
  }
  try {
    await stripe.invoices.pay(invoice.id)
  } catch (error) {
    // A decline is an expected outcome here; the webhook records it.
    if (!(error instanceof Error && 'type' in error && error.type === 'StripeCardError')) {
      throw error
    }
  }
}

/** Deletes the test clock, which deletes its customer and subscription in Stripe too. */
export async function endTimeTravel(clerkUserId: string): Promise<void> {
  const run = await requireRun(clerkUserId)
  try {
    await getStripe().testHelpers.testClocks.del(run.testClockId)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'resource_missing')) {
      throw error
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(paySubscriptions).where(eq(paySubscriptions.testClockRunId, run.id))
    await tx.delete(payTestClockRuns).where(eq(payTestClockRuns.id, run.id))
  })
}
