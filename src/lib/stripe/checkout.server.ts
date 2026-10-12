import type Stripe from 'stripe'
import { db } from '#/db/index'
import { payCheckoutSessions } from '#/db/pay-schema'
import type { LabModuleSlug } from '#/lib/lab/modules'
import { getStripe } from '#/lib/stripe/client.server'
import { getOrCreateStripeCustomer } from '#/lib/stripe/customers.server'

/** Fields the wrapper fills in itself. */
type ManagedField = 'customer' | 'success_url' | 'cancel_url' | 'integration_identifier'

export interface LabCheckoutOptions {
  module: LabModuleSlug
  clerkUserId: string
  /** The module's own record for this checkout, such as an order ID. */
  refId?: string
  /** App path Stripe returns to after payment. `?session_id=` is appended. */
  successPath: string
  /** App path Stripe returns to if the buyer backs out. */
  cancelPath: string
  params: Omit<Stripe.Checkout.SessionCreateParams, ManagedField>
  idempotencyKey?: string
}

export function getAppUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
}

/**
 * Creates a Checkout Session for the signed-in user and records which module
 * owns it, so the webhook can route `checkout.session.*` events back.
 *
 * `payment_method_types` is deliberately never set: Stripe then shows the
 * payment methods enabled in the Dashboard (dynamic payment methods).
 */
export async function createLabCheckoutSession(
  options: LabCheckoutOptions,
): Promise<Stripe.Checkout.Session> {
  const appUrl = getAppUrl()
  const customer = await getOrCreateStripeCustomer(options.clerkUserId)

  const session = await getStripe().checkout.sessions.create(
    {
      ...options.params,
      customer,
      success_url: `${appUrl}${options.successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}${options.cancelPath}`,
      // Checkout Studio settings. They come after the spread so a module can't override them.
      ui_mode: 'hosted_page',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      allow_promotion_codes: false,
      // Stripe rejects submit_type in setup mode.
      ...(options.params.mode !== 'setup' ? { submit_type: 'auto' } : {}),
      // Stripe only accepts payment_method_collection in subscription mode.
      ...(options.params.mode === 'subscription' ? { payment_method_collection: 'always' } : {}),
      integration_identifier: 'hosted_mobile_app_0002',
      origin_context: 'mobile_app',
      metadata: {
        ...options.params.metadata,
        // Fallback only: events are routed through pay_checkout_sessions.
        lab_module: options.module,
      },
    },
    options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
  )

  await db.insert(payCheckoutSessions).values({
    sessionId: session.id,
    module: options.module,
    clerkUserId: options.clerkUserId,
    refId: options.refId ?? null,
  })

  return session
}
