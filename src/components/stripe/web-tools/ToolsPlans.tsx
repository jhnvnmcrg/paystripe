import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
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
import { formatPrice } from '#/lib/lab/format'
import type { ToolsPlanKey } from '#/lib/lab/web-tools/catalog'
import type { ToolsPlanOffer } from '#/lib/lab/web-tools/tools.functions'
import { startToolsCheckout } from '#/lib/lab/web-tools/tools.functions'

interface ToolsPlansProps {
  plans: ToolsPlanOffer[]
  catalogError: string | null
  currentPlan: ToolsPlanKey | null
}

export default function ToolsPlans({ plans, catalogError, currentPlan }: ToolsPlansProps) {
  const [opening, setOpening] = useState<ToolsPlanKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const notSeeded = !catalogError && plans.some((plan) => plan.price === null)

  async function subscribe(plan: ToolsPlanKey) {
    setOpening(plan)
    setError(null)
    try {
      const { url } = await startToolsCheckout({ data: { plan } })
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(null)
    }
  }

  return (
    <section aria-labelledby="tools-plans-heading" className="flex flex-col gap-4">
      <h2 id="tools-plans-heading" className="m-0 text-xl font-semibold tracking-tight text-ink">
        Plans
      </h2>

      {catalogError ? (
        <Alert variant="destructive">
          <AlertTitle>Plans could not be loaded from Stripe</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      ) : null}
      {notSeeded ? (
        <Alert>
          <AlertTitle>These plans aren't in your sandbox yet</AlertTitle>
          <AlertDescription>
            <p>
              Run <code>npm run stripe:seed web-tools</code>, then reload this page.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.key}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="m-0 flex flex-wrap items-baseline gap-x-1.5">
                <span className="amount whitespace-nowrap text-3xl font-medium text-ink">
                  {formatPrice(plan.price, 'usd')}
                </span>
                <span className="text-sm text-ink-soft">per month</span>
              </p>
              <div>
                <p className="m-0 mb-1.5 text-xs text-ink-soft">
                  {plan.featuresFromStripe ? 'Features attached to this product in Stripe' : 'Features'}
                </p>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-ink">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
            <CardFooter className="mt-auto">
              <Show when="signed-in">
                {currentPlan ? (
                  <Button variant="outline" className="w-full" disabled>
                    {currentPlan === plan.key ? 'Your current plan' : 'Switch in Manage billing'}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant={plan.key === 'pro' ? 'default' : 'outline'}
                    disabled={plan.price === null || opening !== null}
                    onClick={() => subscribe(plan.key)}
                  >
                    {opening === plan.key ? <Spinner data-icon="inline-start" /> : null}
                    Choose {plan.name}
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
        ))}
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
