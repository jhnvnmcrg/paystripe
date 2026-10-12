import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { DbTransaction } from '#/db/index'
import { payOrders } from '#/db/pay-schema'
import { getStripe } from '#/lib/stripe/client.server'
import { closeUnpaidOrder, markOrderPaid } from '#/lib/stripe/orders.server'
import type { ModuleWebhookHandlers } from '#/lib/stripe/webhooks/types'
import { convertHeldStock, releaseHeldStock } from './shop.server'

/** The name of the shipping rate the buyer picked on Stripe's page. */
async function shippingMethodName(session: Stripe.Checkout.Session): Promise<string | null> {
  const rate = session.shipping_cost?.shipping_rate
  if (!rate) {
    return null
  }
  if (typeof rate !== 'string') {
    return rate.display_name
  }
  return (await getStripe().shippingRates.retrieve(rate)).display_name
}

/** Changes the fulfillment state only if the order is still where `from` says. */
async function setFulfillment(tx: DbTransaction, orderId: string, from: string, to: string) {
  await tx
    .update(payOrders)
    .set({ fulfillmentStatus: to, updatedAt: new Date() })
    .where(and(eq(payOrders.id, orderId), eq(payOrders.fulfillmentStatus, from)))
}

/** What each payment event means for stock and shipping. */
export const shopWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx, checkout }) {
    const order = await markOrderPaid(tx, session, checkout)
    if (!order) {
      return
    }
    const sold = await convertHeldStock(tx, order.id)
    if (sold === 0) {
      console.warn(`[shop] order ${order.id} was paid but held no stock`)
    }

    const method = await shippingMethodName(session)
    await tx
      .update(payOrders)
      .set({
        fulfillmentStatus: 'unfulfilled',
        shipping: order.shipping ? { ...order.shipping, method } : null,
        updatedAt: new Date(),
      })
      .where(eq(payOrders.id, order.id))
  },

  async onCheckoutPaymentFailed(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'failed')
    if (checkout.refId) {
      await releaseHeldStock(tx, checkout.refId)
    }
  },

  async onCheckoutExpired(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'expired')
    if (checkout.refId) {
      await releaseHeldStock(tx, checkout.refId)
    }
  },

  async onOrderRefunded(order, { tx, fullyRefunded }) {
    // Nothing to ship any more. Stock stays sold until the seller chooses to restock.
    if (fullyRefunded) {
      await setFulfillment(tx, order.id, 'unfulfilled', 'canceled')
      await setFulfillment(tx, order.id, 'on_hold', 'canceled')
    }
  },

  async onOrderDisputed(order, { tx }) {
    // Don't ship goods for a payment the bank may claw back.
    await setFulfillment(tx, order.id, 'unfulfilled', 'on_hold')
  },

  async onDisputeClosed(order, { tx, outcome }) {
    await setFulfillment(tx, order.id, 'on_hold', outcome === 'won' ? 'unfulfilled' : 'canceled')
  },
}
