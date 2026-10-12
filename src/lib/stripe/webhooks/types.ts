import type Stripe from 'stripe'
import type { DbTransaction } from '#/db/index'
import type { PayCheckoutSession, PayOrder, PaySubscription } from '#/db/pay-schema'

export type StripeEventType = Stripe.Event['type']
export type EventOf<T extends StripeEventType> = Extract<Stripe.Event, { type: T }>

/** Every handler runs inside the webhook's transaction. If it throws, nothing is kept and Stripe retries. */
export interface WebhookContext {
  tx: DbTransaction
}

export interface CheckoutContext extends WebhookContext {
  /** The routing row written when the module created the Checkout Session. */
  checkout: PayCheckoutSession
}

/**
 * What a lab module does when its payments change state.
 * Handlers must be safe to call twice: Stripe can deliver an event more than once,
 * and `onCheckoutPaid` fires for both `completed` and `async_payment_succeeded`.
 */
export interface ModuleWebhookHandlers {
  /** The session is paid, or needs no payment (a free trial, setup mode). Session is freshly fetched. */
  onCheckoutPaid?: (session: Stripe.Checkout.Session, ctx: CheckoutContext) => Promise<void>
  /** A delayed payment method (such as a bank debit) failed after checkout. */
  onCheckoutPaymentFailed?: (session: Stripe.Checkout.Session, ctx: CheckoutContext) => Promise<void>
  /** The buyer never finished and the session expired. */
  onCheckoutExpired?: (session: Stripe.Checkout.Session, ctx: CheckoutContext) => Promise<void>
  onOrderRefunded?: (
    order: PayOrder,
    ctx: WebhookContext & { fullyRefunded: boolean },
  ) => Promise<void>
  onOrderDisputed?: (order: PayOrder, ctx: WebhookContext) => Promise<void>
  /** The bank decided the dispute: `won` means the money stays, `lost` means it went back to the buyer. */
  onDisputeClosed?: (
    order: PayOrder,
    ctx: WebhookContext & { outcome: 'won' | 'lost' },
  ) => Promise<void>
  /** A subscription of this module was created or changed (status, plan, period, cancellation). */
  onSubscriptionChanged?: (
    subscription: PaySubscription,
    ctx: WebhookContext & { previousStatus: string | null },
  ) => Promise<void>
}

/** A handler for one raw event type, for modules that need more than checkout events. */
export interface RegisteredEventHandler {
  type: StripeEventType
  run: (event: Stripe.Event, ctx: WebhookContext) => Promise<void>
}

function isEventOfType<T extends StripeEventType>(
  event: Stripe.Event,
  type: T,
): event is EventOf<T> {
  return event.type === type
}

/** Registers a typed handler for one event type. */
export function onEvent<T extends StripeEventType>(
  type: T,
  handler: (event: EventOf<T>, ctx: WebhookContext) => Promise<void>,
): RegisteredEventHandler {
  return {
    type,
    run: async (event, ctx) => {
      if (isEventOfType(event, type)) {
        await handler(event, ctx)
      }
    },
  }
}
