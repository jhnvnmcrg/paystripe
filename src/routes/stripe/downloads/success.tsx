import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import OrderStatusBadge from '#/components/stripe/OrderStatusBadge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import { getDownloadCheckout, getDownloadLink } from '#/lib/lab/downloads/downloads.functions'

export const Route = createFileRoute('/stripe/downloads/success')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  head: () => ({ meta: [{ title: 'Your downloads | Stripe Lab' }] }),
  component: DownloadSuccessPage,
})

const SLOW_AFTER_MS = 15_000

function DownloadSuccessPage() {
  const { session_id: sessionId } = Route.useSearch()

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto max-w-xl">
        <Link to="/stripe/downloads" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
          Digital downloads
        </Link>
        {sessionId ? (
          <>
            <Show when="signed-in">
              <CheckoutResult sessionId={sessionId} />
            </Show>
            <Show when="signed-out">
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sign in to see your downloads</CardTitle>
                  <CardDescription>Files are only shown to the account that bought them.</CardDescription>
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
              This page is where Stripe sends you after paying. Start from the downloads page.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}

function CheckoutResult({ sessionId }: { sessionId: string }) {
  const [slow, setSlow] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const { data: order, error, isPending, refetch } = useQuery({
    queryKey: ['download-checkout', sessionId],
    queryFn: () => getDownloadCheckout({ data: { sessionId } }),
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

  async function download(grantId: string) {
    setDownloadError(null)
    try {
      const link = await getDownloadLink({ data: { grantId } })
      window.location.assign(link.url)
      window.setTimeout(() => refetch(), 1500)
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : 'Could not get a download link.')
    }
  }

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
            Stripe sent you back here, but the redirect isn't proof of payment. Your files unlock
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
                  reach this computer.
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

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-xl">
          {order.grants.length > 0 ? 'Your files are ready' : 'This order has no files'}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span className="amount">{formatMoney(order.amountTotal, order.currency)}</span>
          {order.amountDiscount > 0 ? (
            <span className="amount text-success">
              {formatMoney(order.amountDiscount, order.currency)} discount
            </span>
          ) : null}
          <OrderStatusBadge status={order.status} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {order.status === 'failed' ? (
          <p className="m-0 text-sm text-ink-soft">
            The payment didn't go through, so nothing was unlocked and nothing was charged.
          </p>
        ) : null}
        {order.grants.map((grant) => (
          <div
            key={grant.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-4 py-3"
          >
            <div className="flex flex-col">
              <span className="font-medium text-ink">{grant.productName}</span>
              <span className="text-sm text-ink-soft">
                {grant.maxDownloads - grant.downloadsUsed} of {grant.maxDownloads} downloads left
              </span>
            </div>
            <Button
              size="sm"
              disabled={grant.status !== 'active' || grant.downloadsUsed >= grant.maxDownloads}
              onClick={() => download(grant.id)}
            >
              Download
            </Button>
          </div>
        ))}
        {downloadError ? <p className="m-0 text-sm text-danger">{downloadError}</p> : null}
        {order.grants.length > 0 ? (
          <Button asChild variant="outline" className="self-start">
            <Link to="/stripe/downloads">Go to your library</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
