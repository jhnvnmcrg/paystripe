import { CreditCard, FastForward } from 'lucide-react'
import { useId, useState } from 'react'
import InvoiceList from '#/components/stripe/InvoiceList'
import LocalTime from '#/components/stripe/LocalTime'
import SubscriptionStatusBadge from '#/components/stripe/SubscriptionStatusBadge'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import type { BillingInterval, SaasPlanKey } from '#/lib/lab/saas/catalog'
import { saasPlans } from '#/lib/lab/saas/catalog'
import {
  advanceSaasTimeTravel,
  endSaasTimeTravel,
  openSaasPortal,
  retrySaasTimeTravelInvoice,
  setSaasTimeTravelCard,
  startSaasTimeTravel,
} from '#/lib/lab/saas/saas.functions'
import type { TimeTravelView } from '#/lib/lab/saas/saas.server'
import { NextDate } from './SubscriptionPanel'

interface TimeTravelPanelProps {
  run: TimeTravelView | null
  /** Called after every action, so the page polls while the clock and webhooks catch up. */
  onChanged: () => void
}

export default function TimeTravelPanel({ run, onChanged }: TimeTravelPanelProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(name: string, action: () => Promise<unknown>) {
    setBusy(name)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That action failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Time travel</CardTitle>
        <CardDescription>
          A test clock is a fake "now" for one test customer. Move it forward and Stripe runs trial
          endings, renewals and payment retries as if that time had passed. Your real subscription
          isn't touched.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {run ? (
          <RunControls run={run} busy={busy} act={act} />
        ) : (
          <StartForm busy={busy === 'start'} onStart={(input) => act('start', () => startSaasTimeTravel({ data: input }))} />
        )}
      </CardContent>
    </Card>
  )
}

function StartForm({
  busy,
  onStart,
}: {
  busy: boolean
  onStart: (input: { plan: SaasPlanKey; interval: BillingInterval; seats: number; trial: boolean }) => void
}) {
  const id = useId()
  const [plan, setPlan] = useState<SaasPlanKey>('pro')
  const [trial, setTrial] = useState(true)
  const hasTrial = Boolean(saasPlans.find((candidate) => candidate.key === plan)?.trialDays)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onStart({ plan, interval: 'month', seats: 3, trial: hasTrial && trial })
      }}
    >
      <FieldGroup className="flex-row flex-wrap items-end gap-4">
        <Field className="w-auto">
          <FieldLabel htmlFor={`${id}-plan`}>Plan, billed monthly</FieldLabel>
          <Select
            value={plan}
            onValueChange={(value) => {
              const next = saasPlans.find((candidate) => candidate.key === value)
              if (next) {
                setPlan(next.key)
              }
            }}
          >
            <SelectTrigger id={`${id}-plan`} size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {saasPlans.map((candidate) => (
                  <SelectItem key={candidate.key} value={candidate.key}>
                    {candidate.name}
                    {candidate.perSeat ? ' (3 seats)' : ''}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {hasTrial ? (
          <Field orientation="horizontal" className="w-auto">
            <Checkbox
              id={`${id}-trial`}
              checked={trial}
              onCheckedChange={(checked) => setTrial(checked === true)}
            />
            <FieldLabel htmlFor={`${id}-trial`}>Start with the 14-day trial</FieldLabel>
          </Field>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          Start a time-travel subscription
        </Button>
      </FieldGroup>
    </form>
  )
}

function RunControls({
  run,
  busy,
  act,
}: {
  run: TimeTravelView
  busy: string | null
  act: (name: string, action: () => Promise<unknown>) => void
}) {
  const moving = run.clockStatus !== 'ready'
  const disabled = busy !== null || moving
  const unpaid = run.invoices.some((invoice) => invoice.status === 'open')

  async function openPortal() {
    const { url } = await openSaasPortal({ data: { target: 'time-travel' } })
    window.location.assign(url)
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
        <span className="text-sm text-ink">
          Clock: <span className="font-medium"><LocalTime iso={run.clockTime} /></span>
        </span>
        {moving ? (
          <span className="flex items-center gap-1.5 text-sm text-ink-soft">
            <Spinner />
            Moving time forward
          </span>
        ) : null}
      </div>

      {run.subscription ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink">{run.subscription.planName}</span>
            <SubscriptionStatusBadge status={run.subscription.status} />
          </div>
          <span className="text-sm text-ink-soft">
            <NextDate subscription={run.subscription} />
          </span>
        </div>
      ) : (
        <p className="m-0 text-sm text-ink-soft">Waiting for the subscription to sync.</p>
      )}

      <p className="m-0 flex items-center gap-2 text-sm text-ink-soft">
        <CreditCard aria-hidden="true" className="size-4" />
        {run.card.failing
          ? `Card ending ${run.card.last4}: every charge to it is declined`
          : `Card ending ${run.card.last4 ?? '????'}: charges go through`}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={() => act('week', () => advanceSaasTimeTravel({ data: { by: 'week' } }))}>
          {busy === 'week' ? <Spinner data-icon="inline-start" /> : <FastForward data-icon="inline-start" />}
          1 week
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => act('month', () => advanceSaasTimeTravel({ data: { by: 'month' } }))}>
          {busy === 'month' ? <Spinner data-icon="inline-start" /> : <FastForward data-icon="inline-start" />}
          1 month
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            act('card', () => setSaasTimeTravelCard({ data: { card: run.card.failing ? 'working' : 'failing' } }))
          }
        >
          {run.card.failing ? 'Switch to a working card' : 'Make the next charge fail'}
        </Button>
        {unpaid ? (
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => act('retry', () => retrySaasTimeTravelInvoice())}>
            Retry the unpaid invoice now
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => act('portal', openPortal)}>
          Open the portal as this customer
        </Button>
      </div>

      <Separator />
      <div>
        <h3 className="m-0 mb-2 text-[0.8125rem] font-semibold text-ink-soft">
          Invoices for the time-travel customer
        </h3>
        <InvoiceList invoices={run.invoices} />
      </div>

      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={busy !== null}
        onClick={() => act('end', () => endSaasTimeTravel())}
      >
        End time travel and delete the test clock
      </Button>
    </>
  )
}
