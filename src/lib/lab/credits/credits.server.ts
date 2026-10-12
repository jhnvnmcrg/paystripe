import { and, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import type { PayOrder } from '#/db/pay-schema'
import { payCreditAccounts, payCreditLedger, payCreditRecharges, payOrderItems, payOrders } from '#/db/pay-schema'
import { getStripe } from '#/lib/stripe/client.server'
import { getOrCreateStripeCustomer } from '#/lib/stripe/customers.server'
import type { ActionKey, CreditPack, PackKey } from './catalog'
import { creditPacks, findAction, findPack, packForLookupKey } from './catalog'

const MODULE = 'credits'

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }
  return typeof value === 'string' ? value : value.id
}

/* ---------- the account ---------- */

async function ensureAccount(tx: DbTransaction, clerkUserId: string): Promise<void> {
  await tx.insert(payCreditAccounts).values({ clerkUserId }).onConflictDoNothing()
}

/** The account row, locked until the transaction ends, so balance changes take turns. */
async function lockAccount(tx: DbTransaction, clerkUserId: string) {
  await ensureAccount(tx, clerkUserId)
  const [account] = await tx
    .select()
    .from(payCreditAccounts)
    .where(eq(payCreditAccounts.clerkUserId, clerkUserId))
    .for('update')
  return account
}

export interface CreditAccountView {
  balance: number
  autoRecharge: boolean
  rechargeThreshold: number
  rechargePack: PackKey
  card: { brand: string; last4: string | null } | null
  rechargeError: string | null
}

export async function getAccount(clerkUserId: string): Promise<CreditAccountView> {
  const account = await db.query.payCreditAccounts.findFirst({
    where: eq(payCreditAccounts.clerkUserId, clerkUserId),
  })
  return {
    balance: account?.balance ?? 0,
    autoRecharge: account?.autoRecharge ?? false,
    rechargeThreshold: account?.rechargeThreshold ?? 100,
    rechargePack: findPack(account?.rechargePack)?.key ?? 'starter',
    card: account?.paymentMethodId ? { brand: account.cardBrand ?? 'card', last4: account.cardLast4 } : null,
    rechargeError: account?.rechargeError ?? null,
  }
}

export interface LedgerEntryView {
  id: number
  kind: (typeof payCreditLedger.$inferSelect)['kind']
  delta: number
  balanceAfter: number
  description: string
  createdAt: string
}

export async function listLedger(clerkUserId: string): Promise<LedgerEntryView[]> {
  const rows = await db
    .select()
    .from(payCreditLedger)
    .where(eq(payCreditLedger.clerkUserId, clerkUserId))
    .orderBy(desc(payCreditLedger.id))
    .limit(10)
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  }))
}

/* ---------- granting ---------- */

/**
 * Adds credits once per source (a Payment Intent ID). Returns false when this
 * source was already granted, so a repeated or second event changes nothing.
 */
export async function grantCredits(
  tx: DbTransaction,
  grant: {
    clerkUserId: string
    kind: 'purchase' | 'recharge'
    credits: number
    description: string
    sourceId: string
    orderId: string
  },
): Promise<boolean> {
  const account = await lockAccount(tx, grant.clerkUserId)
  const balanceAfter = account.balance + grant.credits
  const [entry] = await tx
    .insert(payCreditLedger)
    .values({ ...grant, delta: grant.credits, balanceAfter })
    .onConflictDoNothing({ target: payCreditLedger.sourceId })
    .returning({ id: payCreditLedger.id })
  if (!entry) {
    return false
  }
  await tx
    .update(payCreditAccounts)
    .set({ balance: balanceAfter, updatedAt: new Date() })
    .where(eq(payCreditAccounts.clerkUserId, grant.clerkUserId))
  return true
}

/** Remembers the card that just paid, for off-session top-ups. A new card clears an old failure. */
export async function saveCard(tx: DbTransaction, clerkUserId: string, paymentMethodId: string): Promise<void> {
  const method = await getStripe().paymentMethods.retrieve(paymentMethodId)
  await ensureAccount(tx, clerkUserId)
  await tx
    .update(payCreditAccounts)
    .set({
      paymentMethodId,
      cardBrand: method.card?.brand ?? method.type,
      cardLast4: method.card?.last4 ?? null,
      rechargeError: null,
      updatedAt: new Date(),
    })
    .where(eq(payCreditAccounts.clerkUserId, clerkUserId))
}

