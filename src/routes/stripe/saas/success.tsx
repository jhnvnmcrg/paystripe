import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import SubscriptionStatusBadge from '#/components/stripe/SubscriptionStatusBadge'
import NextBillingDate from '#/components/stripe/NextBillingDate'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import { getSaasCheckout } from '#/lib/lab/saas/saas.functions'

export const Route = createFileRoute('/stripe/saas/success')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  head: () => ({ meta: [{ title: 'Your subscription | Stripe Lab' }] }),
  component: SaasSuccessPage,
})

const SLOW_AFTER_MS = 15_000

function SaasSuccessPage() {
  const { session_id: sessionId } = Route.useSearch()

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto max-w-xl">
        <Link to="/stripe/saas" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
          SaaS subscriptions
        </Link>
        {sessionId ? (
          <>
            <Show when="signed-in">
              <CheckoutResult sessionId={sessionId} />
            </Show>
            <Show when="signed-out">
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sign in to see your subscription</CardTitle>
                  <CardDescription>Subscriptions are only shown to the account that started them.</CardDescription>
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
            <AlertDescription>
              This page is where Stripe sends you after subscribing. Start from the plans page.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}

function CheckoutResult({ sessionId }: { sessionId: string }) {
  const [slow, setSlow] = useState(false)
  const { data, error, isPending } = useQuery({
    queryKey: ['saas-checkout', sessionId],
    queryFn: () => getSaasCheckout({ data: { sessionId } }),
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

  if (waiting || !data?.subscription) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Spinner />
            Waiting for Stripe to confirm your subscription
          </CardTitle>
          <CardDescription>
            Your plan unlocks when the webhook stores the new subscription.
          </CardDescription>
        </CardHeader>
        {slow ? (
          <CardContent>
            <Alert>
              <AlertTitle>Still waiting</AlertTitle>
              <AlertDescription>
                <p>
                  Is <code>npm run stripe:listen</code> running? Without it, Stripe's events never
                  reach this computer.
                </p>
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
      </Card>
    )
  }

  const subscription = data.subscription
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-xl">
          {subscription.status === 'trialing' ? 'Your trial has started' : `You're on ${subscription.planName}`}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>
            {subscription.planName}
            {subscription.seats > 1 ? `, ${subscription.seats} seats` : ''}
          </span>
          <span className="amount">
            {formatMoney(subscription.amount, subscription.currency)} per {subscription.interval}
          </span>
          <SubscriptionStatusBadge status={subscription.status} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="m-0 text-ink-soft">
          <NextBillingDate subscription={subscription} />
        </p>
        <Button asChild variant="outline" className="self-start">
          <Link to="/stripe/saas">See your subscription</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
