import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { Check, Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import { formatPrice } from '#/lib/lab/format'
import type { BillingInterval, SaasPlan, SaasPlanKey } from '#/lib/lab/saas/catalog'
import { lookupKeyFor, saasPlans } from '#/lib/lab/saas/catalog'
import { startSaasCheckout } from '#/lib/lab/saas/saas.functions'

interface PricingTableProps {
  prices: Record<string, number | null>
  catalogError: string | null
  /** The plan the user already has, if their subscription is still live. */
  currentPlan: SaasPlanKey | null
}

export default function PricingTable({ prices, catalogError, currentPlan }: PricingTableProps) {
  const [interval, setBillingInterval] = useState<BillingInterval>('month')
  const [seats, setSeats] = useState(3)
  const [opening, setOpening] = useState<SaasPlanKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const notSeeded = !catalogError && Object.keys(prices).length < saasPlans.length * 2

  async function subscribe(plan: SaasPlan) {
    setOpening(plan.key)
    setError(null)
    try {
      const { url } = await startSaasCheckout({ data: { plan: plan.key, interval, seats } })
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(null)
    }
  }

  return (
    <section aria-labelledby="plans-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="plans-heading" className="m-0 text-xl font-semibold tracking-tight text-ink">
          Plans
        </h2>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={interval}
          onValueChange={(value) => {
            if (value === 'month' || value === 'year') {
              setBillingInterval(value)
            }
          }}
          aria-label="Billing interval"
        >
          <ToggleGroupItem value="month">Monthly</ToggleGroupItem>
          <ToggleGroupItem value="year">Yearly, 2 months free</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {catalogError ? (
        <Alert variant="destructive">
          <AlertTitle>Prices could not be loaded from Stripe</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      ) : null}
      {notSeeded ? (
        <Alert>
          <AlertTitle>These plans aren't in your sandbox yet</AlertTitle>
          <AlertDescription>
            <p>
              Run <code>npm run stripe:seed saas</code>, then reload this page.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {saasPlans.map((plan) => {
          const unit = prices[lookupKeyFor(plan.key, interval)]
          const isCurrent = currentPlan === plan.key
          return (
            <Card key={plan.key} className={plan.key === 'pro' ? 'border-brand' : undefined}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {plan.name}
                  {plan.trialDays ? <Badge variant="outline">{plan.trialDays}-day trial</Badge> : null}
                </CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="m-0 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="amount whitespace-nowrap text-3xl font-medium text-ink">
                    {unit !== undefined ? formatPrice(unit, 'usd') : '—'}
                  </span>
                  <span className="text-sm text-ink-soft">
                    {plan.perSeat ? 'per seat ' : ''}per {interval}
                  </span>
                </p>
                {plan.perSeat ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="One fewer seat"
                      disabled={seats <= (plan.minSeats ?? 1)}
                      onClick={() => setSeats(seats - 1)}
                    >
                      <Minus />
                    </Button>
                    <span className="amount w-6 text-center">{seats}</span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label="One more seat"
                      disabled={seats >= (plan.maxSeats ?? 50)}
                      onClick={() => setSeats(seats + 1)}
                    >
                      <Plus />
                    </Button>
                    <span className="text-ink-soft">
                      seats,{' '}
                      <span className="amount text-ink">
                        {unit !== undefined && unit !== null ? formatPrice(unit * seats, 'usd') : '—'}
                      </span>{' '}
                      per {interval}
                    </span>
                  </div>
                ) : null}
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-ink">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="mt-auto">
                <Show when="signed-in">
                  {currentPlan ? (
                    <Button variant="outline" className="w-full" disabled>
                      {isCurrent ? 'Your current plan' : 'Switch in Manage billing'}
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant={plan.key === 'pro' ? 'default' : 'outline'}
                      disabled={unit === undefined || opening !== null}
                      onClick={() => subscribe(plan)}
                    >
                      {opening === plan.key ? <Spinner data-icon="inline-start" /> : null}
                      {plan.trialDays ? `Start ${plan.trialDays}-day trial` : `Choose ${plan.name}`}
                    </Button>
                  )}
                </Show>
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <Button variant="outline" className="w-full">
                      Sign in to subscribe
                    </Button>
                  </SignInButton>
                </Show>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Checkout didn't open</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
