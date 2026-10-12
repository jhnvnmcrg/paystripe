import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { Gauge, ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { formatUnitPrice, usageMeters } from '#/lib/lab/usage/catalog'
import { startUsageCheckout } from '#/lib/lab/usage/usage.functions'

interface RateCardProps {
  seeded: boolean
  catalogError: string | null
  subscribed: boolean
}

/** The price list, and the button that subscribes with nothing due today. */
export default function RateCard({ seeded, catalogError, subscribed }: RateCardProps) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function subscribe() {
    setOpening(true)
    setError(null)
    try {
      const { url } = await startUsageCheckout()
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lab API pricing</CardTitle>
        <CardDescription>No monthly fee. Each month's usage is invoiced at the end of the month.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {catalogError ? (
          <Alert variant="destructive">
            <AlertTitle>Prices could not be loaded from Stripe</AlertTitle>
            <AlertDescription>{catalogError}</AlertDescription>
          </Alert>
        ) : null}
        {!catalogError && !seeded ? (
          <Alert>
            <AlertTitle>The meters and prices aren't in your sandbox yet</AlertTitle>
            <AlertDescription>
              <p>
                Run <code>npm run stripe:seed usage</code>, then reload this page.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {usageMeters.map((meter) => (
            <li key={meter.key} className="rounded-lg border border-line bg-surface-sunken p-3">
              <p className="m-0 flex items-center gap-2 text-sm font-medium text-ink">
                {meter.key === 'requests' ? (
                  <Gauge aria-hidden="true" className="size-4 text-brand" />
                ) : (
                  <ImageIcon aria-hidden="true" className="size-4 text-brand" />
                )}
                {meter.productName}
              </p>
              <p className="amount m-0 mt-1 text-lg text-ink">{formatUnitPrice(meter)}</p>
              <p className="m-0 text-sm text-ink-soft">
                {meter.freeUnits > 0
                  ? `First ${meter.freeUnits.toLocaleString('en-US')} free every month`
                  : 'From the first one'}
              </p>
            </li>
          ))}
        </ul>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter>
        <Show when="signed-in">
          {subscribed ? (
            <Button variant="outline" disabled>
              You have API access
            </Button>
          ) : (
            <Button disabled={!seeded || opening} onClick={subscribe}>
              {opening ? <Spinner data-icon="inline-start" /> : null}
              Get API access, $0 today
            </Button>
          )}
        </Show>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button variant="outline">Sign in to get API access</Button>
          </SignInButton>
        </Show>
      </CardFooter>
    </Card>
  )
}