/**
 * The webhook for a paid pack: credits from the catalog, keyed by the Payment
 * Intent, and the card that paid is kept because Checkout set it up for later.
 */
export async function fulfillPackOrder(tx: DbTransaction, order: PayOrder): Promise<void> {
  const items = await tx.select().from(payOrderItems).where(eq(payOrderItems.orderId, order.id))
  const packs = items.flatMap((item) => {
    const pack = packForLookupKey(item.lookupKey)
    return pack ? [{ pack, quantity: item.quantity }] : []
  })
  const credits = packs.reduce((sum, { pack, quantity }) => sum + pack.credits * quantity, 0)
  if (credits > 0) {
    await grantCredits(tx, {
      clerkUserId: order.clerkUserId,
      kind: 'purchase',
      credits,
      description: packs.map(({ pack }) => pack.name).join(', '),
      sourceId: order.paymentIntentId ?? `order:${order.id}`,
      orderId: order.id,
    })
  }

  if (order.paymentIntentId) {
    const intent = await getStripe().paymentIntents.retrieve(order.paymentIntentId)
    const method = idOf(intent.payment_method)
    if (method) {
      await saveCard(tx, order.clerkUserId, method)
    }
  }
}

/* ---------- spending ---------- */

export type RechargeResult =
  | { status: 'succeeded'; credits: number }
  | { status: 'failed'; message: string }

export interface SpendResult {
  result: string
  balance: number
  recharge: RechargeResult | null
}

/**
 * Spends credits on an action. One conditional UPDATE does the check and the
 * deduction together, so two requests at once can't both spend the last credits.
 * If this spend took the balance below the threshold, auto-recharge runs.
 */
export async function spendCredits(clerkUserId: string, actionKey: ActionKey): Promise<SpendResult> {
  const action = findAction(actionKey)
  if (!action) {
    throw new Error('That action does not exist.')
  }

  const spent = await db.transaction(async (tx) => {
    await ensureAccount(tx, clerkUserId)
    const [account] = await tx
      .update(payCreditAccounts)
      .set({ balance: sql`${payCreditAccounts.balance} - ${action.cost}`, updatedAt: new Date() })
      .where(and(eq(payCreditAccounts.clerkUserId, clerkUserId), gte(payCreditAccounts.balance, action.cost)))
      .returning()
    if (!account) {
      const current = await tx.query.payCreditAccounts.findFirst({
        where: eq(payCreditAccounts.clerkUserId, clerkUserId),
      })
      throw new Error(
        `${action.name} needs ${action.cost} credits and you have ${current?.balance ?? 0}. Buy a pack to continue.`,
      )
    }
    const [entry] = await tx
      .insert(payCreditLedger)
      .values({
        clerkUserId,
        kind: 'spend',
        delta: -action.cost,
        balanceAfter: account.balance,
        description: action.name,
      })
      .returning({ id: payCreditLedger.id })
    const before = account.balance + action.cost
    return {
      balance: account.balance,
      entryId: entry.id,
      crossed: account.autoRecharge && before >= account.rechargeThreshold && account.balance < account.rechargeThreshold,
    }
  })

  // Charged after the spend is committed: a slow or failed card never undoes the action.
  const recharge = spent.crossed ? await rechargeNow(clerkUserId, `spend-${spent.entryId}`) : null
  return {
    result: action.result,
    balance: recharge?.status === 'succeeded' ? (await getAccount(clerkUserId)).balance : spent.balance,
    recharge,
  }
}

/* ---------- auto-recharge ---------- */

async function findPackPrice(pack: CreditPack): Promise<Stripe.Price> {
  const {
    data: [price],
  } = await getStripe().prices.list({ lookup_keys: [pack.lookupKey], active: true, limit: 1 })
  if (!price?.unit_amount) {
    throw new Error('The credit packs are not in your sandbox yet. Run npm run stripe:seed credits.')
  }
  return price
}

