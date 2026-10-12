import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import FlowNotes from '#/components/stripe/FlowNotes'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import InventoryPanel from '#/components/stripe/shop/InventoryPanel'
import ShopFront from '#/components/stripe/shop/ShopFront'
import ShopOrders from '#/components/stripe/shop/ShopOrders'
import { useWebhookWait } from '#/components/stripe/useWebhookWait'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { getShopInventory, getShopOrders, getShopStore } from '#/lib/lab/shop/shop.functions'
import type { ShopOrderView } from '#/lib/lab/shop/shop.server'

export const Route = createFileRoute('/stripe/shop/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'Physical goods | Stripe Lab' }] }),
  loader: () => getShopStore(),
  component: ShopPage,
})

const ORDERS_KEY = ['shop-orders']
const INVENTORY_KEY = ['shop-inventory']

/** A fingerprint of everything a webhook can change on an order. */
function orderSignature(order: ShopOrderView | undefined): string {
  if (!order) {
    return ''
  }
  const holds = order.holds.map((hold) => hold.status).join(',')
  return `${order.status}|${order.amountRefunded}|${order.fulfillmentStatus}|${holds}`
}

function ShopPage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()

  const [polling, setPolling] = useState(false)
  const { data: orders } = useQuery({
    queryKey: ORDERS_KEY,
    queryFn: () => getShopOrders(),
    initialData: store.orders,
    refetchInterval: polling ? 1500 : false,
  })
  const { data: inventory } = useQuery({
    queryKey: INVENTORY_KEY,
    queryFn: () => getShopInventory(),
    initialData: store.inventory,
    refetchInterval: polling ? 1500 : false,
  })
  const { awaitingId, waitFor } = useWebhookWait(orders, orderSignature)
  useEffect(() => setPolling(awaitingId !== null), [awaitingId])

  // The loader reruns after sign-in or sign-out; keep the queries in step with it.
  useEffect(() => {
    queryClient.setQueryData(ORDERS_KEY, store.orders)
    queryClient.setQueryData(INVENTORY_KEY, store.inventory)
  }, [store.orders, store.inventory, queryClient])

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== store.signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, store.signedIn, router])

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ORDERS_KEY })
    queryClient.invalidateQueries({ queryKey: INVENTORY_KEY })
  }

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="shop"
        summary="Sell things that ship. Stock is held while the buyer is on Stripe's page, sold when the webhook confirms payment, and released if checkout expires. Then the order still has to be shipped."
      />

      {canceled ? (
        <Alert className="mt-8 max-w-2xl">
          <AlertTitle>You left checkout</AlertTitle>
          <AlertDescription>
            Nothing was charged. Your items stay held until the Checkout Session expires, then they
            go back on sale. You can also expire it now from your orders below.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <ShopFront
            products={store.products}
            inventory={inventory}
            catalogError={store.catalogError}
            shippingRates={store.shippingRates}
            holdMinutes={store.holdMinutes}
            maxPerLine={store.maxPerLine}
          />
          {store.signedIn ? (
            <>
              <ShopOrders
                orders={orders}
                awaitingOrderId={awaitingId}
                onAwaitWebhook={waitFor}
                onChanged={refresh}
              />
              <InventoryPanel
                inventory={inventory}
                onReset={(next) => queryClient.setQueryData(INVENTORY_KEY, next)}
              />
            </>
          ) : null}
        </div>

        <FlowNotes
          steps={[
            'You check out. In one database transaction, the server creates a pending order and holds the stock, refusing if any item has run out.',
            "The server opens a Checkout Session that collects a shipping address and phone, offers Standard and Express shipping, and expires when the hold does.",
            "You pay on Stripe's page. checkout.session.completed reaches the webhook: the order is paid, the held units are sold, and the address is saved.",
            'If you never pay, checkout.session.expired arrives instead and the held units go back on sale.',
            "The seller ships the order and records the tracking number, which is also copied into the Payment Intent's metadata.",
          ]}
          objects={[
            { name: 'Customer', id: 'cus_…' },
            { name: 'Checkout Session', id: 'cs_test_…' },
            { name: 'Shipping Rate', id: 'shr_…' },
            { name: 'Payment Intent', id: 'pi_…' },
            { name: 'Refund', id: 're_…' },
          ]}
          events={[
            {
              type: 'checkout.session.completed',
              note: 'Paid. Held units become sold and the order is ready to ship.',
            },
            {
              type: 'checkout.session.expired',
              note: 'Never paid. Held units go back on sale.',
            },
            {
              type: 'charge.refunded',
              note: 'A full refund cancels shipping. The seller decides whether to restock.',
            },
            {
              type: 'charge.dispute.created',
              note: 'An unshipped order is put on hold until the dispute is decided.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds' },
            { number: '4000 0000 0000 0002', note: 'Declined' },
            { number: '4000 0025 0000 3155', note: 'Asks for 3D Secure' },
            { number: '4000 0000 0000 0259', note: 'Succeeds, then is disputed' },
          ]}
          production={[
            'Stripe Tax is off here. Physical goods usually owe sales tax or VAT, which needs a tax registration before automatic_tax collects anything.',
            "Run a scheduled sweep that releases holds past their expiry, in case an expired event is ever missed.",
            'Use real carrier rates (or a shipping app) instead of two fixed rates.',
            'If a shipped order is disputed, submit the carrier and tracking number as dispute evidence (shipping_carrier, shipping_tracking_number).',
            'Email a receipt and the tracking link; the buyer may never revisit this page.',
          ]}
        />
      </div>
    </main>
  )
}
