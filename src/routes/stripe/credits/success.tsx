import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { getCreditsCheckout } from '#/lib/lab/credits/credits.functions'

export const Route = createFileRoute('/stripe/credits/success')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  head: () => ({ meta: [{ title: 'Credits added | Stripe Lab' }] }),
  component: CreditsSuccessPage,
})

const SLOW_AFTER_MS = 15_000

function CreditsSuccessPage() {
  const { session_id: sessionId } = Route.useSearch()
  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto max-w-xl">
        <Link to="/stripe/credits" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
          Prepaid credits
        </Link>
        {sessionId ? (
          <>
            <Show when="signed-in">
              <CheckoutResult sessionId={sessionId} />
            </Show>
            <Show when="signed-out">
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sign in to see your credits</CardTitle>
                  <CardDescription>They're shown to the account that paid.</CardDescription>
                </CardHeader>
                <CardContent>
                  <SignInButton mode="modal">
                    <Button>Sign in</Button>
                  </SignInButton>
                </CardContent>
              </Card>
            </Show>
          </>
        ) : (
          <Alert className="mt-6">
            <AlertTitle>No checkout to show</AlertTitle>
            <AlertDescription>This page is where Stripe sends you after buying credits or saving a card.</AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}

function CheckoutResult({ sessionId }: { sessionId: string }) {
  const [slow, setSlow] = useState(false)
  const { data, error, isPending } = useQuery({
    queryKey: ['credits-checkout', sessionId],
    queryFn: () => getCreditsCheckout({ data: { sessionId } }),
    refetchInterval: (query) => (query.state.data?.state === 'waiting' ? 1500 : false),
    retry: false,
  })

  const waiting = isPending || data?.state === 'waiting'
  useEffect(() => {
    if (!waiting) {
      return
    }
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [waiting])

  if (error) {
    return (
      <Alert variant="destructive" className="mt-6">
        <AlertTitle>Couldn't load this checkout</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  }
  if (data?.state === 'not-found') {
    return (
      <Alert className="mt-6">
        <AlertTitle>This checkout isn't linked to your account</AlertTitle>
        <AlertDescription>Sign in with the account that started the checkout, then reload this page.</AlertDescription>
      </Alert>
    )
  }
  if (data?.state === 'failed') {
    return (
      <Alert variant="destructive" className="mt-6">
        <AlertTitle>The payment didn't go through</AlertTitle>
        <AlertDescription>No credits were added and nothing was charged.</AlertDescription>
      </Alert>
    )
  }
  if (waiting || data?.state !== 'ready') {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Spinner />
            Waiting for Stripe to confirm
          </CardTitle>
          <CardDescription>This page updates when the webhook has recorded it.</CardDescription>
        </CardHeader>
        {slow ? (
          <CardContent>
            <Alert>
              <AlertTitle>Still waiting</AlertTitle>
              <AlertDescription>
                <p>
                  Is <code>npm run stripe:listen</code> running? Without it, Stripe's events never reach this computer.
                </p>
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
      </Card>
    )
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-xl">
          {data.kind === 'card' ? 'Card saved' : `${data.credits.toLocaleString('en-US')} credits added`}
        </CardTitle>
        <CardDescription>
          {data.kind === 'card' && data.card
            ? `Automatic top-ups will charge your ${data.card.brand} ending ${data.card.last4 ?? '????'}. Turn auto-recharge back on if it was off.`
            : `Your balance is ${data.balance.toLocaleString('en-US')} credits. The card you paid with is saved for automatic top-ups.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/stripe/credits">Back to your credits</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
