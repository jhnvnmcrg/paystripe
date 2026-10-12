import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import type { PayOrder, PaySubscription } from '#/db/pay-schema'
import {
  payContributions,
  payMemberRoleChanges,
  payMembers,
  payOrders,
  paySubscriptions,
} from '#/db/pay-schema'
import { createPortalSession } from '#/lib/stripe/billing.server'
import { getStripe } from '#/lib/stripe/client.server'
import type { Access } from '#/lib/stripe/subscriptions.server'
import {
  accessFor,
  discardPendingUpdate,
  getCurrentSubscription,
  subscriptionIdOfInvoice,
  syncSubscription,
} from '#/lib/stripe/subscriptions.server'
import type { MemberLevel, MembershipInterval, TierKey } from './catalog'
import {
  customSupport,
  levelForMonthlyAmount,
  levelNames,
  MEMBERSHIP_PORTAL_KEY,
  reaches,
  tierForLookupKey,
  tierLookupKey,
  tiers,
  tipJar,
} from './catalog'
import { posts } from './posts.server'

const MODULE = 'membership'

/* ---------- what a subscription is worth ---------- */

/**
 * The level a subscription grants right now. A tier grants its own level;
 * pay-what-you-want grants whatever tier its monthly amount covers.
 * Past-due members keep their level while Stripe retries the payment.
 */
export function levelOf(row: PaySubscription | null | undefined): MemberLevel | null {
  if (!row || accessFor(row.status) === 'none') {
    return null
  }
  const item = row.items[0]
  if (!item) {
    return null
  }
  const tier = tierForLookupKey(item.lookupKey)
  if (tier) {
    return tier.tier.key
  }
  if (item.productId === customSupport.productId && item.unitAmount !== null) {
    return levelForMonthlyAmount(item.unitAmount * item.quantity)
  }
  return null
}

export interface MembershipView {
  id: string
  kind: 'tier' | 'custom'
  level: MemberLevel | null
  name: string
  interval: MembershipInterval | null
  amount: number | null
  currency: string
  status: string
  access: Access
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  cancelAt: string | null
  trialEnd: string | null
}

export function toMembershipView(row: PaySubscription): MembershipView {
  const item = row.items[0]
  const tier = tierForLookupKey(item?.lookupKey ?? null)
  const interval = item?.interval === 'month' || item?.interval === 'year' ? item.interval : null
  return {
    id: row.id,
    kind: tier ? 'tier' : 'custom',
    level: levelOf(row),
    name: tier?.tier.name ?? customSupport.name,
    interval: tier?.interval ?? interval,
    amount: item?.unitAmount != null ? item.unitAmount * item.quantity : null,
    currency: row.currency,
    status: row.status,
    access: accessFor(row.status),
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelAt: row.cancelAt?.toISOString() ?? null,
    trialEnd: row.trialEnd?.toISOString() ?? null,
  }
}

export async function getMembership(clerkUserId: string): Promise<MembershipView | null> {
  const row = await getCurrentSubscription(clerkUserId, MODULE)
  return row ? toMembershipView(row) : null
}

export async function getLevel(clerkUserId: string): Promise<MemberLevel | null> {
  return levelOf(await getCurrentSubscription(clerkUserId, MODULE))
}

async function requireLiveMembership(clerkUserId: string): Promise<PaySubscription> {
  const row = await getCurrentSubscription(clerkUserId, MODULE)
  if (!row || accessFor(row.status) === 'none') {
    throw new Error('You are not a member right now.')
  }
  return row
}

/* ---------- the simulated community role ---------- */

/**
 * Gives the member the community role that matches their level, and records
 * the change. A real integration calls Discord here: add the new role and
 * remove the old one (PUT and DELETE /guilds/{guild}/members/{user}/roles/{role}).
 * Safe to run on every event: nothing is recorded unless the role changes.
 */
export async function syncCommunityRole(
  tx: DbTransaction,
  clerkUserId: string,
  subscriptionStatus: string | null,
): Promise<void> {
  // Lock the member's row first, so two events for the same member take turns
  // and each reads the subscriptions the other has already committed.
  await tx.insert(payMembers).values({ clerkUserId }).onConflictDoNothing()
  const [member] = await tx
    .select()
    .from(payMembers)
    .where(eq(payMembers.clerkUserId, clerkUserId))
    .for('update')

  const rows = await tx
    .select()
    .from(paySubscriptions)
    .where(
      and(
        eq(paySubscriptions.clerkUserId, clerkUserId),
        eq(paySubscriptions.module, MODULE),
        isNull(paySubscriptions.testClockRunId),
      ),
    )
    .orderBy(desc(paySubscriptions.updatedAt))
  const level = levelOf(rows.find((row) => accessFor(row.status) !== 'none'))
  const role = level ? levelNames[level] : null

  if ((member?.communityRole ?? null) === role) {
    return
  }
  await tx
    .update(payMembers)
    .set({ communityRole: role, updatedAt: new Date() })
    .where(eq(payMembers.clerkUserId, clerkUserId))
  await tx.insert(payMemberRoleChanges).values({
    clerkUserId,
    fromRole: member?.communityRole ?? null,
    toRole: role,
    subscriptionStatus,
  })
}

