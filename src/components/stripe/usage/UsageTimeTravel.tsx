import { FastForward } from 'lucide-react'
import { useState } from 'react'
import InvoiceList from '#/components/stripe/InvoiceList'
import LocalTime from '#/components/stripe/LocalTime'
import SubscriptionStatusBadge from '#/components/stripe/SubscriptionStatusBadge'
import ApiConsole from '#/components/stripe/usage/ApiConsole'
import MeterReadout from '#/components/stripe/usage/MeterReadout'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import {
  advanceUsageTimeTravelRun,
  endUsageTimeTravelRun,
  sendUsageTimeTravel,
  startUsageTimeTravelRun,
} from '#/lib/lab/usage/usage.functions'
import type { UsageTimeTravelView } from '#/lib/lab/usage/usage.server'

interface UsageTimeTravelProps {
  run: UsageTimeTravelView | null | undefined
  fetching: boolean
  /** Called after every action, so the page polls while Stripe catches up. */
  onChanged: () => void
}

/** A test-clock customer whose month can be fast-forwarded, to see a usage invoice charged. */
export default function UsageTimeTravel({ run, fetching, onChanged }: UsageTimeTravelProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(name: string, action: () => Promise<unknown>) {
    setBusy(name)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That action failed.')
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Time travel: see a usage invoice</CardTitle>
        <CardDescription>
          A test-clock customer with its own metered subscription. Send it usage, wait for Stripe to count
          it, then jump to the end of the month and watch the invoice get charged.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!run ? (
          <Button className="self-start" disabled={busy !== null} onClick={() => act('start', () => startUsageTimeTravelRun())}>
            {busy === 'start' ? <Spinner data-icon="inline-start" /> : null}
            Start a time-travel run
          </Button>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-ink">
                Clock: <LocalTime iso={run.clockTime} />
                {run.clockStatus !== 'ready' ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-ink-soft">
                    <Spinner /> {run.clockStatus}
                  </span>
                ) : null}
              </span>
              {run.subscription ? <SubscriptionStatusBadge status={run.subscription.status} /> : null}
            </div>

            {run.canMeter ? (
              <>
                <ApiConsole
                  recent={run.recent}
                  disabled={busy !== null}
                  send={(meter, value) => sendUsageTimeTravel({ data: { meter, value } })}
                  onSent={onChanged}
                />
                <MeterReadout reading={run.reading} fetching={fetching} onRefresh={onChanged} />
                <Button
                  className="self-start"
                  disabled={busy !== null || run.clockStatus !== 'ready'}
                  onClick={() => act('advance', () => advanceUsageTimeTravelRun())}
                >
                  {busy === 'advance' ? <Spinner data-icon="inline-start" /> : <FastForward data-icon="inline-start" />}
                  Jump to the end of the month
                </Button>
              </>
            ) : (
              <Alert>
                <AlertTitle>This month has been billed</AlertTitle>
                <AlertDescription>
                  The clock is now ahead of real time, and Stripe only accepts usage dated up to 5 minutes
                  ahead. That's why a run can meter only its first month. End it to start another.
                </AlertDescription>
              </Alert>
            )}

            <Separator />
            <div>
              <h3 className="m-0 mb-2 text-[0.8125rem] font-semibold text-ink-soft">Time-travel invoices</h3>
              <InvoiceList invoices={run.invoices} />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={busy !== null}
              onClick={() => act('end', () => endUsageTimeTravelRun())}
            >
              {busy === 'end' ? <Spinner data-icon="inline-start" /> : null}
              End the run
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
