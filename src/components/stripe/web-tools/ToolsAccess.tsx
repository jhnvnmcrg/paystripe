import { CircleCheck, Lock } from 'lucide-react'
import { useState } from 'react'
import InvoiceList from '#/components/stripe/InvoiceList'
import NextBillingDate from '#/components/stripe/NextBillingDate'
import SubscriptionStatusBadge from '#/components/stripe/SubscriptionStatusBadge'
import { Alert, AlertDescription } from '#/components/ui/alert'
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
import { toolFeatures } from '#/lib/lab/web-tools/catalog'
import { openToolsPortal } from '#/lib/lab/web-tools/tools.functions'
import type { InvoiceView } from '#/lib/stripe/billing.server'

interface ToolsAccessProps {
  subscription: {
    planName: string
    status: string
    cancelAtPeriodEnd: boolean
    cancelAt: string | null
    currentPeriodEnd: string | null
    trialEnd: string | null
  } | null
  entitlements: string[]
  invoices: InvoiceView[]
}

/** The plan, and the features Stripe says it unlocks right now. */
export default function ToolsAccess({ subscription, entitlements, invoices }: ToolsAccessProps) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function manageBilling() {
    setOpening(true)
    setError(null)
    try {
      const { url } = await openToolsPortal()
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open the billing portal.')
      setOpening(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your access</CardTitle>
        <CardDescription>
          Unlocked features come from Stripe's Entitlements API, cached here and refreshed by webhook.
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

        {subscription ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-lg font-semibold text-ink">{subscription.planName}</span>
              <SubscriptionStatusBadge status={subscription.status} />
            </div>
            <span className="text-sm text-ink-soft">
              <NextBillingDate subscription={subscription} />
            </span>
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-soft">No plan yet, so every tool is locked.</p>
        )}

        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          {toolFeatures.map((feature) => {
            const unlocked = entitlements.includes(feature.lookupKey)
            return (
              <li key={feature.lookupKey} className="flex items-center gap-2.5">
                {unlocked ? (
                  <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
                ) : (
                  <Lock aria-hidden="true" className="size-4 shrink-0 text-ink-soft" />
                )}
                <span className={unlocked ? 'text-ink' : 'text-ink-soft'}>{feature.name}</span>
                <span className="amount text-xs text-ink-soft">{feature.lookupKey}</span>
                <span className="sr-only">{unlocked ? 'unlocked' : 'locked'}</span>
              </li>
            )
          })}
        </ul>

        {subscription ? (
          <>
            <Separator />
            <div>
              <h3 className="m-0 mb-2 text-[0.8125rem] font-semibold text-ink-soft">Invoices</h3>
              <InvoiceList invoices={invoices} />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
