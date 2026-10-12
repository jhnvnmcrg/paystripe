import { useState } from 'react'
import InvoiceList from '#/components/stripe/InvoiceList'
import NextBillingDate from '#/components/stripe/NextBillingDate'
import SubscriptionStatusBadge from '#/components/stripe/SubscriptionStatusBadge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import { openSaasPortal } from '#/lib/lab/saas/saas.functions'
import type { SubscriptionView } from '#/lib/lab/saas/saas.server'
import type { InvoiceView } from '#/lib/stripe/billing.server'

interface SubscriptionPanelProps {
  subscription: SubscriptionView | null
  invoices: InvoiceView[]
}

export default function SubscriptionPanel({ subscription, invoices }: SubscriptionPanelProps) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function manageBilling() {
    setOpening(true)
    setError(null)
    try {
      const { url } = await openSaasPortal({ data: { target: 'real' } })
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open the billing portal.')
      setOpening(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your subscription</CardTitle>
        <CardDescription>
          This page reads your plan from the database, kept in sync by Stripe's webhooks.
        </CardDescription>
        {subscription ? (
          <CardAction>
            <Button variant="outline" size="sm" onClick={manageBilling} disabled={opening}>
              {opening ? <Spinner data-icon="inline-start" /> : null}
              Manage billing
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!subscription ? (
          <p className="m-0 text-sm text-ink-soft">
            No plan yet. Pick one above and pay with 4242 4242 4242 4242.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-ink">
                <span className="text-lg font-semibold">{subscription.planName}</span>
                {subscription.seats > 1 ? (
                  <span className="text-sm text-ink-soft">{subscription.seats} seats</span>
                ) : null}
                <span className="amount text-sm text-ink-soft">
                  {formatMoney(subscription.amount, subscription.currency)} per {subscription.interval}
                </span>
              </p>
              <SubscriptionStatusBadge status={subscription.status} />
            </div>
            <p className="m-0 text-sm text-ink-soft">
              <NextBillingDate subscription={subscription} />
            </p>

            <AccessNote subscription={subscription} />

            <Separator />
            <div>
              <h3 className="m-0 mb-2 text-[0.8125rem] font-semibold text-ink-soft">Invoices</h3>
              <InvoiceList invoices={invoices} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** What the stored status means for the customer right now. */
function AccessNote({ subscription }: { subscription: SubscriptionView }) {
  if (subscription.access === 'full') {
    return (
      <Alert>
        <AlertTitle>{subscription.planName} features are unlocked</AlertTitle>
        <AlertDescription>
          Access follows the stored status: {subscription.status === 'trialing' ? 'trialing' : 'active'}{' '}
          means yes.
        </AlertDescription>
      </Alert>
    )
  }
  if (subscription.access === 'grace') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Your last payment failed</AlertTitle>
        <AlertDescription>
          Stripe is retrying it. You keep access for now; update your card in Manage billing to stay
          subscribed.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert>
      <AlertTitle>No access</AlertTitle>
      <AlertDescription>
        This subscription is {subscription.status.replace('_', ' ')}, so its features are locked.
      </AlertDescription>
    </Alert>
  )
}
