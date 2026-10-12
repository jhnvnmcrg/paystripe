import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import { getFreemiumCheckout } from '#/lib/lab/freemium/freemium.functions'

export const Route = createFileRoute('/stripe/freemium/success')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  head: () => ({ meta: [{ title: 'Welcome to Plus | Stripe Lab' }] }),
  component: FreemiumSuccessPage,
})

const SLOW_AFTER_MS = 15_000

function FreemiumSuccessPage() {
  const { session_id: sessionId } = Route.useSearch()
  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto max-w-xl">
        <Link to="/stripe/freemium" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
          Freemium with add-ons
        </Link>
        {sessionId ? (
          <>
            <Show when="signed-in">
              <CheckoutResult sessionId={sessionId} />
            </Show>
            <Show when="signed-out">
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sign in to see your plan</CardTitle>
                  <CardDescription>Plans are shown to the account that upgraded.</CardDescription>
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
            <AlertDescription>This page is where Stripe sends you after upgrading.</AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}

function CheckoutResult({ sessionId }: { sessionId: string }) {
  const [slow, setSlow] = useState(false)
  const { data, error, isPending } = useQuery({
    queryKey: ['freemium-checkout', sessionId],
    queryFn: () => getFreemiumCheckout({ data: { sessionId } }),
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
  if (waiting || !data?.planState) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Spinner />
            Waiting for Stripe to confirm your upgrade
          </CardTitle>
          <CardDescription>Plus unlocks when the webhook stores your new subscription.</CardDescription>
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

  const { planState } = data
  const extras = [
    planState.addons.seats > 0 ? `${planState.addons.seats} extra seats` : null,
    planState.addons.analytics ? 'Advanced analytics' : null,
    planState.addons.support ? 'Priority support' : null,
  ].filter(Boolean)

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-xl">You're on Plus</CardTitle>
        <CardDescription>
          {extras.length > 0 ? `With ${extras.join(', ')}. ` : ''}
          <span className="amount">{formatMoney(planState.monthlyTotal, planState.currency)}</span> per month.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/stripe/freemium">Back to your workspace</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
