import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { Check, Minus, Plus } from 'lucide-react'
import { useId, useState } from 'react'
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
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Spinner } from '#/components/ui/spinner'
import { formatPrice } from '#/lib/lab/format'
import { addons, FREE_PROJECT_LIMIT, findAddon, plusPlan } from '#/lib/lab/freemium/catalog'
import { startFreemiumUpgrade } from '#/lib/lab/freemium/freemium.functions'

interface PlanChooserProps {
  prices: Record<string, number | null>
  catalogError: string | null
  seeded: boolean
  plan: 'free' | 'plus'
}

export default function PlanChooser({ prices, catalogError, seeded, plan }: PlanChooserProps) {
  const id = useId()
  const [seats, setSeats] = useState(0)
  const [analytics, setAnalytics] = useState(false)
  const [support, setSupport] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const priceOf = (lookupKey: string) => prices[lookupKey] ?? 0
  const seatAddon = findAddon('seats')
  const total =
    priceOf(plusPlan.lookupKey) +
    (seatAddon ? seats * priceOf(seatAddon.lookupKey) : 0) +
    (analytics ? priceOf(findAddon('analytics')?.lookupKey ?? '') : 0) +
    (support ? priceOf(findAddon('support')?.lookupKey ?? '') : 0)

  async function upgrade() {
    setOpening(true)
    setError(null)
    try {
      const { url } = await startFreemiumUpgrade({ data: { seats, analytics, support } })
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(false)
    }
  }

  return (
    <section aria-labelledby="freemium-plans-heading" className="flex flex-col gap-4">
      <h2 id="freemium-plans-heading" className="m-0 text-xl font-semibold tracking-tight text-ink">
        Plans
      </h2>
      {catalogError ? (
        <Alert variant="destructive">
          <AlertTitle>Prices could not be loaded from Stripe</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      ) : null}
      {!catalogError && !seeded ? (
        <Alert>
          <AlertTitle>Plus isn't in your sandbox yet</AlertTitle>
          <AlertDescription>
            <p>
              Run <code>npm run stripe:seed freemium</code>, then reload this page.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Free
              {plan === 'free' ? <Badge variant="outline">Your plan</Badge> : null}
            </CardTitle>
            <CardDescription>No card, no Stripe customer, nothing to cancel.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <span className="amount text-3xl font-medium text-ink">$0</span>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-ink">
              <li className="flex gap-2">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                {FREE_PROJECT_LIMIT} projects
              </li>
              <li className="flex gap-2">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                Just you
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className={plan === 'plus' ? undefined : 'border-brand'}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {plusPlan.name}
              {plan === 'plus' ? <Badge variant="outline">Your plan</Badge> : null}
            </CardTitle>
            <CardDescription>{plusPlan.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="m-0 flex flex-wrap items-baseline gap-x-1.5">
              <span className="amount text-3xl font-medium text-ink">
                {formatPrice(prices[plusPlan.lookupKey], 'usd')}
              </span>
              <span className="text-sm text-ink-soft">per month</span>
            </p>
            {plan === 'free' ? (
              <FieldGroup className="gap-3">
                <p className="m-0 text-sm font-medium text-ink">Add-ons, if you want them now</p>
                {seatAddon ? (
                  <Field orientation="horizontal" className="items-center">
                    <FieldContent>
                      <FieldLabel>{seatAddon.name}</FieldLabel>
                      <FieldDescription>
                        {formatPrice(prices[seatAddon.lookupKey], 'usd')} per seat per month
                      </FieldDescription>
                    </FieldContent>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon-sm" aria-label="One fewer seat" disabled={seats === 0} onClick={() => setSeats(seats - 1)}>
                        <Minus />
                      </Button>
                      <span className="amount w-6 text-center text-sm">{seats}</span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="One more seat"
                        disabled={seats >= seatAddon.maxQuantity}
                        onClick={() => setSeats(seats + 1)}
                      >
                        <Plus />
                      </Button>
                    </div>
                  </Field>
                ) : null}
                {addons
                  .filter((addon) => !addon.perUnit)
                  .map((addon) => {
                    const checked = addon.key === 'analytics' ? analytics : support
                    const set = addon.key === 'analytics' ? setAnalytics : setSupport
                    return (
                      <Field key={addon.key} orientation="horizontal">
                        <Checkbox
                          id={`${id}-${addon.key}`}
                          checked={checked}
                          onCheckedChange={(value) => set(value === true)}
                        />
                        <FieldContent>
                          <FieldLabel htmlFor={`${id}-${addon.key}`}>{addon.name}</FieldLabel>
                          <FieldDescription>
                            {formatPrice(prices[addon.lookupKey], 'usd')} per month. {addon.description}
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    )
                  })}
              </FieldGroup>
            ) : (
              <p className="m-0 text-sm text-ink-soft">Manage your add-ons below.</p>
            )}
          </CardContent>
          {plan === 'free' ? (
            <CardFooter className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-ink-soft">
                <span className="amount font-medium text-ink">{formatPrice(total, 'usd')}</span> per
                month in total
              </span>
              <Show when="signed-in">
                <Button disabled={!seeded || opening} onClick={upgrade}>
                  {opening ? <Spinner data-icon="inline-start" /> : null}
                  Upgrade to Plus
                </Button>
              </Show>
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <Button variant="outline">Sign in to upgrade</Button>
                </SignInButton>
              </Show>
            </CardFooter>
          ) : null}
        </Card>
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
