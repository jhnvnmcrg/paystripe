import type { PayOrder } from '#/db/pay-schema'
import { Button } from '#/components/ui/button'
import { formatMoney } from '#/lib/lab/format'

interface SellerActionsProps {
  order: {
    status: PayOrder['status']
    amountTotal: number | null
    amountRefunded: number
    currency: string | null
  }
  /** The amount the partial-refund button gives back. */
  partialRefund: number
  disabled: boolean
  onRefund: (amount?: number) => void
  onResolveDispute: (outcome: 'won' | 'lost') => void
}

/** Refund and dispute buttons, playing the seller's side of an order. */
export default function SellerActions({
  order,
  partialRefund,
  disabled,
  onRefund,
  onResolveDispute,
}: SellerActionsProps) {
  const refundable = order.status === 'paid' || order.status === 'partially_refunded'
  if (!refundable && order.status !== 'disputed') {
    return null
  }
  const remaining = (order.amountTotal ?? 0) - order.amountRefunded

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-ink-soft">As the seller:</span>
      {refundable && remaining > partialRefund ? (
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onRefund(partialRefund)}>
          Refund {formatMoney(partialRefund, order.currency)}
        </Button>
      ) : null}
      {refundable ? (
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onRefund()}>
          {order.amountRefunded > 0 ? 'Refund the rest' : 'Refund in full'}
        </Button>
      ) : null}
      {order.status === 'disputed' ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onResolveDispute('won')}
          >
            Win the dispute
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onResolveDispute('lost')}
          >
            Lose the dispute
          </Button>
        </>
      ) : null}
    </div>
  )
}
