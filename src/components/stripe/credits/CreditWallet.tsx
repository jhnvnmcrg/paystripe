import LocalTime from '#/components/stripe/LocalTime'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import type { LedgerEntryView } from '#/lib/lab/credits/credits.server'

const kindLabels: Record<LedgerEntryView['kind'], string> = {
  purchase: 'Bought',
  recharge: 'Auto-recharge',
  spend: 'Spent',
  clawback: 'Refund',
}

/** The balance, and the ledger rows that add up to it. */
export default function CreditWallet({ balance, ledger }: { balance: number; ledger: LedgerEntryView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Your balance</CardDescription>
        <CardTitle className="amount text-4xl font-medium">
          {balance.toLocaleString('en-US')} <span className="text-base font-normal text-ink-soft">credits</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ledger.length === 0 ? (
          <p className="m-0 text-sm text-ink-soft">No credits yet. Buy a pack to start.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-line p-0 text-sm" aria-label="Credit ledger">
            {ledger.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-ink">
                  <Badge variant={entry.delta > 0 ? 'default' : 'outline'}>{kindLabels[entry.kind]}</Badge>
                  <span className="min-w-0">{entry.description}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className={`amount ${entry.delta > 0 ? 'text-success' : 'text-ink'}`}>
                    {entry.delta > 0 ? '+' : ''}
                    {entry.delta.toLocaleString('en-US')}
                  </span>
                  <span className="amount w-14 text-right text-xs text-ink-soft" title="Balance after">
                    {entry.balanceAfter.toLocaleString('en-US')}
                  </span>
                </span>
                <span className="w-full text-xs text-ink-soft">
                  <LocalTime iso={entry.createdAt} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
