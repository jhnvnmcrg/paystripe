import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import LevelBadge from '#/components/stripe/membership/LevelBadge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import { getMembershipCheckout } from '#/lib/lab/membership/membership.functions'

export const Route = createFileRoute('/stripe/membership/success')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  head: () => ({ meta: [{ title: 'Thank you | Stripe Lab' }] }),
  component: MembershipSuccessPage,
})

const SLOW_AFTER_MS = 15_000

function MembershipSuccessPage() {
  const { session_id: sessionId } = Route.useSearch()
  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto max-w-xl">
        <Link to="/stripe/membership" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
          Memberships and patronage
        </Link>
        {sessionId ? (
          <>
            <Show when="signed-in">
              <CheckoutResult sessionId={sessionId} />
            </Show>
            <Show when="signed-out">
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sign in to see your membership</CardTitle>
                  <CardDescription>It's shown to the account that paid.</CardDescription>
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
            <AlertDescription>This page is where Stripe sends you after joining or tipping.</AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}

function CheckoutResult({ sessionId }: { sessionId: string }) {
  const [slow, setSlow] = useState(false)
  const { data, error, isPending } = useQuery({
    queryKey: ['membership-checkout', sessionId],
    queryFn: () => getMembershipCheckout({ data: { sessionId } }),
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
        <AlertDescription>Nothing was charged. You can try again from the membership page.</AlertDescription>
      </Alert>
    )
  }
  if (waiting || (!data?.membership && !data?.tip)) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Spinner />
            Waiting for Stripe to confirm your payment
          </CardTitle>
          <CardDescription>This page updates when the webhook has stored it.</CardDescription>
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
      {data.membership ? (
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
            Welcome in
            {data.membership.level ? <LevelBadge level={data.membership.level} /> : null}
          </CardTitle>
          <CardDescription>
            {data.membership.name},{' '}
            <span className="amount">{formatMoney(data.membership.amount, data.membership.currency)}</span> per{' '}
            {data.membership.interval ?? 'month'}. Your role and the members-only posts are unlocked.
          </CardDescription>
        </CardHeader>
      ) : data.tip ? (
        <CardHeader>
          <CardTitle className="text-xl">Thank you for the tip</CardTitle>
          <CardDescription>
            <span className="amount">{formatMoney(data.tip.amount, data.tip.currency)}</span> received.
            {data.tip.message ? ` Your note: “${data.tip.message}”` : ''}
          </CardDescription>
        </CardHeader>
      ) : null}
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/stripe/membership">Back to memberships</Link>
        </Button>
        {data.membership ? (
          <Button variant="outline" asChild>
            <Link to="/stripe/membership/feed">Read the feed</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
