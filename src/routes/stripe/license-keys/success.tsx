import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import CopyButton from '#/components/stripe/CopyButton'
import OrderStatusBadge from '#/components/stripe/OrderStatusBadge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import { getLicenseCheckout } from '#/lib/lab/license-keys/license-keys.functions'

export const Route = createFileRoute('/stripe/license-keys/success')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  head: () => ({ meta: [{ title: 'Your license | Stripe Lab' }] }),
  component: LicenseSuccessPage,
})

const SLOW_AFTER_MS = 15_000

function LicenseSuccessPage() {
  const { session_id: sessionId } = Route.useSearch()

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto max-w-xl">
        <Link
          to="/stripe/license-keys"
          className="text-sm font-medium text-ink-soft no-underline hover:text-ink"
        >
          License keys
        </Link>
        {sessionId ? (
          <>
            <Show when="signed-in">
              <CheckoutResult sessionId={sessionId} />
            </Show>
            <Show when="signed-out">
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sign in to see your license</CardTitle>
                  <CardDescription>
                    Keys are only shown to the account that bought them.
                  </CardDescription>
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
              This page is where Stripe sends you after paying. Start from the license keys page.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}

function CheckoutResult({ sessionId }: { sessionId: string }) {
  const [slow, setSlow] = useState(false)

  const { data: order, error, isPending } = useQuery({
    queryKey: ['license-checkout', sessionId],
    queryFn: () => getLicenseCheckout({ data: { sessionId } }),
    // Poll until the webhook has moved the order out of `pending`.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1500 : false),
    retry: false,
  })

  const waiting = isPending || order?.status === 'pending'
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

  if (!isPending && !order) {
    return (
      <Alert className="mt-6">
        <AlertTitle>This checkout isn't linked to your account</AlertTitle>
        <AlertDescription>
          Sign in with the account that started the checkout, then reload this page.
        </AlertDescription>
      </Alert>
    )
  }

  if (waiting) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Spinner />
            Waiting for Stripe to confirm the payment
          </CardTitle>
          <CardDescription>
            Stripe sent you back here, but the redirect isn't proof of payment. Your key is issued
            when the <code>checkout.session.completed</code> webhook reaches the server.
          </CardDescription>
        </CardHeader>
        {slow ? (
          <CardContent>
            <Alert>
              <AlertTitle>Still waiting</AlertTitle>
              <AlertDescription>
                <p>
                  Is <code>npm run stripe:listen</code> running? Without it, Stripe's events never
                  reach this computer. The key appears here as soon as the event arrives.
                </p>
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : null}
      </Card>
    )
  }

  if (!order) {
    return null
  }

  const issued = order.licenses.length > 0

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-xl">
          {issued ? 'Your license is ready' : 'This order has no key'}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span className="amount">{formatMoney(order.amountTotal, order.currency)}</span>
          <OrderStatusBadge status={order.status} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {order.status === 'failed' ? (
          <p className="m-0 text-sm text-ink-soft">
            The payment didn't go through, so no key was issued and nothing was charged.
          </p>
        ) : null}
        {order.licenses.map((license) => (
          <div
            key={license.id}
            className="flex flex-col gap-1 rounded-lg border border-line bg-surface-sunken px-4 py-3"
          >
            <span className="text-sm text-ink-soft">{license.productName}</span>
            <div className="flex items-center gap-2">
              <span className="amount text-xl font-medium tracking-wide text-ink">
                {license.key}
              </span>
              <CopyButton value={license.key} label="Copy license key" />
            </div>
            <span className="text-sm text-ink-soft">
              Works on up to {license.maxActivations} devices.
            </span>
          </div>
        ))}
        {issued ? (
          <Button asChild className="self-start">
            <Link to="/stripe/license-keys" hash="activate">
              Activate it
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
