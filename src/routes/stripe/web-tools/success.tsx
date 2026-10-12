import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CircleCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { findToolFeature } from '#/lib/lab/web-tools/catalog'
import { getToolsCheckout } from '#/lib/lab/web-tools/tools.functions'

export const Route = createFileRoute('/stripe/web-tools/success')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  head: () => ({ meta: [{ title: 'Your tools | Stripe Lab' }] }),
  component: ToolsSuccessPage,
})

const SLOW_AFTER_MS = 15_000

function ToolsSuccessPage() {
  const { session_id: sessionId } = Route.useSearch()
  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto max-w-xl">
        <Link to="/stripe/web-tools" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
          Gated web tools
        </Link>
        {sessionId ? (
          <>
            <Show when="signed-in">
              <CheckoutResult sessionId={sessionId} />
            </Show>
            <Show when="signed-out">
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sign in to see your tools</CardTitle>
                  <CardDescription>Access is shown to the account that subscribed.</CardDescription>
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
            <AlertDescription>This page is where Stripe sends you after subscribing.</AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}

function CheckoutResult({ sessionId }: { sessionId: string }) {
  const [slow, setSlow] = useState(false)
  const { data, error, isPending } = useQuery({
    queryKey: ['tools-checkout', sessionId],
    queryFn: () => getToolsCheckout({ data: { sessionId } }),
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
  if (waiting || !data) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Spinner />
            Waiting for your features to unlock
          </CardTitle>
          <CardDescription>
            Stripe works out what your plan includes, then sends{' '}
            <code>entitlements.active_entitlement_summary.updated</code>.
          </CardDescription>
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
        <CardTitle className="text-xl">Your tools are unlocked</CardTitle>
        <CardDescription>Stripe says your plan includes:</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.entitlements.map((key) => (
            <li key={key} className="flex items-center gap-2 text-ink">
              <CircleCheck aria-hidden="true" className="size-4 text-success" />
              {findToolFeature(key)?.name ?? key}
            </li>
          ))}
        </ul>
        <Button asChild className="self-start">
          <Link to="/stripe/web-tools">Use them</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
