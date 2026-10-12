import { eq } from 'drizzle-orm'
import type { DbTransaction } from '#/db/index'
import type { PayOrder } from '#/db/pay-schema'
import { payOrders } from '#/db/pay-schema'
import { isLabModuleSlug } from '#/lib/lab/modules'
import { getStripe } from '#/lib/stripe/client.server'
import { catchUpCheckoutForPayment } from './checkout-routing.server'
import { moduleHandlers } from './modules.server'
import type { EventOf, WebhookContext } from './types'

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }
  return typeof value === 'string' ? value : value.id
}

/**
 * The lab order paid by this Payment Intent. If the refund or dispute arrived
 * before `checkout.session.completed` was processed, the checkout is fulfilled
 * first, so the order exists and has its keys or files to act on.
 */
async function findOrderForPayment(
  tx: DbTransaction,
  paymentIntentId: string,
): Promise<PayOrder | undefined> {
  const byPayment = () =>
    tx.query.payOrders.findFirst({ where: eq(payOrders.paymentIntentId, paymentIntentId) })

  const order = await byPayment()
  if (order) {
    return order
  }
  await catchUpCheckoutForPayment(tx, paymentIntentId)
  return byPayment()
}

/**
 * Full and partial refunds both arrive as `charge.refunded`.
 * The charge is re-fetched so the refunded amount is current, not a snapshot.
 */
export async function handleChargeRefunded(
  event: EventOf<'charge.refunded'>,
  { tx }: WebhookContext,
): Promise<void> {
  const charge = await getStripe().charges.retrieve(event.data.object.id)
  const paymentIntentId = idOf(charge.payment_intent)
  const existing = paymentIntentId ? await findOrderForPayment(tx, paymentIntentId) : undefined
  if (!existing) {
    return
  }

  const fullyRefunded = charge.refunded
  const [order] = await tx
    .update(payOrders)
    .set({
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
      amountRefunded: charge.amount_refunded,
      updatedAt: new Date(),
    })
    .where(eq(payOrders.id, existing.id))
    .returning()

  if (isLabModuleSlug(order.module)) {
    await moduleHandlers[order.module]?.onOrderRefunded?.(order, { tx, fullyRefunded })
  }
}

/** A buyer disputed the charge with their bank. Each module decides what to suspend. */
export async function handleDisputeCreated(
  event: EventOf<'charge.dispute.created'>,
  { tx }: WebhookContext,
): Promise<void> {
  const paymentIntentId = idOf(event.data.object.payment_intent)
  const existing = paymentIntentId ? await findOrderForPayment(tx, paymentIntentId) : undefined
  if (!existing) {
    return
  }

  const [order] = await tx
    .update(payOrders)
    .set({ status: 'disputed', updatedAt: new Date() })
    .where(eq(payOrders.id, existing.id))
    .returning()

  if (isLabModuleSlug(order.module)) {
    await moduleHandlers[order.module]?.onOrderDisputed?.(order, { tx })
  }
}

/** The dispute is over. A won dispute restores the order; a lost one leaves it unpaid for good. */
export async function handleDisputeClosed(
  event: EventOf<'charge.dispute.closed'>,
  { tx }: WebhookContext,
): Promise<void> {
  const dispute = await getStripe().disputes.retrieve(event.data.object.id)
  const paymentIntentId = idOf(dispute.payment_intent)
  const outcome =
    dispute.status === 'won' ? 'won' : dispute.status === 'lost' ? 'lost' : null
  if (!paymentIntentId || !outcome) {
    return
  }

  const existing = await findOrderForPayment(tx, paymentIntentId)
  if (!existing) {
    return
  }

  const restoredStatus = existing.amountRefunded > 0 ? 'partially_refunded' : 'paid'
  const [order] = await tx
    .update(payOrders)
    .set({
      status: outcome === 'won' ? restoredStatus : 'dispute_lost',
      updatedAt: new Date(),
    })
    .where(eq(payOrders.id, existing.id))
    .returning()

  if (isLabModuleSlug(order.module)) {
    await moduleHandlers[order.module]?.onDisputeClosed?.(order, { tx, outcome })
  }
}