/* ---------- contributions: invoices and tips ---------- */

const invoiceReasons: Record<string, string> = {
  subscription_create: 'Joined',
  subscription_cycle: 'Renewal',
  subscription_update: 'Change',
}

/**
 * Records a paid membership invoice: first payment, renewal, or the prorated
 * charge for moving up. Runs after the shared handler has synced the subscription.
 */
export async function recordInvoiceContribution(tx: DbTransaction, invoiceId: string): Promise<void> {
  const invoice = await getStripe().invoices.retrieve(invoiceId)
  const subscriptionId = subscriptionIdOfInvoice(invoice)
  // Credit-only invoices (moving down) are "paid" with nothing charged.
  if (!invoice.id || !subscriptionId || invoice.amount_paid <= 0) {
    return
  }
  const row = await tx.query.paySubscriptions.findFirst({
    where: eq(paySubscriptions.id, subscriptionId),
  })
  if (!row || row.module !== MODULE || row.testClockRunId) {
    return
  }

  const reason = invoiceReasons[invoice.billing_reason ?? ''] ?? 'Payment'
  const paidAt = invoice.status_transitions.paid_at
  await tx
    .insert(payContributions)
    .values({
      clerkUserId: row.clerkUserId,
      kind: 'membership',
      sourceId: invoice.id,
      subscriptionId,
      description: `${reason}: ${toMembershipView(row).name}`,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      paidAt: paidAt ? new Date(paidAt * 1000) : new Date(),
    })
    .onConflictDoNothing()
}

/** Records a paid tip with the note the tipper typed on Stripe's page. */
export async function recordTip(
  tx: DbTransaction,
  order: PayOrder,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const note = session.custom_fields.find((field) => field.key === 'message')?.text?.value?.trim()
  await tx
    .insert(payContributions)
    .values({
      clerkUserId: order.clerkUserId,
      kind: 'tip',
      sourceId: order.paymentIntentId ?? `order:${order.id}`,
      orderId: order.id,
      description: 'Tip',
      amount: order.amountTotal ?? 0,
      currency: order.currency ?? 'usd',
      message: note || null,
      paidAt: order.paidAt ?? new Date(),
    })
    .onConflictDoNothing()
}

/** Keeps a tip's refunded amount in step with its order, so totals stay honest. */
export async function syncTipRefund(tx: DbTransaction, order: PayOrder, refunded: number): Promise<void> {
  await tx
    .update(payContributions)
    .set({ amountRefunded: refunded })
    .where(eq(payContributions.orderId, order.id))
}

/* ---------- what members see ---------- */

export interface ContributionView {
  id: number
  kind: 'membership' | 'tip'
  description: string
  amount: number
  amountRefunded: number
  currency: string
  message: string | null
  paidAt: string
  /** Tips only: the order, for the seller's refund and dispute buttons. */
  order: {
    id: string
    status: PayOrder['status']
    amountTotal: number | null
    amountRefunded: number
    currency: string | null
  } | null
}

export interface RoleChangeView {
  id: number
  fromRole: string | null
  toRole: string | null
  subscriptionStatus: string | null
  createdAt: string
}

export interface MemberSummary {
  wallName: string | null
  communityRole: string | null
  memberSince: string | null
  totalContributed: number
  contributions: ContributionView[]
  roleChanges: RoleChangeView[]
}

/** Net of refunds, so a refunded tip stops counting. */
const netTotal = sql<number>`coalesce(sum(${payContributions.amount} - ${payContributions.amountRefunded}), 0)`.mapWith(Number)
/** The first paid membership invoice. Tips alone don't make someone a member. */
const firstMembershipPayment = sql<Date | null>`min(${payContributions.paidAt}) filter (where ${payContributions.kind} = 'membership')`.mapWith(payContributions.paidAt)

