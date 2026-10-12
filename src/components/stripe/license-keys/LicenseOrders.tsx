import { useState } from 'react'
import CopyButton from '#/components/stripe/CopyButton'
import OrderHeading from '#/components/stripe/OrderHeading'
import SellerActions from '#/components/stripe/SellerActions'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import {
  clearLicenseDevices,
  refundLicenseOrder,
  resolveLicenseDispute,
} from '#/lib/lab/license-keys/license-keys.functions'
import type { LicenseOrderView, LicenseView } from '#/lib/lab/license-keys/licenses.server'

const PARTIAL_REFUND = 1000

const licenseStatusVariant = {
  active: 'default',
  suspended: 'destructive',
  revoked: 'secondary',
} as const

interface LicenseOrdersProps {
  orders: LicenseOrderView[]
  /** The order whose webhook the page is waiting for, if any. */
  awaitingOrderId: string | null
  /** Called after a seller action, so the page polls until the webhook lands. */
  onAction: (orderId: string) => void
  onDevicesCleared: () => void
}

export default function LicenseOrders({
  orders,
  awaitingOrderId,
  onAction,
  onDevicesCleared,
}: LicenseOrdersProps) {
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
          Seller actions call Stripe, then wait for the webhook to change the order and its keys.
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
            No orders yet. Buy a license above with the test card 4242 4242 4242 4242.
          </p>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {orders.map((order) => {
              const awaiting = awaitingOrderId === order.id
              return (
                <li key={order.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                  <OrderHeading order={order} awaiting={awaiting} />

                  {order.licenses.map((license) => (
                    <LicenseRow
                      key={license.id}
                      license={license}
                      busy={busy === license.id}
                      onClearDevices={() =>
                        run(
                          license.id,
                          () => clearLicenseDevices({ data: { licenseId: license.id } }),
                          onDevicesCleared,
                        )
                      }
                    />
                  ))}

                  <SellerActions
                    order={order}
                    partialRefund={PARTIAL_REFUND}
                    disabled={busy !== null || awaiting}
                    onRefund={(amount) =>
                      run(
                        order.id,
                        () => refundLicenseOrder({ data: { orderId: order.id, amount } }),
                        () => onAction(order.id),
                      )
                    }
                    onResolveDispute={(outcome) =>
                      run(
                        order.id,
                        () => resolveLicenseDispute({ data: { orderId: order.id, outcome } }),
                        () => onAction(order.id),
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

function LicenseRow({
  license,
  busy,
  onClearDevices,
}: {
  license: LicenseView
  busy: boolean
  onClearDevices: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="amount text-[0.9375rem] font-medium tracking-wide text-ink">
          {license.key}
        </span>
        <CopyButton value={license.key} label={`Copy ${license.productName} key`} />
        <Badge variant={licenseStatusVariant[license.status]}>
          {license.status === 'active'
            ? 'Active'
            : license.status === 'suspended'
              ? 'Suspended'
              : 'Revoked'}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-soft">
        <span>
          {license.productName}, on {license.activations} of {license.maxActivations} devices
        </span>
        {license.activations > 0 ? (
          <Button variant="ghost" size="xs" disabled={busy} onClick={onClearDevices}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Remove all devices
          </Button>
        ) : null}
      </div>
      {license.statusReason ? (
        <p className="m-0 text-sm text-ink-soft">{license.statusReason}</p>
      ) : null}
    </div>
  )
}
