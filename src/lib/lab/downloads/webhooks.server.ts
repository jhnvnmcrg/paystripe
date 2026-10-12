import { closeUnpaidOrder, markOrderPaid } from '#/lib/stripe/orders.server'
import type { ModuleWebhookHandlers } from '#/lib/stripe/webhooks/types'
import { grantDownloadsForOrder, setOrderGrantStatus } from './downloads.server'

/** What each payment event means for the buyer's downloads. */
export const downloadWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx, checkout }) {
    // markOrderPaid returns null if an earlier event already fulfilled this order.
    const order = await markOrderPaid(tx, session, checkout)
    if (order) {
      await grantDownloadsForOrder(tx, order.id, order.clerkUserId)
    }
  },

  async onCheckoutPaymentFailed(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'failed')
  },

  async onCheckoutExpired(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'expired')
  },

  async onOrderRefunded(order, { tx, fullyRefunded }) {
    // A partial refund (say, for one file of several) leaves the downloads in place.
    if (fullyRefunded) {
      await setOrderGrantStatus(tx, order.id, 'revoked', 'Refunded in full.')
    }
  },

  async onOrderDisputed(order, { tx }) {
    await setOrderGrantStatus(
      tx,
      order.id,
      'suspended',
      'The payment is disputed with the bank.',
      ['active'],
    )
  },

  async onDisputeClosed(order, { tx, outcome }) {
    if (outcome === 'won') {
      await setOrderGrantStatus(tx, order.id, 'active', null, ['suspended'])
    } else {
      await setOrderGrantStatus(
        tx,
        order.id,
        'revoked',
        'Dispute lost: the payment went back to the buyer.',
      )
    }
  },
}
