import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import type { PaySubscription } from '#/db/pay-schema'
import { payTestClockRuns, payUsageAlerts, payUsageEvents, paySubscriptions } from '#/db/pay-schema'
import type { InvoiceView } from '#/lib/stripe/billing.server'
import { createPortalSession, listInvoices } from '#/lib/stripe/billing.server'
import { getStripe } from '#/lib/stripe/client.server'
import type { Access } from '#/lib/stripe/subscriptions.server'
import { accessFor, getCurrentSubscription, syncSubscription } from '#/lib/stripe/subscriptions.server'
import type { MeterKey } from './catalog'
import { findMeter, PAYLOAD_CUSTOMER_KEY, PAYLOAD_VALUE_KEY, USAGE_PORTAL_KEY, usageMeters } from './catalog'

const MODULE = 'usage'
const SEED_HINT = 'The metered prices are not in your sandbox yet. Run npm run stripe:seed usage.'

type MeterTotals = Record<MeterKey, number>

function emptyTotals(): MeterTotals {
  return { requests: 0, images: 0 }
}

/* ---------- meters and prices ---------- */

let meterIdsCache: Promise<Record<string, string>> | null = null

/** Meter IDs by event name. Meters never change ID, so this is looked up once per server process. */
async function getMeterIds(): Promise<Record<string, string>> {
  meterIdsCache ??= (async () => {
    const ids: Record<string, string> = {}
    for await (const meter of getStripe().billing.meters.list({ status: 'active', limit: 100 })) {
      ids[meter.event_name] = meter.id
    }
    if (usageMeters.some((meter) => !ids[meter.eventName])) {
      throw new Error(SEED_HINT)
    }
    return ids
  })()
  try {
    return await meterIdsCache
  } catch (error) {
    meterIdsCache = null
    throw error
  }
}

/** The metered Price IDs, by lookup key. */
export async function loadUsagePrices(): Promise<Record<string, string>> {
  const { data } = await getStripe().prices.list({
    lookup_keys: usageMeters.map((meter) => meter.lookupKey),
    active: true,
    limit: 10,
  })
  const prices: Record<string, string> = {}
  for (const price of data) {
    if (price.lookup_key) {
      prices[price.lookup_key] = price.id
    }
  }
  return prices
}

/** Metered prices go into Checkout without a quantity: the meter decides it later. */
export async function usageLineItems() {
  const prices = await loadUsagePrices()
  return usageMeters.map((meter) => {
    const price = prices[meter.lookupKey]
    if (!price) {
      throw new Error(SEED_HINT)
    }
    return { price }
  })
}

/* ---------- the subscription ---------- */

export interface UsageSubscriptionView {
  id: string
  status: string
  access: Access
  currency: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  cancelAt: string | null
  trialEnd: string | null
}

export function toUsageSubscriptionView(row: PaySubscription): UsageSubscriptionView {
  return {
    id: row.id,
    status: row.status,
    access: accessFor(row.status),
    currency: row.currency,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelAt: row.cancelAt?.toISOString() ?? null,
    trialEnd: row.trialEnd?.toISOString() ?? null,
  }
}

async function requireLiveSubscription(clerkUserId: string): Promise<PaySubscription> {
  const row = await getCurrentSubscription(clerkUserId, MODULE)
  if (!row || accessFor(row.status) === 'none') {
    throw new Error('Subscribe first. Usage is only billed on an active subscription.')
  }
  return row
}

/* ---------- recording usage ---------- */

export interface UsageEventView {
  id: string
  meter: MeterKey
  value: number
  status: 'pending' | 'sent' | 'failed'
  error: string | null
  occurredAt: string
}

/** Stripe refuses a second event with the same identifier: the first attempt got through. */
function isDuplicateIdentifier(error: unknown): boolean {
  return error instanceof Error && error.message.includes('already exists with identifier')
}

/**
 * Sends one meter event. The row's ID is the identifier, so if an earlier
 * attempt reached Stripe but timed out on the way back, resending is safe.
 */