export async function getMemberSummary(clerkUserId: string): Promise<MemberSummary> {
  const [member, [totals], contributions, roleChanges] = await Promise.all([
    db.query.payMembers.findFirst({ where: eq(payMembers.clerkUserId, clerkUserId) }),
    db
      .select({ total: netTotal, memberSince: firstMembershipPayment })
      .from(payContributions)
      .where(eq(payContributions.clerkUserId, clerkUserId)),
    db
      .select({ contribution: payContributions, order: payOrders })
      .from(payContributions)
      .leftJoin(payOrders, eq(payOrders.id, payContributions.orderId))
      .where(eq(payContributions.clerkUserId, clerkUserId))
      .orderBy(desc(payContributions.paidAt))
      .limit(20),
    db
      .select()
      .from(payMemberRoleChanges)
      .where(eq(payMemberRoleChanges.clerkUserId, clerkUserId))
      .orderBy(desc(payMemberRoleChanges.id))
      .limit(10),
  ])

  return {
    wallName: member?.wallName ?? null,
    communityRole: member?.communityRole ?? null,
    memberSince: totals?.memberSince?.toISOString() ?? null,
    totalContributed: totals?.total ?? 0,
    contributions: contributions.map(({ contribution, order }) => ({
      id: contribution.id,
      kind: contribution.kind,
      description: contribution.description,
      amount: contribution.amount,
      amountRefunded: contribution.amountRefunded,
      currency: contribution.currency,
      message: contribution.message,
      paidAt: contribution.paidAt.toISOString(),
      order: order
        ? {
            id: order.id,
            status: order.status,
            amountTotal: order.amountTotal,
            amountRefunded: order.amountRefunded,
            currency: order.currency,
          }
        : null,
    })),
    roleChanges: roleChanges.map((change) => ({
      id: change.id,
      fromRole: change.fromRole,
      toRole: change.toRole,
      subscriptionStatus: change.subscriptionStatus,
      createdAt: change.createdAt.toISOString(),
    })),
  }
}

export interface WallEntry {
  key: string
  name: string | null
  level: MemberLevel | null
  memberSince: string | null
  total: number
  latestMessage: string | null
  isYou: boolean
}

/** Everyone who has given anything, biggest total first. Names only if they set one. */
export async function getSupporterWall(viewerId: string | null): Promise<WallEntry[]> {
  const totals = await db
    .select({
      clerkUserId: payContributions.clerkUserId,
      total: netTotal,
      memberSince: firstMembershipPayment,
    })
    .from(payContributions)
    .groupBy(payContributions.clerkUserId)
    .orderBy(desc(netTotal))
    .limit(20)

  const userIds = totals.filter((row) => row.total > 0).map((row) => row.clerkUserId)
  if (userIds.length === 0) {
    return []
  }

  const [members, subscriptions, messages] = await Promise.all([
    db.select().from(payMembers).where(inArray(payMembers.clerkUserId, userIds)),
    db
      .select()
      .from(paySubscriptions)
      .where(
        and(
          inArray(paySubscriptions.clerkUserId, userIds),
          eq(paySubscriptions.module, MODULE),
          isNull(paySubscriptions.testClockRunId),
        ),
      ),
    db
      .selectDistinctOn([payContributions.clerkUserId], {
        clerkUserId: payContributions.clerkUserId,
        message: payContributions.message,
      })
      .from(payContributions)
      .where(
        and(
          inArray(payContributions.clerkUserId, userIds),
          isNotNull(payContributions.message),
          eq(payContributions.amountRefunded, 0),
        ),
      )
      .orderBy(payContributions.clerkUserId, desc(payContributions.paidAt)),
  ])

  return totals
    .filter((row) => row.total > 0)
    .map((row, index) => {
      const live = subscriptions.find(
        (sub) => sub.clerkUserId === row.clerkUserId && accessFor(sub.status) !== 'none',
      )
      return {
        // Position, not the Clerk ID: the wall is public, user IDs aren't.
        key: `supporter-${index}`,
        name: members.find((member) => member.clerkUserId === row.clerkUserId)?.wallName ?? null,
        level: levelOf(live),
        memberSince: row.memberSince?.toISOString() ?? null,
        total: row.total,
        latestMessage: messages.find((message) => message.clerkUserId === row.clerkUserId)?.message ?? null,
        isYou: row.clerkUserId === viewerId,
      }
    })
}

export async function setWallName(clerkUserId: string, name: string | null): Promise<void> {
  await db
    .insert(payMembers)
    .values({ clerkUserId, wallName: name })
    .onConflictDoUpdate({ target: payMembers.clerkUserId, set: { wallName: name, updatedAt: new Date() } })
}

