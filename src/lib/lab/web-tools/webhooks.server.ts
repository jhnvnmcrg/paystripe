import { syncCheckoutSubscription } from '#/lib/stripe/subscriptions.server'
import type { ModuleWebhookHandlers, RegisteredEventHandler } from '#/lib/stripe/webhooks/types'
import { onEvent } from '#/lib/stripe/webhooks/types'
import { syncEntitlements } from './tools.server'

/** The subscription is synced by the shared subscription events; this module adds entitlements. */
export const webToolsWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx }) {
    await syncCheckoutSubscription(tx, session)
  },

  // Belt and braces: Stripe also sends the entitlement event below, sometimes a moment later.
  async onSubscriptionChanged(subscription, { tx }) {
    await syncEntitlements(tx, subscription.stripeCustomerId)
  },
}

/**
 * Stripe recalculates what a customer is entitled to whenever their
 * subscriptions change, then sends this event. It's per customer, not per subscription.
 */
export const webToolsEventHandlers: RegisteredEventHandler[] = [
  onEvent('entitlements.active_entitlement_summary.updated', (event, { tx }) =>
    syncEntitlements(tx, event.data.object.customer),
  ),
]