async function sendMeterEvent(rowId: string): Promise<void> {
  const row = await db.query.payUsageEvents.findFirst({ where: eq(payUsageEvents.id, rowId) })
  const meter = row ? findMeter(row.meter) : undefined
  if (!row || !meter) {
    throw new Error('That usage record does not exist.')
  }

  try {
    await getStripe().billing.meterEvents.create({
      event_name: meter.eventName,
      identifier: row.id,
      timestamp: Math.floor(row.occurredAt.getTime() / 1000),
      // Payload values are strings, even numbers.
      payload: { [PAYLOAD_CUSTOMER_KEY]: row.stripeCustomerId, [PAYLOAD_VALUE_KEY]: String(row.value) },
    })
  } catch (error) {
    if (!isDuplicateIdentifier(error)) {
      const message = error instanceof Error ? error.message : 'Stripe did not accept the event.'
      await db.update(payUsageEvents).set({ status: 'failed', error: message }).where(eq(payUsageEvents.id, row.id))
      throw new Error(`Usage not recorded: ${message}`)
    }
  }
  await db
    .update(payUsageEvents)
    .set({ status: 'sent', error: null, sentAt: new Date() })
    .where(eq(payUsageEvents.id, row.id))
}

async function recordFor(
  target: { clerkUserId: string; stripeCustomerId: string; testClockRunId: string | null },
  meterKey: MeterKey,
  value: number,
): Promise<void> {
  // Recorded locally first, as an outbox: if Stripe can't be reached, the row stays for a retry.
  const [row] = await db
    .insert(payUsageEvents)
    .values({ ...target, meter: meterKey, value, occurredAt: new Date() })
    .returning({ id: payUsageEvents.id })
  await sendMeterEvent(row.id)
}

/** What the toy API does after serving a request: count it against the customer. */
export async function recordUsage(clerkUserId: string, meterKey: MeterKey, value: number): Promise<void> {
  const row = await requireLiveSubscription(clerkUserId)
  await recordFor({ clerkUserId, stripeCustomerId: row.stripeCustomerId, testClockRunId: null }, meterKey, value)
}

/** Resends a usage record that didn't reach Stripe, with the same identifier. */
export async function retryUsageEvent(clerkUserId: string, id: string): Promise<void> {
  const row = await db.query.payUsageEvents.findFirst({
    where: and(eq(payUsageEvents.id, id), eq(payUsageEvents.clerkUserId, clerkUserId)),
  })
  if (!row || row.status === 'sent') {
    throw new Error('There is nothing to resend.')
  }
  await sendMeterEvent(row.id)
}

/* ---------- reading usage ---------- */

export async function listRecentUsage(clerkUserId: string, testClockRunId: string | null): Promise<UsageEventView[]> {
  const rows = await db
    .select()
    .from(payUsageEvents)
    .where(
      and(
        eq(payUsageEvents.clerkUserId, clerkUserId),
        testClockRunId ? eq(payUsageEvents.testClockRunId, testClockRunId) : isNull(payUsageEvents.testClockRunId),
      ),
    )
    .orderBy(desc(payUsageEvents.createdAt))
    .limit(8)
  return rows.flatMap((row) => {
    const meter = findMeter(row.meter)
    return meter
      ? [
          {
            id: row.id,
            meter: meter.key,
            value: row.value,
            status: row.status,
            error: row.error,
            occurredAt: row.occurredAt.toISOString(),
          },
        ]
      : []
  })
}

/** What the app has sent since the period started, by meter. */
export async function localUsage(stripeCustomerId: string, since: Date | null): Promise<MeterTotals> {
  const rows = await db
    .select({ meter: payUsageEvents.meter, total: sql<number>`sum(${payUsageEvents.value})`.mapWith(Number) })
    .from(payUsageEvents)
    .where(
      and(
        eq(payUsageEvents.stripeCustomerId, stripeCustomerId),
        eq(payUsageEvents.status, 'sent'),
        since ? gte(payUsageEvents.occurredAt, since) : undefined,
      ),
    )
    .groupBy(payUsageEvents.meter)
  const totals = emptyTotals()
  for (const row of rows) {
    const meter = findMeter(row.meter)
    if (meter) {
      totals[meter.key] = row.total
    }
  }
  return totals
}

