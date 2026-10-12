import { syncCheckoutSubscription } from '#/lib/stripe/subscriptions.server'
import type { ModuleWebhookHandlers } from '#/lib/stripe/webhooks/types'

/** Store the new subscription as soon as checkout completes; shared events keep it current. */
export const freemiumWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx }) {
    await syncCheckoutSubscription(tx, session)
  },
}
