import { syncCheckoutSubscription } from '#/lib/stripe/subscriptions.server'
import type { ModuleWebhookHandlers, RegisteredEventHandler } from '#/lib/stripe/webhooks/types'
import { onEvent } from '#/lib/stripe/webhooks/types'
import { markAlertTriggered } from './usage.server'

/** The subscription is synced by the shared events; usage itself never comes back as a webhook. */
export const usageWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx }) {
    await syncCheckoutSubscription(tx, session)
  },
}

/** Stripe's usage alert fired for one of our customers. */
export const usageEventHandlers: RegisteredEventHandler[] = [
  onEvent('billing.alert.triggered', (event, { tx }) => markAlertTriggered(tx, event.data.object)),
]
