import { syncCheckoutSubscription } from '#/lib/stripe/subscriptions.server'
import type { ModuleWebhookHandlers } from '#/lib/stripe/webhooks/types'

/**
 * The subscription itself is kept in sync by the shared subscription events.
 * Checkout completing just stores it straight away, so the success page needn't
 * wait for customer.subscription.created as well.
 */
export const saasWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx }) {
    await syncCheckoutSubscription(tx, session)
  },
}
