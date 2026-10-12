import type { PayOrder } from '#/db/pay-schema'
import { Badge } from '#/components/ui/badge'

const labels: Record<PayOrder['status'], string> = {
  pending: 'Waiting for payment',
  paid: 'Paid',
  failed: 'Payment failed',
  expired: 'Checkout expired',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
  disputed: 'Disputed',
  dispute_lost: 'Dispute lost',
}

const variants: Record<PayOrder['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'outline',
  paid: 'default',
  failed: 'destructive',
  expired: 'secondary',
  partially_refunded: 'secondary',
  refunded: 'secondary',
  disputed: 'destructive',
  dispute_lost: 'destructive',
}

export default function OrderStatusBadge({ status }: { status: PayOrder['status'] }) {
  return <Badge variant={variants[status]}>{labels[status]}</Badge>
}