function isCardError(error: unknown): error is Stripe.errors.StripeCardError {
  return error instanceof Error && 'type' in error && error.type === 'StripeCardError'
}

/** The webhook (or the request that charged): the top-up went through. */
export async function completeRecharge(tx: DbTransaction, intent: Stripe.PaymentIntent): Promise<void> {
  const attempt = intent.metadata.recharge_id
    ? await tx.query.payCreditRecharges.findFirst({ where: eq(payCreditRecharges.id, intent.metadata.recharge_id) })
    : undefined
  if (!attempt || intent.status !== 'succeeded') {
    return
  }
  await tx
    .update(payOrders)
    .set({
      status: 'paid',
      paymentIntentId: intent.id,
      currency: intent.currency,
      amountSubtotal: intent.amount_received,
      amountTotal: intent.amount_received,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(payOrders.id, attempt.orderId), eq(payOrders.status, 'pending')))
  await tx
    .update(payCreditRecharges)
    .set({ status: 'succeeded', paymentIntentId: intent.id, error: null })
    .where(eq(payCreditRecharges.id, attempt.id))
  const granted = await grantCredits(tx, {
    clerkUserId: attempt.clerkUserId,
    kind: 'recharge',
    credits: attempt.credits,
    description: `Auto-recharge: ${findPack(attempt.pack)?.name ?? attempt.pack}`,
    sourceId: intent.id,
    orderId: attempt.orderId,
  })
  if (granted) {
    await tx
      .update(payCreditAccounts)
      .set({ rechargeError: null })
      .where(eq(payCreditAccounts.clerkUserId, attempt.clerkUserId))
  }
}

/**
 * The top-up was declined. Auto-recharge turns itself off, so a bad card isn't
 * retried on every action, and the page asks for a new card.
 */
export async function failRecharge(
  tx: DbTransaction,
  rechargeId: string,
  paymentIntentId: string | null,
  message: string,
): Promise<void> {
  const [attempt] = await tx
    .update(payCreditRecharges)
    .set({ status: 'failed', error: message, paymentIntentId })
    .where(and(eq(payCreditRecharges.id, rechargeId), eq(payCreditRecharges.status, 'pending')))
    .returning()
  if (!attempt) {
    return
  }
  await tx
    .update(payOrders)
    .set({ status: 'failed', paymentIntentId, updatedAt: new Date() })
    .where(and(eq(payOrders.id, attempt.orderId), eq(payOrders.status, 'pending')))
  await tx
    .update(payCreditAccounts)
    .set({ autoRecharge: false, rechargeError: message, updatedAt: new Date() })
    .where(eq(payCreditAccounts.clerkUserId, attempt.clerkUserId))
}

/**
 * Charges the saved card for the chosen pack, with nobody at the keyboard.
 * `anchor` names what triggered it; with the card, it forms the idempotency
 * key, so one trigger can never charge twice, even if this runs again.
 */
