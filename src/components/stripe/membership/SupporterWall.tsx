import LevelBadge from '#/components/stripe/membership/LevelBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { formatMoney } from '#/lib/lab/format'
import type { WallEntry } from '#/lib/lab/membership/membership.server'

const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Everyone who has given anything, from paid invoices and tips. */
export default function SupporterWall({ entries }: { entries: WallEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Supporter wall</CardTitle>
        <CardDescription>
          Totals add up every paid membership invoice and tip, minus refunds. Names appear only if the
          supporter set one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="m-0 text-sm text-ink-soft">No supporters yet. Join or tip to be the first.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {entries.map((entry) => (
              <li key={entry.key} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-ink">{entry.name ?? 'Anonymous supporter'}</span>
                    {entry.isYou ? <span className="text-ink-soft">(you)</span> : null}
                    {entry.level ? <LevelBadge level={entry.level} /> : null}
                  </p>
                  <span className="amount text-sm text-ink">{formatMoney(entry.total, 'usd')}</span>
                </div>
                <p className="m-0 text-xs text-ink-soft">
                  {entry.memberSince
                    ? `Member since ${monthYear.format(new Date(entry.memberSince))}`
                    : 'Tips only'}
                  {!entry.level && entry.memberSince ? ', membership ended' : ''}
                </p>
                {entry.latestMessage ? (
                  <p className="m-0 text-sm text-ink">“{entry.latestMessage}”</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
