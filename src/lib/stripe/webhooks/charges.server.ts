import { eq } from 'drizzle-orm'
import { payOrders } from '#/db/pay-schema'
import { isLabModuleSlug } from '#/lib/lab/modules'
import { getStripe } from '#/lib/stripe/client.server'
import { moduleHandlers } from './modules.server'
import type { EventOf, WebhookContext } from './types'

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }
  return typeof value === 'string' ? value : value.id
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
  if (!paymentIntentId) {
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
    .where(eq(payOrders.paymentIntentId, paymentIntentId))
    .returning()

  if (order && isLabModuleSlug(order.module)) {
    await moduleHandlers[order.module]?.onOrderRefunded?.(order, { tx, fullyRefunded })
  }
}

/** A buyer disputed the charge with their bank. Each module decides what to suspend. */
export async function handleDisputeCreated(
  event: EventOf<'charge.dispute.created'>,
  { tx }: WebhookContext,
): Promise<void> {
  const paymentIntentId = idOf(event.data.object.payment_intent)
  if (!paymentIntentId) {
    return
  }

  const [order] = await tx
    .update(payOrders)
    .set({ status: 'disputed', updatedAt: new Date() })
    .where(eq(payOrders.paymentIntentId, paymentIntentId))
    .returning()

  if (order && isLabModuleSlug(order.module)) {
    await moduleHandlers[order.module]?.onOrderDisputed?.(order, { tx })
  }
}
