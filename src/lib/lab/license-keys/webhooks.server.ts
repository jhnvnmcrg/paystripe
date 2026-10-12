import { closeUnpaidOrder, markOrderPaid } from '#/lib/stripe/orders.server'
import type { ModuleWebhookHandlers } from '#/lib/stripe/webhooks/types'
import { issueLicensesForOrder, setOrderLicenseStatus } from './licenses.server'

/** What each payment event means for a license key. */
export const licenseKeyWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx, checkout }) {
    // markOrderPaid returns null if an earlier event already fulfilled this order.
    const order = await markOrderPaid(tx, session, checkout)
    if (order) {
      await issueLicensesForOrder(tx, order.id, order.clerkUserId)
    }
  },

  async onCheckoutPaymentFailed(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'failed')
  },

  async onCheckoutExpired(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'expired')
  },

  async onOrderRefunded(order, { tx, fullyRefunded }) {
    // A partial refund is a goodwill credit: the buyer keeps the key.
    if (fullyRefunded) {
      await setOrderLicenseStatus(tx, order.id, 'revoked', 'Refunded in full.')
    }
  },

  async onOrderDisputed(order, { tx }) {
    await setOrderLicenseStatus(
      tx,
      order.id,
      'suspended',
      'The payment is disputed with the bank.',
      ['active'],
    )
  },

  async onDisputeClosed(order, { tx, outcome }) {
    if (outcome === 'won') {
      await setOrderLicenseStatus(tx, order.id, 'active', null, ['suspended'])
    } else {
      await setOrderLicenseStatus(
        tx,
        order.id,
        'revoked',
        'Dispute lost: the payment went back to the buyer.',
      )
    }
  },
}
