import LocalTime from '#/components/stripe/LocalTime'
import { Badge } from '#/components/ui/badge'
import { formatMoney } from '#/lib/lab/format'

export interface InvoiceRow {
  id: string
  number: string | null
  status: string | null
  reason: string | null
  amountDue: number
  amountPaid: number
  currency: string
  created: string
  hostedUrl: string | null
}

const reasons: Record<string, string> = {
  subscription_create: 'First invoice',
  subscription_cycle: 'Renewal',
  subscription_update: 'Plan change',
  manual: 'One-off',
}

const statusVariant: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  paid: 'default',
  open: 'destructive',
  draft: 'outline',
  void: 'secondary',
  uncollectible: 'destructive',
}

/** Invoices as Stripe sees them, newest first, each linking to Stripe's hosted page. */
export default function InvoiceList({ invoices }: { invoices: InvoiceRow[] }) {
  if (invoices.length === 0) {
    return <p className="m-0 text-sm text-ink-soft">No invoices yet.</p>
  }
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-line p-0 text-sm">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-ink">
              {reasons[invoice.reason ?? ''] ?? 'Invoice'}
            </span>
            <span className="text-ink-soft">
              <LocalTime iso={invoice.created} />
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="amount text-ink">{formatMoney(invoice.amountDue, invoice.currency)}</span>
            <Badge variant={statusVariant[invoice.status ?? ''] ?? 'secondary'}>
              {invoice.status === 'open' ? 'Unpaid' : (invoice.status ?? 'unknown')}
            </Badge>
            {invoice.hostedUrl ? (
              <a href={invoice.hostedUrl} target="_blank" rel="noreferrer" className="text-sm">
                View
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
