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
import { getShopCheckout } from '#/lib/lab/shop/shop.functions'

export const Route = createFileRoute('/stripe/shop/success')({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === 'string' ? { session_id: search.session_id } : {},
  head: () => ({ meta: [{ title: 'Your order | Stripe Lab' }] }),
  component: ShopSuccessPage,
})

const SLOW_AFTER_MS = 15_000

function ShopSuccessPage() {
  const { session_id: sessionId } = Route.useSearch()

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto max-w-xl">
        <Link to="/stripe/shop" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
          Physical goods
        </Link>
        {sessionId ? (
          <>
            <Show when="signed-in">
              <CheckoutResult sessionId={sessionId} />
            </Show>
            <Show when="signed-out">
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Sign in to see your order</CardTitle>
                  <CardDescription>Orders are only shown to the account that placed them.</CardDescription>
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
              This page is where Stripe sends you after paying. Start from the shop.
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
    queryKey: ['shop-checkout', sessionId],
    queryFn: () => getShopCheckout({ data: { sessionId } }),
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
            Your items are held for you. They count as sold when the{' '}
            <code>checkout.session.completed</code> webhook reaches the server.
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
          {order.status === 'paid' ? 'Order confirmed' : 'Order update'}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span className="amount">{formatMoney(order.amountTotal, order.currency)}</span>
          <OrderStatusBadge status={order.status} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {order.status === 'failed' ? (
          <p className="m-0 text-ink-soft">
            The payment didn't go through. Your items were released and nothing was charged.
          </p>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {order.items.map((item) => (
            <li key={item.description} className="flex justify-between gap-3">
              <span className="text-ink">
                {item.quantity} x {item.description}
              </span>
              <span className="amount text-ink-soft">{formatMoney(item.amountTotal, order.currency)}</span>
            </li>
          ))}
          {order.amountShipping > 0 ? (
            <li className="flex justify-between gap-3">
              <span className="text-ink">Shipping{order.shipping?.method ? `, ${order.shipping.method}` : ''}</span>
              <span className="amount text-ink-soft">{formatMoney(order.amountShipping, order.currency)}</span>
            </li>
          ) : null}
        </ul>
        {order.shipping ? (
          <address className="not-italic rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-ink">
            Shipping to {order.shipping.name}, {order.shipping.address.line1}, {order.shipping.address.city}{' '}
            {order.shipping.address.postal_code}, {order.shipping.address.country}
          </address>
        ) : null}
        <Button asChild variant="outline" className="self-start">
          <Link to="/stripe/shop">Back to the shop</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