async function rechargeNow(clerkUserId: string, anchor: string): Promise<RechargeResult | null> {
  const account = await db.query.payCreditAccounts.findFirst({
    where: eq(payCreditAccounts.clerkUserId, clerkUserId),
  })
  if (!account?.autoRecharge || !account.paymentMethodId) {
    return null
  }
  const pack = findPack(account.rechargePack) ?? creditPacks[0]
  const price = await findPackPrice(pack)
  const triggerKey = `${anchor}:${account.paymentMethodId}`

  const attempt = await db.transaction(async (tx) => {
    const existing = await tx.query.payCreditRecharges.findFirst({
      where: eq(payCreditRecharges.triggerKey, triggerKey),
    })
    if (existing) {
      return existing
    }
    const [order] = await tx
      .insert(payOrders)
      .values({
        module: MODULE,
        clerkUserId,
        currency: price.currency,
        amountSubtotal: price.unit_amount,
        amountTotal: price.unit_amount,
        fulfillmentStatus: 'recharge',
      })
      .returning({ id: payOrders.id })
    const [created] = await tx
      .insert(payCreditRecharges)
      .values({ clerkUserId, triggerKey, orderId: order.id, pack: pack.key, credits: pack.credits })
      .returning()
    return created
  })
  if (attempt.status === 'succeeded') {
    return { status: 'succeeded', credits: attempt.credits }
  }
  if (attempt.status === 'failed') {
    return { status: 'failed', message: attempt.error ?? 'This top-up was already declined.' }
  }

  try {
    const intent = await getStripe().paymentIntents.create(
      {
        amount: price.unit_amount ?? pack.price,
        currency: price.currency,
        customer: await getOrCreateStripeCustomer(clerkUserId),
        payment_method: account.paymentMethodId,
        // The customer isn't here to approve it; Stripe applies off-session rules.
        off_session: true,
        confirm: true,
        description: `Auto-recharge: ${pack.name}`,
        metadata: { lab_module: MODULE, lab_kind: 'recharge', recharge_id: attempt.id, order_id: attempt.orderId },
      },
      { idempotencyKey: `recharge:${clerkUserId}:${triggerKey}` },
    )
    if (intent.status === 'succeeded') {
      await db.transaction((tx) => completeRecharge(tx, intent))
      return { status: 'succeeded', credits: attempt.credits }
    }
    const message = 'Your bank wants to confirm this payment, which needs you present. Buy a pack instead.'
    await db.transaction((tx) => failRecharge(tx, attempt.id, intent.id, message))
    return { status: 'failed', message }
  } catch (error) {
    // Off-session declines come back as errors right away (card_declined, authentication_required).
    if (isCardError(error)) {
      const message = error.message
      await db.transaction((tx) => failRecharge(tx, attempt.id, error.payment_intent?.id ?? null, message))
      return { status: 'failed', message }
    }
    throw error
  }
}

export interface AutoRechargeSettings {
  enabled: boolean
  threshold: number
  pack: PackKey
}

/**
 * Saves the settings. If the balance is already under the new threshold,
 * tops up straight away instead of waiting for the next action.
 */
export async function saveAutoRecharge(
  clerkUserId: string,
  settings: AutoRechargeSettings,
): Promise<RechargeResult | null> {
  const account = await db.transaction(async (tx) => {
    const current = await lockAccount(tx, clerkUserId)
    if (settings.enabled && !current.paymentMethodId) {
      throw new Error('Auto-recharge charges a saved card. Buy a pack or save a card first.')
    }
    const [updated] = await tx
      .update(payCreditAccounts)
      .set({
        autoRecharge: settings.enabled,
        rechargeThreshold: settings.threshold,
        rechargePack: settings.pack,
        // Turning it back on is the customer's answer to the failure banner.
        rechargeError: settings.enabled ? null : current.rechargeError,
        updatedAt: new Date(),
      })
      .where(eq(payCreditAccounts.clerkUserId, clerkUserId))
      .returning()
    return updated
  })

  if (!settings.enabled || account.balance >= settings.threshold) {
    return null
  }
  const [latest] = await db
    .select({ id: payCreditLedger.id })
    .from(payCreditLedger)
    .where(eq(payCreditLedger.clerkUserId, clerkUserId))
    .orderBy(desc(payCreditLedger.id))
    .limit(1)
  return rechargeNow(clerkUserId, `enable-${latest?.id ?? 0}`)
}

/* ---------- refunds take credits back ---------- */

/**
 * After a refund, removes the share of the order's credits that was refunded.
 * Never below zero: credits already spent can't be taken back, and the ledger says so.
 */
