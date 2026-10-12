import { useState } from 'react'
import LocalTime from '#/components/stripe/LocalTime'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Spinner } from '#/components/ui/spinner'
import type { MeterKey } from '#/lib/lab/usage/catalog'
import { findMeter, usageMeters } from '#/lib/lab/usage/catalog'
import type { UsageEventView } from '#/lib/lab/usage/usage.server'

interface ApiConsoleProps {
  recent: UsageEventView[]
  disabled?: boolean
  send: (meter: MeterKey, value: number) => Promise<unknown>
  retry?: (id: string) => Promise<unknown>
  /** Called after each send, so the page polls for Stripe's side. */
  onSent: () => void
}

const statusVariant = { sent: 'default', pending: 'outline', failed: 'destructive' } as const

/** Buttons standing in for real API traffic. Each press is one meter event. */
export default function ApiConsole({ recent, disabled = false, send, retry, onSent }: ApiConsoleProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That request failed.')
    } finally {
      setBusy(null)
      onSent()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {usageMeters.map((meter) => (
          <div key={meter.key} className="flex flex-wrap items-center gap-2">
            <span className="w-36 text-sm text-ink-soft">{meter.productName}</span>
            {meter.batches.map((size) => {
              const key = `${meter.key}-${size}`
              return (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  disabled={disabled || busy !== null}
                  onClick={() => run(key, () => send(meter.key, size))}
                >
                  {busy === key ? <Spinner data-icon="inline-start" /> : null}+{size.toLocaleString('en-US')}
                </Button>
              )
            })}
          </div>
        ))}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {recent.length > 0 ? (
        <ol className="m-0 flex list-none flex-col divide-y divide-line p-0 text-sm">
          {recent.map((event) => {
            const meter = findMeter(event.meter)
            return (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                <span className="flex flex-wrap items-center gap-2 text-ink">
                  <span className="amount">+{event.value.toLocaleString('en-US')}</span>
                  {event.value === 1 ? meter?.unit : meter?.units}
                  <Badge variant={statusVariant[event.status]}>{event.status}</Badge>
                </span>
                <span className="flex items-center gap-2 text-xs text-ink-soft">
                  <span className="amount" title="Sent to Stripe as the meter event's identifier">
                    {event.id.slice(0, 8)}
                  </span>
                  <LocalTime iso={event.occurredAt} />
                  {event.status !== 'sent' && retry ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy !== null}
                      onClick={() => run(event.id, () => retry(event.id))}
                    >
                      Resend
                    </Button>
                  ) : null}
                </span>
                {event.error ? <span className="w-full text-xs text-danger">{event.error}</span> : null}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="m-0 text-sm text-ink-soft">No usage yet.</p>
      )}
    </div>
  )
}
