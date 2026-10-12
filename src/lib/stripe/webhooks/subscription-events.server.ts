import type { DbTransaction } from '#/db/index'
import { isLabModuleSlug } from '#/lib/lab/modules'
import { subscriptionIdOfInvoice, syncSubscription } from '#/lib/stripe/subscriptions.server'
import { moduleHandlers } from './modules.server'
import type { RegisteredEventHandler } from './types'
import { onEvent } from './types'

/** Re-syncs the subscription, then tells its module what changed. */
async function syncAndNotify(tx: DbTransaction, subscriptionId: string | null): Promise<void> {
  if (!subscriptionId) {
    return
  }
  const result = await syncSubscription(tx, subscriptionId)
  if (result && isLabModuleSlug(result.row.module)) {
    await moduleHandlers[result.row.module]?.onSubscriptionChanged?.(result.row, {
      tx,
      previousStatus: result.previousStatus,
    })
  }
}

/**
 * Every event that can change a subscription triggers the same re-sync.
 * Invoice events matter too: a failed renewal moves the subscription to past_due.
 */
export const subscriptionEventHandlers: RegisteredEventHandler[] = [
  ...(
    [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.paused',
      'customer.subscription.resumed',
      'customer.subscription.trial_will_end',
    ] as const
  ).map((type) =>
    onEvent(type, (event, { tx }) => syncAndNotify(tx, event.data.object.id)),
  ),
  ...(['invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required'] as const).map(
    (type) => onEvent(type, (event, { tx }) => syncAndNotify(tx, subscriptionIdOfInvoice(event.data.object))),
  ),
]
