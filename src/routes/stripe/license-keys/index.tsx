import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import FlowNotes from '#/components/stripe/FlowNotes'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import { useWebhookWait } from '#/components/stripe/useWebhookWait'
import ActivationTester from '#/components/stripe/license-keys/ActivationTester'
import LicenseOrders from '#/components/stripe/license-keys/LicenseOrders'
import LicenseProducts from '#/components/stripe/license-keys/LicenseProducts'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  getLicenseOrders,
  getLicenseStore,
} from '#/lib/lab/license-keys/license-keys.functions'
import type { LicenseOrderView } from '#/lib/lab/license-keys/licenses.server'

export const Route = createFileRoute('/stripe/license-keys/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'License keys | Stripe Lab' }] }),
  loader: () => getLicenseStore(),
  component: LicenseKeysPage,
})

const ORDERS_KEY = ['license-orders']

/** A fingerprint of everything a webhook can change on an order. */
function orderSignature(order: LicenseOrderView | undefined): string {
  if (!order) {
    return ''
  }
  const keys = order.licenses.map((license) => license.status).join(',')
  return `${order.status}|${order.amountRefunded}|${keys}`
}

function LicenseKeysPage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()

  const [polling, setPolling] = useState(false)
  const { data: orders } = useQuery({
    queryKey: ORDERS_KEY,
    queryFn: () => getLicenseOrders(),
    initialData: store.orders,
    refetchInterval: polling ? 1500 : false,
  })
  const { awaitingId, waitFor } = useWebhookWait(orders, orderSignature)
  useEffect(() => setPolling(awaitingId !== null), [awaitingId])

  // The loader reruns after sign-in or sign-out; keep the orders list in step with it.
  useEffect(() => {
    queryClient.setQueryData(ORDERS_KEY, store.orders)
  }, [store.orders, queryClient])

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== store.signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, store.signedIn, router])

  function refreshOrders() {
    queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
  }

  const knownKeys = orders.flatMap((order) =>
    order.licenses.filter((license) => license.status === 'active').map((license) => license.key),
  )

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="license-keys"
        summary="Charge once, then hand over a key that unlocks the software. Each key works on a set number of devices, and stops working after a full refund or a lost dispute."
      />

      {canceled ? (
        <Alert className="mt-8 max-w-2xl">
          <AlertTitle>You left checkout</AlertTitle>
          <AlertDescription>
            Nothing was charged. The order stays pending until Stripe expires the Checkout Session,
            then it closes.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <LicenseProducts products={store.products} catalogError={store.catalogError} />
          {store.signedIn ? (
            <>
              <LicenseOrders
                orders={orders}
                awaitingOrderId={awaitingId}
                onAction={waitFor}
                onDevicesCleared={refreshOrders}
              />
              <ActivationTester knownKeys={knownKeys} onRequestDone={refreshOrders} />
            </>
          ) : null}
        </div>

        <FlowNotes
          steps={[
            'You pick a license. The server creates a pending order, then a Checkout Session in payment mode.',
            "You pay on Stripe's page. Stripe charges the card once through a Payment Intent.",
            'Stripe sends you to the success page, which waits. Nothing has been issued yet.',
            'checkout.session.completed reaches the webhook. The server marks the order paid and copies its line items.',
            'In the same database transaction, the server issues one key per license bought.',
            'An app sends the key and a device ID to the validate API. Each key works on a set number of devices.',
          ]}
          objects={[
            { name: 'Customer', id: 'cus_…' },
            { name: 'Checkout Session', id: 'cs_test_…' },
            { name: 'Payment Intent', id: 'pi_…' },
            { name: 'Charge', id: 'ch_…' },
            { name: 'Refund', id: 're_…' },
            { name: 'Dispute', id: 'du_…' },
          ]}
          events={[
            {
              type: 'checkout.session.completed',
              note: 'Payment finished. The key is issued here, never on the success page.',
            },
            {
              type: 'charge.refunded',
              note: 'A full refund revokes the key. A partial refund leaves it working.',
            },
            {
              type: 'charge.dispute.created',
              note: 'The buyer disputed the charge with their bank. The key is suspended.',
            },
            {
              type: 'charge.dispute.closed',
              note: 'Won: the key works again. Lost: the key is revoked.',
            },
            {
              type: 'checkout.session.expired',
              note: 'The buyer never paid. The pending order closes.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds' },
            { number: '4000 0000 0000 0002', note: 'Declined' },
            { number: '4000 0025 0000 3155', note: 'Asks for 3D Secure' },
            { number: '4000 0000 0000 0259', note: 'Succeeds, then is disputed' },
          ]}
          production={[
            'Email the key as well. A buyer who closes the tab early never sees the success page.',
            'Store a hash of each key, or sign keys so apps can check them offline.',
            "Rate-limit the validate API so keys can't be guessed.",
            'Let buyers remove old devices themselves.',
          ]}
        />
      </div>
    </main>
  )
}