/**
 * What Stripe's meters have counted for a customer since `since`. Summaries
 * work on whole minutes, and new events take about a minute to show up.
 */
export async function stripeUsage(stripeCustomerId: string, since: Date): Promise<MeterTotals> {
  const ids = await getMeterIds()
  const start = Math.floor(since.getTime() / 60_000) * 60
  const end = Math.max(Math.ceil(Date.now() / 60_000) * 60, start + 60)
  const totals = emptyTotals()
  await Promise.all(
    usageMeters.map(async (meter) => {
      const { data } = await getStripe().billing.meters.listEventSummaries(ids[meter.eventName], {
        customer: stripeCustomerId,
        start_time: start,
        end_time: end,
      })
      totals[meter.key] = data.reduce((sum, summary) => sum + summary.aggregated_value, 0)
    }),
  )
  return totals
}

export interface BillPreview {
  total: number
  currency: string
  /** When this invoice will be created: the end of the current period. */
  periodEnd: string | null
  lines: Array<{ id: string; description: string; quantity: number | null; amount: number }>
}

/** The invoice Stripe would create at the end of this period, with usage so far. */
export async function previewBill(stripeCustomerId: string, subscriptionId: string): Promise<BillPreview> {
  const invoice = await getStripe().invoices.createPreview({
    customer: stripeCustomerId,
    subscription: subscriptionId,
  })
  return {
    total: invoice.total,
    currency: invoice.currency,
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    lines: invoice.lines.data.map((line) => ({
      id: line.id ?? line.description ?? '',
      description: line.description ?? 'Usage',
      quantity: line.quantity ?? null,
      amount: line.amount,
    })),
  }
}

export interface MeterReading {
  local: MeterTotals
  stripe: MeterTotals
  bill: BillPreview
}

/** Local and Stripe-side usage for the current period, plus the bill so far. */
export async function readMeters(row: PaySubscription): Promise<MeterReading> {
  const since = row.currentPeriodStart ?? row.createdAt
  const [local, stripe, bill] = await Promise.all([
    localUsage(row.stripeCustomerId, since),
    stripeUsage(row.stripeCustomerId, since),
    previewBill(row.stripeCustomerId, row.id),
  ])
  return { local, stripe, bill }
}

/* ---------- usage alerts ---------- */

export interface UsageAlertView {
  id: string
  meter: MeterKey
  threshold: number
  status: string
  triggeredAt: string | null
  triggeredValue: number | null
}

export async function listAlerts(clerkUserId: string): Promise<UsageAlertView[]> {
  const rows = await db
    .select()
    .from(payUsageAlerts)
    .where(eq(payUsageAlerts.clerkUserId, clerkUserId))
    .orderBy(desc(payUsageAlerts.createdAt))
    .limit(5)
  return rows.flatMap((row) => {
    const meter = findMeter(row.meter)
    return meter
      ? [
          {
            id: row.id,
            meter: meter.key,
            threshold: row.threshold,
            status: row.status,
            triggeredAt: row.triggeredAt?.toISOString() ?? null,
            triggeredValue: row.triggeredValue,
          },
        ]
      : []
  })
}

async function archiveAlert(id: string): Promise<void> {
  await getStripe().billing.alerts.archive(id)
  await db.update(payUsageAlerts).set({ status: 'archived' }).where(eq(payUsageAlerts.id, id))
}

/**
 * Asks Stripe to send `billing.alert.triggered` once this customer's usage
 * on a meter reaches the threshold. One active alert per meter here.
 */
