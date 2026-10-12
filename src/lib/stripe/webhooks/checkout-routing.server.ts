import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { DbTransaction } from '#/db/index'
import type { PayCheckoutSession } from '#/db/pay-schema'
import { payCheckoutSessions } from '#/db/pay-schema'
import { isLabModuleSlug } from '#/lib/lab/modules'
import { getStripe } from '#/lib/stripe/client.server'
import { moduleHandlers } from './modules.server'

/** The routing row written when a lab module created this Checkout Session. */
export function findCheckoutRoute(
  tx: DbTransaction,
  sessionId: string,
): Promise<PayCheckoutSession | undefined> {
  return tx.query.payCheckoutSessions.findFirst({
    where: eq(payCheckoutSessions.sessionId, sessionId),
  })
}

/**
 * Runs the owning module's fulfillment for a paid session.
 * `unpaid` means a delayed payment method is still processing: nothing is granted yet.
 * Module handlers are idempotent, so calling this twice for one session is safe.
 */
export async function fulfillPaidCheckout(
  tx: DbTransaction,
  session: Stripe.Checkout.Session,
  checkout: PayCheckoutSession,
): Promise<void> {
  if (session.payment_status === 'unpaid' || !isLabModuleSlug(checkout.module)) {
    return
  }
  await moduleHandlers[checkout.module]?.onCheckoutPaid?.(session, { tx, checkout })
}

/**
 * Stripe doesn't guarantee event order. A refund or dispute can arrive before
 * `checkout.session.completed` has been processed, when no order carries the
 * payment yet. This finds the Checkout Session behind the payment and fulfills it
 * first, so the refund or dispute has an order to act on.
 */
export async function catchUpCheckoutForPayment(
  tx: DbTransaction,
  paymentIntentId: string,
): Promise<void> {
  const {
    data: [session],
  } = await getStripe().checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 })
  if (!session) {
    return
  }
  const checkout = await findCheckoutRoute(tx, session.id)
  if (checkout) {
    await fulfillPaidCheckout(tx, session, checkout)
  }
}
