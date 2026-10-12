import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import AssetCart from '#/components/stripe/downloads/AssetCart'
import DownloadLibrary from '#/components/stripe/downloads/DownloadLibrary'
import FlowNotes from '#/components/stripe/FlowNotes'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import { useWebhookWait } from '#/components/stripe/useWebhookWait'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { getDownloadOrders, getDownloadStore } from '#/lib/lab/downloads/downloads.functions'
import type { DownloadOrderView } from '#/lib/lab/downloads/downloads.server'

export const Route = createFileRoute('/stripe/downloads/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'Digital downloads | Stripe Lab' }] }),
  loader: () => getDownloadStore(),
  component: DownloadsPage,
})

const ORDERS_KEY = ['download-orders']

/** A fingerprint of everything a webhook can change on an order. */
function orderSignature(order: DownloadOrderView | undefined): string {
  if (!order) {
    return ''
  }
  const grants = order.grants.map((grant) => grant.status).join(',')
  return `${order.status}|${order.amountRefunded}|${grants}`
}

function DownloadsPage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()

  const [polling, setPolling] = useState(false)
  const { data: orders } = useQuery({
    queryKey: ORDERS_KEY,
    queryFn: () => getDownloadOrders(),
    initialData: store.orders,
    refetchInterval: polling ? 1500 : false,
  })
  const { awaitingId, waitFor } = useWebhookWait(orders, orderSignature)
  useEffect(() => setPolling(awaitingId !== null), [awaitingId])

  // The loader reruns after sign-in or sign-out; keep the library in step with it.
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

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="downloads"
        summary="Sell files once and deliver them through links that expire. The buyer pays for a cart, the webhook grants each file, and every download is counted against a limit."
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

      {!store.signingReady ? (
        <Alert variant="destructive" className="mt-8 max-w-2xl">
          <AlertTitle>Download links can't be signed yet</AlertTitle>
          <AlertDescription>
            <p>
              Add <code>DOWNLOAD_SIGNING_SECRET</code> to <code>.env.local</code> with at least 32
              random characters, then restart the dev server.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <AssetCart
            assets={store.assets}
            catalogError={store.catalogError}
            promotion={store.promotion}
          />
          {store.signedIn ? (
            <DownloadLibrary
              orders={orders}
              awaitingOrderId={awaitingId}
              onAction={waitFor}
              onDownloaded={refreshOrders}
            />
          ) : null}
        </div>

        <FlowNotes
          steps={[
            'You pick one or more files. The server creates a pending order and one Checkout Session with a line item for each.',
            "On Stripe's page you can enter LAUNCH20. Stripe applies the coupon and charges the discounted total.",
            'checkout.session.completed reaches the webhook. The server marks the order paid, copies the line items, and creates one download grant per file.',
            'Download asks the server for a link. It signs the grant ID and an expiry time with a secret, so the link works for 10 minutes.',
            'The download route checks the signature and expiry, counts the download against the limit of 5, then sends the file.',
          ]}
          objects={[
            { name: 'Customer', id: 'cus_…' },
            { name: 'Checkout Session', id: 'cs_test_…' },
            { name: 'Payment Intent', id: 'pi_…' },
            { name: 'Coupon', id: 'lab_launch20' },
            { name: 'Promotion Code', id: 'promo_…' },
            { name: 'Refund', id: 're_…' },
          ]}
          events={[
            {
              type: 'checkout.session.completed',
              note: 'Payment finished. One download grant per file is created here.',
            },
            {
              type: 'charge.refunded',
              note: 'A full refund revokes the downloads. A partial refund leaves them.',
            },
            {
              type: 'charge.dispute.created',
              note: 'The buyer disputed the charge. Downloads are suspended.',
            },
            {
              type: 'charge.dispute.closed',
              note: 'Won: downloads come back. Lost: they are revoked.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds' },
            { number: '4000 0000 0000 0002', note: 'Declined' },
            { number: '4000 0025 0000 3155', note: 'Asks for 3D Secure' },
            { number: '4000 0000 0000 0259', note: 'Succeeds, then is disputed' },
          ]}
          production={[
            'Keep files in private object storage (S3, R2, Vercel Blob) and hand out presigned URLs, for example getSignedUrl(client, new GetObjectCommand(…), { expiresIn: 600 }).',
            "Files in a project folder aren't bundled into Vercel functions, so a deploy needs object storage anyway.",
            'Count a download when it finishes, or allow a few retries, so a dropped connection does not use one up.',
            'Stamp the buyer email into files that are easy to share.',
          ]}
        />
      </div>
    </main>
  )
}
