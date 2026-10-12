import * as Sentry from '@sentry/tanstackstart-react'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import { db } from '#/db/index'
import { payCustomers, payStripeEvents } from '#/db/pay-schema'
import { isLabModuleSlug } from '#/lib/lab/modules'
import { getStripe, getWebhookSecret } from '#/lib/stripe/client.server'
import {
  handleChargeRefunded,
  handleDisputeClosed,
  handleDisputeCreated,
} from './charges.server'
import { findCheckoutRoute, fulfillPaidCheckout } from './checkout-routing.server'
import { extraEventHandlers, moduleHandlers } from './modules.server'
import type { EventOf, RegisteredEventHandler, WebhookContext } from './types'
import { onEvent } from './types'

type CheckoutEventType =
  | 'checkout.session.completed'
  | 'checkout.session.async_payment_succeeded'
  | 'checkout.session.async_payment_failed'
  | 'checkout.session.expired'

/**
 * Sends `checkout.session.*` events to the module that created the session,
 * using the routing row written by createLabCheckoutSession.
 */
async function routeCheckoutEvent(
  event: EventOf<CheckoutEventType>,
  { tx }: WebhookContext,
): Promise<void> {
  const sessionId = event.data.object.id
  const checkout = await findCheckoutRoute(tx, sessionId)

  if (!checkout) {
    if (event.data.object.metadata?.lab_module) {
      // Ours, but the routing row isn't visible yet. Fail so Stripe retries shortly.
      throw new Error(`No routing row yet for Checkout Session ${sessionId}`)
    }
    // Not created by the lab, for example a `stripe trigger` fixture.
    return
  }
  if (!isLabModuleSlug(checkout.module)) {
    return
  }
  const handlers = moduleHandlers[checkout.module]
  if (!handlers) {
    return
  }

  // Act on the session's current state, not the snapshot inside the event.
  const session = await getStripe().checkout.sessions.retrieve(sessionId)
  const ctx = { tx, checkout }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      // Skips 'unpaid' sessions: a delayed payment method is still processing,
      // so wait for async_payment_succeeded instead of granting anything now.
      await fulfillPaidCheckout(tx, session, checkout)
      break
    case 'checkout.session.async_payment_failed':
      await handlers.onCheckoutPaymentFailed?.(session, ctx)
      break
    case 'checkout.session.expired':
      await handlers.onCheckoutExpired?.(session, ctx)
      break
  }
}

/** A Customer deleted in the Dashboard: forget the mapping so the next purchase creates a new one. */
async function forgetDeletedCustomer(
  event: EventOf<'customer.deleted'>,
  { tx }: WebhookContext,
): Promise<void> {
  await tx
    .delete(payCustomers)
    .where(eq(payCustomers.stripeCustomerId, event.data.object.id))
}

const coreHandlers: RegisteredEventHandler[] = [
  onEvent('checkout.session.completed', routeCheckoutEvent),
  onEvent('checkout.session.async_payment_succeeded', routeCheckoutEvent),
  onEvent('checkout.session.async_payment_failed', routeCheckoutEvent),
  onEvent('checkout.session.expired', routeCheckoutEvent),
  onEvent('charge.refunded', handleChargeRefunded),
  onEvent('charge.dispute.created', handleDisputeCreated),
  onEvent('charge.dispute.closed', handleDisputeClosed),
  onEvent('customer.deleted', forgetDeletedCustomer),
]

function handlersFor(type: Stripe.Event['type']): RegisteredEventHandler[] {
  return [...coreHandlers, ...extraEventHandlers].filter(
    (handler) => handler.type === type,
  )
}

/**
 * Verifies a webhook request and processes it exactly once.
 *
 * Recording the event ID and running its handlers share one transaction:
 * if a handler throws, the record is rolled back too and the 500 makes Stripe
 * retry. A repeat delivery of a processed event finds the record and is skipped.
 */
export async function processStripeWebhook(request: Request): Promise<Response> {
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Missing Stripe-Signature header.', { status: 400 })
  }

  let stripe: Stripe
  let secret: string
  try {
    stripe = getStripe()
    secret = getWebhookSecret()
  } catch (error) {
    // A setup problem, not a bad request: 500 so Stripe retries once it's fixed.
    const message = error instanceof Error ? error.message : 'Stripe is not configured.'
    console.error(`[stripe webhook] ${message}`)
    return new Response(message, { status: 500 })
  }

  // The signature covers the exact bytes Stripe sent, so read the raw body.
  const payload = await request.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid payload.'
    console.warn(`[stripe webhook] rejected: ${message}`)
    return new Response(`Webhook verification failed: ${message}`, { status: 400 })
  }

  try {
    const outcome = await db.transaction(async (tx) => {
      const recorded = await tx
        .insert(payStripeEvents)
        .values({
          id: event.id,
          type: event.type,
          livemode: event.livemode,
          stripeCreatedAt: new Date(event.created * 1000),
        })
        .onConflictDoNothing()
        .returning({ id: payStripeEvents.id })

      if (recorded.length === 0) {
        return 'duplicate'
      }

      for (const handler of handlersFor(event.type)) {
        await handler.run(event, { tx })
      }
      return 'processed'
    })

    console.info(`[stripe webhook] ${event.type} ${event.id}: ${outcome}`)
    return Response.json({ received: true, outcome })
  } catch (error) {
    console.error(`[stripe webhook] ${event.type} ${event.id} failed`, error)
    Sentry.captureException(error, { tags: { stripe_event_type: event.type } })
    return new Response('Webhook handler failed. Stripe will retry.', { status: 500 })
  }
}
