import { Badge } from '#/components/ui/badge'

const labels: Record<string, { text: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  trialing: { text: 'Free trial', variant: 'outline' },
  active: { text: 'Active', variant: 'default' },
  past_due: { text: 'Payment failed, retrying', variant: 'destructive' },
  unpaid: { text: 'Unpaid', variant: 'destructive' },
  canceled: { text: 'Canceled', variant: 'secondary' },
  incomplete: { text: 'Waiting for payment', variant: 'outline' },
  incomplete_expired: { text: 'Never paid', variant: 'secondary' },
  paused: { text: 'Paused', variant: 'secondary' },
}

/** A Stripe subscription status in plain words. */
export default function SubscriptionStatusBadge({ status }: { status: string }) {
  const label = labels[status] ?? { text: status, variant: 'secondary' as const }
  return <Badge variant={label.variant}>{label.text}</Badge>
}
