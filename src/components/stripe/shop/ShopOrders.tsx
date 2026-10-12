import { useId, useState } from 'react'
import LocalTime from '#/components/stripe/LocalTime'
import OrderHeading from '#/components/stripe/OrderHeading'
import SellerActions from '#/components/stripe/SellerActions'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import type { Carrier } from '#/lib/lab/shop/catalog'
import { carriers } from '#/lib/lab/shop/catalog'
import {
  expireShopCheckout,
  markShopOrderShipped,
  refundShopOrder,
  resolveShopDispute,
  restockShopOrder,
} from '#/lib/lab/shop/shop.functions'
import type { ShopOrderView } from '#/lib/lab/shop/shop.server'

const PARTIAL_REFUND = 500

const fulfillmentLabels: Record<string, { text: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  unfulfilled: { text: 'Ready to ship', variant: 'outline' },
  on_hold: { text: 'Shipping on hold', variant: 'destructive' },
  shipped: { text: 'Shipped', variant: 'default' },
  canceled: { text: 'Not shipping', variant: 'secondary' },
}

interface ShopOrdersProps {
  orders: ShopOrderView[]
  awaitingOrderId: string | null
  /** After an action whose outcome arrives by webhook. */
  onAwaitWebhook: (orderId: string) => void
  /** After an action that changes the database directly. */
  onChanged: () => void
}

export default function ShopOrders({ orders, awaitingOrderId, onAwaitWebhook, onChanged }: ShopOrdersProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(id: string, action: () => Promise<unknown>, after: () => void) {
    setBusy(id)
    setError(null)
    try {
      await action()
      after()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That action failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your orders</CardTitle>
        <CardDescription>
          Payment state comes from Stripe's webhooks. Shipping state is the seller's job.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {orders.length === 0 ? (
          <p className="m-0 text-sm text-ink-soft">
            No orders yet. Add something to the cart and pay with 4242 4242 4242 4242.
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {orders.map((order) => {
              const awaiting = awaitingOrderId === order.id
              const fulfillment = order.fulfillmentStatus
                ? fulfillmentLabels[order.fulfillmentStatus]
                : null
              const held = order.holds.filter((hold) => hold.status === 'held')

              return (
                <li key={order.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                  <OrderHeading order={order} awaiting={awaiting} />

                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                    {(order.items.length > 0
                      ? order.items
                      : order.holds.map((hold) => ({
                          description: hold.label,
                          quantity: hold.quantity,
                          amountTotal: null,
                        }))
                    ).map((item) => (
                      <li key={item.description} className="flex justify-between gap-3">
                        <span className="text-ink">
                          {item.quantity} x {item.description}
                        </span>
                        {item.amountTotal !== null ? (
                          <span className="amount text-ink-soft">
                            {formatMoney(item.amountTotal, order.currency)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {order.amountShipping > 0 ? (
                      <li className="flex justify-between gap-3">
                        <span className="text-ink">
                          Shipping{order.shipping?.method ? `, ${order.shipping.method}` : ''}
                        </span>
                        <span className="amount text-ink-soft">
                          {formatMoney(order.amountShipping, order.currency)}
                        </span>
                      </li>
                    ) : null}
                  </ul>

                  {held.length > 0 ? (
                    <p className="m-0 text-sm text-ink-soft">
                      Holding stock until <LocalTime iso={held[0].expiresAt} />. If checkout isn't
                      finished by then, Stripe expires it and the stock is released.
                    </p>
                  ) : null}

                  {order.shipping ? (
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-sm">
                      <address className="not-italic text-ink">
                        {order.shipping.name}
                        <br />
                        {[order.shipping.address.line1, order.shipping.address.line2]
                          .filter(Boolean)
                          .join(', ')}
                        <br />
                        {[
                          order.shipping.address.city,
                          order.shipping.address.state,
                          order.shipping.address.postal_code,
                          order.shipping.address.country,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        {order.shipping.phone ? (
                          <>
                            <br />
                            {order.shipping.phone}
                          </>
                        ) : null}
                      </address>
                      {fulfillment ? <Badge variant={fulfillment.variant}>{fulfillment.text}</Badge> : null}
                    </div>
                  ) : null}

                  {order.shipment ? (
                    <p className="m-0 text-sm text-ink-soft">
                      Shipped with {order.shipment.carrier}, tracking{' '}
                      <span className="amount text-ink">{order.shipment.trackingNumber}</span>, on{' '}
                      <LocalTime iso={order.shipment.shippedAt} />. The tracking number is also in
                      the Payment Intent's metadata in Stripe.
                    </p>
                  ) : null}

                  {order.fulfillmentStatus === 'unfulfilled' &&
                  (order.status === 'paid' || order.status === 'partially_refunded') ? (
                    <MarkShippedForm
                      busy={busy === order.id}
                      disabled={busy !== null || awaiting}
                      onShip={(carrier, trackingNumber) =>
                        run(
                          order.id,
                          () => markShopOrderShipped({ data: { orderId: order.id, carrier, trackingNumber } }),
                          onChanged,
                        )
                      }
                    />
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {order.status === 'pending' && held.length > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null || awaiting}
                        onClick={() =>
                          run(order.id, () => expireShopCheckout({ data: { orderId: order.id } }), () =>
                            onAwaitWebhook(order.id),
                          )
                        }
                      >
                        Expire this checkout now
                      </Button>
                    ) : null}
                    {order.restockable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null || awaiting}
                        onClick={() =>
                          run(order.id, () => restockShopOrder({ data: { orderId: order.id } }), onChanged)
                        }
                      >
                        Put the items back in stock
                      </Button>
                    ) : null}
                  </div>

                  <SellerActions
                    order={order}
                    partialRefund={PARTIAL_REFUND}
                    disabled={busy !== null || awaiting}
                    onRefund={(amount) =>
                      run(order.id, () => refundShopOrder({ data: { orderId: order.id, amount } }), () =>
                        onAwaitWebhook(order.id),
                      )
                    }
                    onResolveDispute={(outcome) =>
                      run(
                        order.id,
                        () => resolveShopDispute({ data: { orderId: order.id, outcome } }),
                        () => onAwaitWebhook(order.id),
                      )
                    }
                  />
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function MarkShippedForm({
  busy,
  disabled,
  onShip,
}: {
  busy: boolean
  disabled: boolean
  onShip: (carrier: Carrier, trackingNumber: string) => void
}) {
  const id = useId()
  const [carrier, setCarrier] = useState<Carrier>('UPS')
  const [trackingNumber, setTrackingNumber] = useState('')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onShip(carrier, trackingNumber)
      }}
    >
      <FieldGroup className="flex-row flex-wrap items-end gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor={`${id}-carrier`}>Carrier</FieldLabel>
          <Select
            value={carrier}
            onValueChange={(value) => {
              const next = carriers.find((name) => name === value)
              if (next) {
                setCarrier(next)
              }
            }}
          >
            <SelectTrigger id={`${id}-carrier`} size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {carriers.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field className="w-auto min-w-48 flex-1">
          <FieldLabel htmlFor={`${id}-tracking`}>Tracking number</FieldLabel>
          <Input
            id={`${id}-tracking`}
            className="amount h-8"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            placeholder="1Z999AA10123456784"
            minLength={4}
            maxLength={40}
            required
          />
        </Field>
        <Button type="submit" size="sm" disabled={disabled}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          Mark shipped
        </Button>
      </FieldGroup>
    </form>
  )
}