export async function clawBack(tx: DbTransaction, order: PayOrder, refunded: number): Promise<void> {
  const [totals] = await tx
    .select({
      granted: sql<number>`coalesce(sum(${payCreditLedger.delta}) filter (where ${payCreditLedger.delta} > 0), 0)`.mapWith(Number),
      taken: sql<number>`coalesce(-sum(${payCreditLedger.delta}) filter (where ${payCreditLedger.kind} = 'clawback'), 0)`.mapWith(Number),
    })
    .from(payCreditLedger)
    .where(eq(payCreditLedger.orderId, order.id))
  const total = order.amountTotal ?? 0
  const target = total > 0 ? Math.min(totals.granted, Math.round((totals.granted * refunded) / total)) : totals.granted
  const owed = target - totals.taken
  if (owed <= 0) {
    return
  }

  const account = await lockAccount(tx, order.clerkUserId)
  const take = Math.min(owed, account.balance)
  const [entry] = await tx
    .insert(payCreditLedger)
    .values({
      clerkUserId: order.clerkUserId,
      kind: 'clawback',
      delta: -take,
      balanceAfter: account.balance - take,
      description:
        take < owed
          ? `Refund: took back ${take} of ${owed} credits (the rest were already spent)`
          : `Refund: took back ${take} credits`,
      sourceId: `clawback:${order.id}:${refunded}`,
      orderId: order.id,
    })
    .onConflictDoNothing({ target: payCreditLedger.sourceId })
    .returning({ id: payCreditLedger.id })
  if (entry && take > 0) {
    await tx
      .update(payCreditAccounts)
      .set({ balance: account.balance - take, updatedAt: new Date() })
      .where(eq(payCreditAccounts.clerkUserId, order.clerkUserId))
  }
}

/* ---------- purchases ---------- */

export interface CreditPurchaseView {
  id: string
  kind: 'pack' | 'recharge'
  status: PayOrder['status']
  amountTotal: number | null
  amountRefunded: number
  currency: string | null
  credits: number
  creditsTakenBack: number
  error: string | null
  createdAt: string
}

/** Packs bought and automatic top-ups, newest first. Unfinished checkouts are left out. */
export async function listPurchases(clerkUserId: string): Promise<CreditPurchaseView[]> {
  const orders = await db
    .select()
    .from(payOrders)
    .where(
      and(
        eq(payOrders.clerkUserId, clerkUserId),
        eq(payOrders.module, MODULE),
        notInArray(payOrders.status, ['pending', 'expired']),
      ),
    )
    .orderBy(desc(payOrders.createdAt))
    .limit(10)
  if (orders.length === 0) {
    return []
  }
  const ids = orders.map((order) => order.id)
  const [recharges, credited] = await Promise.all([
    db.select().from(payCreditRecharges).where(inArray(payCreditRecharges.orderId, ids)),
    db
      .select({
        orderId: payCreditLedger.orderId,
        granted: sql<number>`coalesce(sum(${payCreditLedger.delta}) filter (where ${payCreditLedger.delta} > 0), 0)`.mapWith(Number),
        taken: sql<number>`coalesce(-sum(${payCreditLedger.delta}) filter (where ${payCreditLedger.kind} = 'clawback'), 0)`.mapWith(Number),
      })
      .from(payCreditLedger)
      .where(inArray(payCreditLedger.orderId, ids))
      .groupBy(payCreditLedger.orderId),
  ])

  return orders.map((order) => {
    const recharge = recharges.find((row) => row.orderId === order.id)
    const ledger = credited.find((row) => row.orderId === order.id)
    return {
      id: order.id,
      kind: recharge ? 'recharge' : 'pack',
      status: order.status,
      amountTotal: order.amountTotal,
      amountRefunded: order.amountRefunded,
      currency: order.currency,
      credits: ledger?.granted ?? recharge?.credits ?? 0,
      creditsTakenBack: ledger?.taken ?? 0,
      error: recharge?.error ?? null,
      createdAt: order.createdAt.toISOString(),
    }
  })
}

/** Live prices for the packs, by lookup key. */
export async function loadPackPrices(): Promise<Record<string, number | null>> {
  const { data } = await getStripe().prices.list({
    lookup_keys: creditPacks.map((pack) => pack.lookupKey),
    active: true,
    limit: 10,
  })
  const prices: Record<string, number | null> = {}
  for (const price of data) {
    if (price.lookup_key) {
      prices[price.lookup_key] = price.unit_amount
    }
  }
  return prices
}

export async function findPackPriceId(pack: CreditPack): Promise<string> {
  return (await findPackPrice(pack)).id
}