export async function setUsageAlert(clerkUserId: string, meterKey: MeterKey, threshold: number): Promise<void> {
  const row = await requireLiveSubscription(clerkUserId)
  const meter = findMeter(meterKey)
  if (!meter) {
    throw new Error('That meter does not exist.')
  }

  const existing = await db
    .select()
    .from(payUsageAlerts)
    .where(
      and(
        eq(payUsageAlerts.clerkUserId, clerkUserId),
        eq(payUsageAlerts.meter, meterKey),
        eq(payUsageAlerts.status, 'active'),
      ),
    )
  for (const alert of existing) {
    await archiveAlert(alert.id)
  }

  const ids = await getMeterIds()
  const alert = await getStripe().billing.alerts.create({
    alert_type: 'usage_threshold',
    title: `${meter.productName} reached ${threshold.toLocaleString('en-US')}`,
    usage_threshold: {
      gte: threshold,
      meter: ids[meter.eventName],
      recurrence: 'one_time',
      filters: [{ type: 'customer', customer: row.stripeCustomerId }],
    },
  })
  await db.insert(payUsageAlerts).values({
    id: alert.id,
    clerkUserId,
    stripeCustomerId: row.stripeCustomerId,
    meter: meterKey,
    threshold,
    status: alert.status ?? 'active',
  })
}

export async function removeUsageAlert(clerkUserId: string, id: string): Promise<void> {
  const row = await db.query.payUsageAlerts.findFirst({
    where: and(eq(payUsageAlerts.id, id), eq(payUsageAlerts.clerkUserId, clerkUserId)),
  })
  if (!row) {
    throw new Error('That alert does not exist.')
  }
  await archiveAlert(row.id)
}

/** The webhook: Stripe saw usage cross an alert's threshold. */
export async function markAlertTriggered(tx: DbTransaction, triggered: Stripe.Billing.AlertTriggered): Promise<void> {
  await tx
    .update(payUsageAlerts)
    .set({
      triggeredAt: new Date(triggered.created * 1000),
      triggeredValue: Math.round(triggered.value),
      status: triggered.alert.status ?? 'active',
    })
    .where(eq(payUsageAlerts.id, triggered.alert.id))
}

/* ---------- cancelling and billing ---------- */

/** Cancel at period end: usage up to then is still invoiced. */
export async function setCancelAtPeriodEnd(clerkUserId: string, cancel: boolean): Promise<void> {
  const row = await requireLiveSubscription(clerkUserId)
  await getStripe().subscriptions.update(row.id, { cancel_at_period_end: cancel })
  await db.transaction((tx) => syncSubscription(tx, row.id))
}

export async function createUsagePortalLink(clerkUserId: string): Promise<string> {
  const row = await getCurrentSubscription(clerkUserId, MODULE)
  if (!row) {
    throw new Error('Subscribe first, then manage billing here.')
  }
  return createPortalSession({ customerId: row.stripeCustomerId, configurationKey: USAGE_PORTAL_KEY, returnPath: '/stripe/usage' })
}

/* ---------- time travel (test clocks) ---------- */

/** Stripe refuses meter events dated more than 5 minutes ahead of the real clock. */
const FUTURE_LIMIT_MS = 5 * 60_000

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

async function runSubscription(subscriptionId: string | null) {
  return subscriptionId
    ? db.query.paySubscriptions.findFirst({ where: eq(paySubscriptions.id, subscriptionId) })
    : undefined
}

export interface UsageTimeTravelView {
  clockTime: string
  clockStatus: string
  /** False once the clock is ahead of real time: Stripe won't take usage dated in the future. */
  canMeter: boolean
  subscription: UsageSubscriptionView | null
  recent: UsageEventView[]
  reading: MeterReading | null
  invoices: InvoiceView[]
}

export async function getUsageTimeTravel(clerkUserId: string): Promise<UsageTimeTravelView | null> {
  const run = await findRun(clerkUserId)
  if (!run) {
    return null
  }
  const [clock, row] = await Promise.all([
    getStripe().testHelpers.testClocks.retrieve(run.testClockId),
    runSubscription(run.subscriptionId),
  ])
  const canMeter = clock.frozen_time * 1000 <= Date.now() + FUTURE_LIMIT_MS
  const live = row && accessFor(row.status) !== 'none'

  return {
    clockTime: new Date(clock.frozen_time * 1000).toISOString(),
    clockStatus: clock.status,
    canMeter,
    subscription: row ? toUsageSubscriptionView(row) : null,
    recent: await listRecentUsage(clerkUserId, run.id),
    // Once the clock has moved ahead, Stripe's summaries for "now" are about a past period.
    reading: live && canMeter ? await readMeters(row) : null,
    invoices: await listInvoices(run.stripeCustomerId),
  }
}

