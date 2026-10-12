import { BellRing } from 'lucide-react'
import { useId, useState } from 'react'
import LocalTime from '#/components/stripe/LocalTime'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import type { MeterKey } from '#/lib/lab/usage/catalog'
import { findMeter, usageMeters } from '#/lib/lab/usage/catalog'
import { deleteUsageAlert, saveUsageAlert } from '#/lib/lab/usage/usage.functions'
import type { UsageAlertView } from '#/lib/lab/usage/usage.server'

interface UsageAlertsProps {
  alerts: UsageAlertView[]
  onChanged: () => void
}

/** A usage threshold Stripe watches, and the webhook that says it was crossed. */
export default function UsageAlerts({ alerts, onChanged }: UsageAlertsProps) {
  const id = useId()
  const [meter, setMeter] = useState<MeterKey>('requests')
  const [threshold, setThreshold] = useState('1500')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const amount = Number(threshold)
  const fired = alerts.filter((alert) => alert.triggeredAt)

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing aria-hidden="true" className="size-4 text-brand" />
          Usage alert
        </CardTitle>
        <CardDescription>
          Stripe sends <code>billing.alert.triggered</code> once your usage reaches the number you set. Use it
          to warn customers before the bill surprises them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fired.map((alert) => (
          <Alert key={alert.id}>
            <AlertTitle>
              {findMeter(alert.meter)?.productName} passed {alert.threshold.toLocaleString('en-US')}
            </AlertTitle>
            <AlertDescription>
              Stripe counted {alert.triggeredValue?.toLocaleString('en-US')} at{' '}
              {alert.triggeredAt ? <LocalTime iso={alert.triggeredAt} /> : null}. A real app would email the
              customer here.
            </AlertDescription>
          </Alert>
        ))}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            run('save', () => saveUsageAlert({ data: { meter, threshold: amount } }))
          }}
          className="flex flex-col gap-3"
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={meter}
            onValueChange={(value) => {
              if (value === 'requests' || value === 'images') {
                setMeter(value)
              }
            }}
            aria-label="Meter to watch"
            className="self-start"
          >
            {usageMeters.map((option) => (
              <ToggleGroupItem key={option.key} value={option.key}>
                {option.productName}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldGroup className="flex-row items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor={`${id}-threshold`}>Alert at this many {findMeter(meter)?.units}</FieldLabel>
              <Input
                id={`${id}-threshold`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                className="amount"
              />
            </Field>
            <Button type="submit" disabled={busy !== null || !Number.isInteger(amount) || amount < 1}>
              {busy === 'save' ? <Spinner data-icon="inline-start" /> : null}
              Set alert
            </Button>
          </FieldGroup>
        </form>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {alerts.length > 0 ? (
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0 text-sm">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-ink">
                  {findMeter(alert.meter)?.productName} at{' '}
                  <span className="amount">{alert.threshold.toLocaleString('en-US')}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={alert.triggeredAt ? 'default' : alert.status === 'active' ? 'outline' : 'secondary'}>
                    {alert.triggeredAt ? 'Fired' : alert.status === 'active' ? 'Watching' : 'Removed'}
                  </Badge>
                  {alert.status === 'active' ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy !== null}
                      onClick={() => run(alert.id, () => deleteUsageAlert({ data: { id: alert.id } }))}
                    >
                      Remove
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
