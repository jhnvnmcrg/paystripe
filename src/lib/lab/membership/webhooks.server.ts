import { closeUnpaidOrder, markOrderPaid } from '#/lib/stripe/orders.server'
import { syncCheckoutSubscription } from '#/lib/stripe/subscriptions.server'
import type { ModuleWebhookHandlers, RegisteredEventHandler } from '#/lib/stripe/webhooks/types'
import { onEvent } from '#/lib/stripe/webhooks/types'
import { recordInvoiceContribution, recordTip, syncCommunityRole, syncTipRefund } from './membership.server'

/**
 * Memberships are subscriptions; tips are one-time orders. Both come through
 * the same module, told apart by the Checkout Session's mode.
 */
export const membershipWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx, checkout }) {
    if (session.mode === 'subscription') {
      const result = await syncCheckoutSubscription(tx, session)
      if (result) {
        await syncCommunityRole(tx, result.row.clerkUserId, result.row.status)
      }
      return
    }
    const order = await markOrderPaid(tx, session, checkout)
    if (order) {
      await recordTip(tx, order, session)
    }
  },

  async onCheckoutPaymentFailed(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'failed')
  },

  async onCheckoutExpired(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'expired')
  },

  async onOrderRefunded(order, { tx }) {
    await syncTipRefund(tx, order, order.amountRefunded)
  },

  async onDisputeClosed(order, { tx, outcome }) {
    if (outcome === 'lost') {
      await syncTipRefund(tx, order, order.amountTotal ?? 0)
    }
  },

  // Every subscription change (joined, tier switched, payment failed, ended) re-checks the role.
  async onSubscriptionChanged(subscription, { tx }) {
    await syncCommunityRole(tx, subscription.clerkUserId, subscription.status)
  },
}

/** Each paid membership invoice adds to the member's total on the supporter wall. */
export const membershipEventHandlers: RegisteredEventHandler[] = [
  onEvent('invoice.paid', (event, { tx }) =>
    event.data.object.id ? recordInvoiceContribution(tx, event.data.object.id) : Promise.resolve(),
  ),
]