/** A test clock, a customer on it with a working card, and a metered subscription. */
export async function startUsageTimeTravel(clerkUserId: string, email: string | undefined): Promise<void> {
  if (await findRun(clerkUserId)) {
    throw new Error('End the current time-travel run before starting another.')
  }
  const stripe = getStripe()
  const items = await usageLineItems()

  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: `Stripe Lab usage time travel (${clerkUserId.slice(-6)})`,
  })
  const customer = await stripe.customers.create({
    test_clock: clock.id,
    email,
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
    items,
    metadata: { lab_module: MODULE },
  })
  await db.update(payTestClockRuns).set({ subscriptionId: subscription.id }).where(eq(payTestClockRuns.id, run.id))
  await db.transaction((tx) => syncSubscription(tx, subscription.id))
}

/** Usage for the time-travel customer. Only possible before the clock moves ahead of real time. */
export async function sendTimeTravelUsage(clerkUserId: string, meterKey: MeterKey, value: number): Promise<void> {
  const run = await requireRun(clerkUserId)
  const clock = await getStripe().testHelpers.testClocks.retrieve(run.testClockId)
  if (clock.frozen_time * 1000 > Date.now() + FUTURE_LIMIT_MS) {
    throw new Error(
      'The clock is ahead of real time, and Stripe only takes usage dated up to 5 minutes ahead. A run can only meter its first month: end it and start another.',
    )
  }
  await recordFor({ clerkUserId, stripeCustomerId: run.stripeCustomerId, testClockRunId: run.id }, meterKey, value)
}

/**
 * Moves the clock past the end of the period, plus two hours so Stripe can
 * finalize and charge the usage invoice. Refuses while Stripe hasn't counted
 * all the usage yet: events still being processed could miss the invoice.
 */
export async function advanceUsageTimeTravel(clerkUserId: string): Promise<void> {
  const run = await requireRun(clerkUserId)
  const stripe = getStripe()
  const [clock, row] = await Promise.all([
    stripe.testHelpers.testClocks.retrieve(run.testClockId),
    runSubscription(run.subscriptionId),
  ])
  if (clock.status !== 'ready') {
    throw new Error('The clock is still moving. Try again in a moment.')
  }
  if (!row?.currentPeriodEnd) {
    throw new Error('The run has no subscription to bill.')
  }

  if (clock.frozen_time * 1000 <= Date.now() + FUTURE_LIMIT_MS) {
    const since = row.currentPeriodStart ?? row.createdAt
    const [local, counted] = await Promise.all([
      localUsage(run.stripeCustomerId, since),
      stripeUsage(run.stripeCustomerId, since),
    ])
    const behind = usageMeters.find((meter) => counted[meter.key] < local[meter.key])
    if (behind) {
      throw new Error(
        `Stripe has counted ${counted[behind.key]} of ${local[behind.key]} ${behind.units} so far. New usage takes about a minute to be counted; advance once they match, or it could miss the invoice.`,
      )
    }
  }

  await stripe.testHelpers.testClocks.advance(run.testClockId, {
    frozen_time: Math.floor(row.currentPeriodEnd.getTime() / 1000) + 2 * 60 * 60,
  })
}

/** Deletes the test clock, which deletes its customer and subscription in Stripe too. */
export async function endUsageTimeTravel(clerkUserId: string): Promise<void> {
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
    await tx.delete(payUsageEvents).where(eq(payUsageEvents.testClockRunId, run.id))
    await tx.delete(payTestClockRuns).where(eq(payTestClockRuns.id, run.id))
  })
}
