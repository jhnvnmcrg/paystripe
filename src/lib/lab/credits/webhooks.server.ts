import { getStripe } from '#/lib/stripe/client.server'
import { closeUnpaidOrder, markOrderPaid } from '#/lib/stripe/orders.server'
import type { ModuleWebhookHandlers, RegisteredEventHandler } from '#/lib/stripe/webhooks/types'
import { onEvent } from '#/lib/stripe/webhooks/types'
import { clawBack, completeRecharge, failRecharge, fulfillPackOrder, saveCard } from './credits.server'

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }
  return typeof value === 'string' ? value : value.id
}

/**
 * Packs come through Checkout in payment mode; replacing the card comes through
 * Checkout in setup mode. Automatic top-ups don't use Checkout at all (see below).
 */
export const creditsWebhooks: ModuleWebhookHandlers = {
  async onCheckoutPaid(session, { tx, checkout }) {
    if (session.mode === 'setup') {
      const setupIntentId = idOf(session.setup_intent)
      const intent = setupIntentId ? await getStripe().setupIntents.retrieve(setupIntentId) : null
      const method = idOf(intent?.payment_method)
      if (intent?.status === 'succeeded' && method) {
        await saveCard(tx, checkout.clerkUserId, method)
      }
      return
    }
    const order = await markOrderPaid(tx, session, checkout)
    if (order) {
      await fulfillPackOrder(tx, order)
    }
  },

  async onCheckoutPaymentFailed(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'failed')
  },

  async onCheckoutExpired(_session, { tx, checkout }) {
    await closeUnpaidOrder(tx, checkout, 'expired')
  },

  // Packs and top-ups alike: their credits go back in proportion to the refund.
  async onOrderRefunded(order, { tx }) {
    await clawBack(tx, order, order.amountRefunded)
  },

  async onDisputeClosed(order, { tx, outcome }) {
    if (outcome === 'lost') {
      await clawBack(tx, order, order.amountTotal ?? 0)
    }
  },
}

/**
 * Automatic top-ups are plain Payment Intents. The request that charged the
 * card already recorded the result; these events cover a request that died
 * between Stripe's answer and our database write. Both paths are idempotent.
 */
export const creditsEventHandlers: RegisteredEventHandler[] = [
  onEvent('payment_intent.succeeded', async (event, { tx }) => {
    if (event.data.object.metadata?.lab_kind !== 'recharge') {
      return
    }
    await completeRecharge(tx, await getStripe().paymentIntents.retrieve(event.data.object.id))
  }),
  onEvent('payment_intent.payment_failed', async (event, { tx }) => {
    if (event.data.object.metadata?.lab_kind !== 'recharge') {
      return
    }
    const intent = await getStripe().paymentIntents.retrieve(event.data.object.id)
    if (intent.metadata.recharge_id) {
      await failRecharge(
        tx,
        intent.metadata.recharge_id,
        intent.id,
        intent.last_payment_error?.message ?? 'The automatic top-up was declined.',
      )
    }
  }),
]
