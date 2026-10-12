import { RefreshCw } from 'lucide-react'
import LocalTime from '#/components/stripe/LocalTime'
import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table'
import { formatMoney } from '#/lib/lab/format'
import { usageMeters } from '#/lib/lab/usage/catalog'
import type { MeterReading } from '#/lib/lab/usage/usage.server'

interface MeterReadoutProps {
  reading: MeterReading | null | undefined
  fetching: boolean
  onRefresh: () => void
}

/** The app's count next to Stripe's, and the invoice Stripe would create today. */
export default function MeterReadout({ reading, fetching, onRefresh }: MeterReadoutProps) {
  const catchingUp = reading ? usageMeters.some((meter) => reading.stripe[meter.key] < reading.local[meter.key]) : false

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-ink-soft">
          {catchingUp
            ? 'Stripe is still counting the latest usage. It usually catches up within a minute.'
            : 'This period, as the app sent it and as Stripe counted it.'}
        </p>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={fetching}>
          {fetching ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
          Refresh from Stripe
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Meter</TableHead>
            <TableHead className="text-right">Sent</TableHead>
            <TableHead className="text-right">Counted by Stripe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usageMeters.map((meter) => (
            <TableRow key={meter.key}>
              <TableCell>{meter.productName}</TableCell>
              <TableCell className="amount text-right">
                {reading ? reading.local[meter.key].toLocaleString('en-US') : '—'}
              </TableCell>
              <TableCell className="amount text-right">
                {reading ? reading.stripe[meter.key].toLocaleString('en-US') : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {reading ? (
        <div className="rounded-lg border border-line bg-surface-sunken p-3">
          <p className="m-0 flex flex-wrap items-baseline justify-between gap-2 text-sm text-ink">
            <span className="font-medium">Bill so far</span>
            <span className="amount text-lg">{formatMoney(reading.bill.total, reading.bill.currency)}</span>
          </p>
          {reading.bill.periodEnd ? (
            <p className="m-0 text-xs text-ink-soft">
              Invoiced on <LocalTime iso={reading.bill.periodEnd} />, from Stripe's invoice preview
            </p>
          ) : null}
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-xs">
            {reading.bill.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-3">
                <span className="text-ink-soft">{line.description}</span>
                <span className="amount text-ink">{formatMoney(line.amount, reading.bill.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
