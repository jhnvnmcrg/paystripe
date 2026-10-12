import type { PayOrder } from '#/db/pay-schema'
import { getStripe } from '#/lib/stripe/client.server'

/*
 * "As the seller" actions shared by every one-time-purchase module.
 * They only ask Stripe to do something. The webhooks that follow change the
 * order and whatever the module granted (keys, downloads, shipments).
 */

/** Refunds part or all of what's left on a paid order. */
export async function requestRefund(order: PayOrder, amount?: number): Promise<void> {
  if (!order.paymentIntentId || !['paid', 'partially_refunded'].includes(order.status)) {
    throw new Error('Only paid orders can be refunded.')
  }
  const remaining = (order.amountTotal ?? 0) - order.amountRefunded
  if (amount !== undefined && amount > remaining) {
    throw new Error('That is more than is left to refund.')
  }

  // Keyed to the order's refund state, so a double-click can't refund twice.
  await getStripe().refunds.create(
    {
      payment_intent: order.paymentIntentId,
      amount,
      metadata: { lab_module: order.module, order_id: order.id },
    },
    { idempotencyKey: `refund:${order.id}:${order.amountRefunded}:${amount ?? 'rest'}` },
  )
}

/**
 * Answers a test dispute. In a sandbox, the evidence text `winning_evidence`
 * or `losing_evidence` decides the outcome, then `charge.dispute.closed` arrives.
 */
export async function resolveTestDispute(
  order: PayOrder,
  outcome: 'won' | 'lost',
): Promise<void> {
  if (order.status !== 'disputed' || !order.paymentIntentId) {
    throw new Error('This order has no open dispute.')
  }

  const stripe = getStripe()
  const {
    data: [dispute],
  } = await stripe.disputes.list({ payment_intent: order.paymentIntentId, limit: 1 })
  if (!dispute) {
    throw new Error('Stripe has not opened the dispute yet. Try again in a few seconds.')
  }

  await stripe.disputes.update(dispute.id, {
    evidence: { uncategorized_text: outcome === 'won' ? 'winning_evidence' : 'losing_evidence' },
    submit: true,
  })
}
