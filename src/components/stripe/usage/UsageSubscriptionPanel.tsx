import { useState } from 'react'
import InvoiceList from '#/components/stripe/InvoiceList'
import LocalTime from '#/components/stripe/LocalTime'
import NextBillingDate from '#/components/stripe/NextBillingDate'
import SubscriptionStatusBadge from '#/components/stripe/SubscriptionStatusBadge'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import { openUsagePortal, setUsageCancel } from '#/lib/lab/usage/usage.functions'
import type { UsageSubscriptionView } from '#/lib/lab/usage/usage.server'
import type { InvoiceView } from '#/lib/stripe/billing.server'

interface UsageSubscriptionPanelProps {
  subscription: UsageSubscriptionView
  invoices: InvoiceView[]
  onChanged: () => void
}

export default function UsageSubscriptionPanel({ subscription, invoices, onChanged }: UsageSubscriptionPanelProps) {
  const [busy, setBusy] = useState<'portal' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const live = subscription.access !== 'none'

  async function run(kind: 'portal' | 'cancel', action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your API subscription</CardTitle>
        <CardDescription>
          {subscription.currentPeriodStart ? (
            <>
              This period started <LocalTime iso={subscription.currentPeriodStart} />.
            </>
          ) : null}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run('portal', async () => {
                const { url } = await openUsagePortal()
                window.location.assign(url)
              })
            }
          >
            {busy === 'portal' ? <Spinner data-icon="inline-start" /> : null}
            Manage billing
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-ink-soft">
            <NextBillingDate subscription={subscription} />
            {subscription.cancelAtPeriodEnd ? '. Usage until then is still invoiced.' : ', with this month’s usage.'}
          </span>
          <SubscriptionStatusBadge status={subscription.status} />
        </div>
        {live ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy !== null}
            onClick={() =>
              run('cancel', async () => {
                await setUsageCancel({ data: { cancel: !subscription.cancelAtPeriodEnd } })
                onChanged()
              })
            }
          >
            {busy === 'cancel' ? <Spinner data-icon="inline-start" /> : null}
            {subscription.cancelAtPeriodEnd ? 'Keep API access' : 'Cancel at the end of this period'}
          </Button>
        ) : null}
        <Separator />
        <div>
          <h3 className="m-0 mb-2 text-[0.8125rem] font-semibold text-ink-soft">Invoices</h3>
          <InvoiceList invoices={invoices} />
        </div>
      </CardContent>
    </Card>
  )
}