export interface FeedPost {
  id: string
  title: string
  publishedOn: string
  teaser: string
  minLevel: MemberLevel | null
  /** Null when the viewer's level doesn't unlock it: the text never leaves the server. */
  body: string | null
}

export async function getFeed(clerkUserId: string | null) {
  const level = clerkUserId ? await getLevel(clerkUserId) : null
  const feed: FeedPost[] = posts.map((post) => {
    const unlocked = post.minLevel === null || reaches(level, post.minLevel)
    return {
      id: post.id,
      title: post.title,
      publishedOn: post.publishedOn,
      teaser: post.teaser,
      minLevel: post.minLevel,
      body: unlocked ? post.body : null,
    }
  })
  return { level, posts: feed }
}

/* ---------- prices and checkout pieces ---------- */

export async function loadPrices(): Promise<Record<string, number | null>> {
  const lookupKeys = tiers.flatMap((tier) => [
    tierLookupKey(tier.key, 'month'),
    tierLookupKey(tier.key, 'year'),
  ])
  const { data } = await getStripe().prices.list({
    lookup_keys: [...lookupKeys, tipJar.lookupKey],
    active: true,
    limit: 20,
  })
  const prices: Record<string, number | null> = {}
  for (const price of data) {
    if (price.lookup_key) {
      prices[price.lookup_key] = price.unit_amount
    }
  }
  return prices
}

async function findPrice(lookupKey: string): Promise<Stripe.Price> {
  const {
    data: [price],
  } = await getStripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (!price) {
    throw new Error('The membership catalog is not in your sandbox yet. Run npm run stripe:seed membership.')
  }
  return price
}

export function findTierPrice(tier: TierKey, interval: MembershipInterval) {
  return findPrice(tierLookupKey(tier, interval))
}

export function findTipPrice() {
  return findPrice(tipJar.lookupKey)
}

/**
 * Pay what you want, as an inline price. Checkout creates a new Price on the
 * Custom support product for this amount; no Price is created ahead of time.
 */
export function customSupportPriceData(dollars: number) {
  return {
    currency: 'usd',
    product: customSupport.productId,
    recurring: { interval: 'month' as const },
    unit_amount: dollars * 100,
  }
}

/* ---------- changes after joining ---------- */

/**
 * A new monthly amount for a pay-what-you-want member. Raising it charges
 * the difference for the rest of the month now; lowering it leaves a credit
 * for the next renewal. If the charge fails, nothing changes.
 */
export async function changeCustomAmount(clerkUserId: string, dollars: number) {
  const row = await requireLiveMembership(clerkUserId)
  const item = row.items[0]
  if (!item || item.productId !== customSupport.productId) {
    throw new Error('Tier memberships change tier in Manage billing.')
  }
  if (item.unitAmount === dollars * 100) {
    throw new Error('That is already your monthly amount.')
  }

  const updated = await getStripe().subscriptions.update(row.id, {
    items: [{ id: item.id, price_data: customSupportPriceData(dollars) }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
    expand: ['latest_invoice'],
  })
  if (updated.pending_update) {
    await discardPendingUpdate(updated)
    throw new Error("Your card was declined, so your amount wasn't changed.")
  }

  await db.transaction(async (tx) => {
    const result = await syncSubscription(tx, row.id)
    if (result) {
      await syncCommunityRole(tx, clerkUserId, result.row.status)
    }
  })

  const invoice = typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null
  return {
    charged: invoice?.amount_paid ?? 0,
    total: invoice?.total ?? 0,
    currency: invoice?.currency ?? row.currency,
  }
}

/** Cancel at the end of the paid period (access stays until then), or undo that. */
export async function setCancelAtPeriodEnd(clerkUserId: string, cancel: boolean): Promise<void> {
  const row = await requireLiveMembership(clerkUserId)
  await getStripe().subscriptions.update(row.id, { cancel_at_period_end: cancel })
  await db.transaction((tx) => syncSubscription(tx, row.id))
}

/** Stripe's hosted page for switching tiers, updating the card or cancelling. */
export async function createMembershipPortalLink(clerkUserId: string): Promise<string> {
  const row = await getCurrentSubscription(clerkUserId, MODULE)
  if (!row) {
    throw new Error('Join first, then manage your membership here.')
  }
  return createPortalSession({
    customerId: row.stripeCustomerId,
    configurationKey: MEMBERSHIP_PORTAL_KEY,
    returnPath: '/stripe/membership',
  })
}
