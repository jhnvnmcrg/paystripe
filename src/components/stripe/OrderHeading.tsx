import type { PayOrder } from '#/db/pay-schema'
import LocalTime from '#/components/stripe/LocalTime'
import OrderStatusBadge from '#/components/stripe/OrderStatusBadge'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'

interface OrderHeadingProps {
  order: {
    status: PayOrder['status']
    currency: string | null
    amountTotal: number | null
    amountRefunded: number
    amountDiscount?: number
    createdAt: string
  }
  /** True while the page waits for this order's webhook. */
  awaiting: boolean
}

/** The top line of an order: what was paid, when, and where it stands. */
export default function OrderHeading({ order, awaiting }: OrderHeadingProps) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <span className="amount font-medium text-ink">
            {formatMoney(order.amountTotal, order.currency)}
          </span>
          {order.amountDiscount ? (
            <span className="amount text-success">
              {formatMoney(order.amountDiscount, order.currency)} discount
            </span>
          ) : null}
          {order.amountRefunded > 0 ? (
            <span className="amount text-ink-soft">
              {formatMoney(order.amountRefunded, order.currency)} refunded
            </span>
          ) : null}
          <span className="text-ink-soft">
            <LocalTime iso={order.createdAt} />
          </span>
        </div>
        <div className="flex items-center gap-2">
          {awaiting ? (
            <span className="flex items-center gap-1.5 text-xs text-ink-soft">
              <Spinner />
              Waiting for webhook
            </span>
          ) : null}
          <OrderStatusBadge status={order.status} />
        </div>
      </div>

      {order.status === 'pending' ? (
        <p className="m-0 text-sm text-ink-soft">
          No payment yet. If checkout was abandoned, Stripe expires the session after 24 hours and
          this order closes.
        </p>
      ) : null}
    </>
  )
}
