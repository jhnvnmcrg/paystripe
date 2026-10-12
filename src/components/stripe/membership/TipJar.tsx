import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { HandHeart } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { formatPrice } from '#/lib/lab/format'
import { tipJar } from '#/lib/lab/membership/catalog'
import { startTipCheckout } from '#/lib/lab/membership/membership.functions'

/** A one-time tip. Members and non-members alike; the amount is chosen on Stripe's page. */
export default function TipJar({ seeded }: { seeded: boolean }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function tip() {
    setOpening(true)
    setError(null)
    try {
      const { url } = await startTipCheckout()
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HandHeart aria-hidden="true" className="size-4 text-brand" />
          Leave a tip
        </CardTitle>
        <CardDescription>
          Once, any amount from {formatPrice(tipJar.minimum, 'usd')} to {formatPrice(tipJar.maximum, 'usd')}.
          You type it on Stripe's page, and can leave a note for the wall.
        </CardDescription>
      </CardHeader>
      {error ? (
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      ) : null}
      <CardFooter className="mt-auto">
        <Show when="signed-in">
          <Button variant="outline" disabled={!seeded || opening} onClick={tip}>
            {opening ? <Spinner data-icon="inline-start" /> : null}
            Choose an amount
          </Button>
        </Show>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button variant="outline">Sign in to tip</Button>
          </SignInButton>
        </Show>
      </CardFooter>
    </Card>
  )
}
