import { useState } from 'react'
import LocalTime from '#/components/stripe/LocalTime'
import OrderStatusBadge from '#/components/stripe/OrderStatusBadge'
import SellerActions from '#/components/stripe/SellerActions'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { refundCreditOrder, resolveCreditDispute } from '#/lib/lab/credits/credits.functions'
import type { CreditPurchaseView } from '#/lib/lab/credits/credits.server'
import { formatMoney } from '#/lib/lab/format'

const PARTIAL_REFUND = 100

interface CreditPurchasesProps {
  purchases: CreditPurchaseView[]
  onChanged: () => void
}

/** Packs and automatic top-ups. A refund takes the matching credits back. */
export default function CreditPurchases({ purchases, onChanged }: CreditPurchasesProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(id: string, action: () => Promise<unknown>) {
    setBusy(id)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That action failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Purchases</CardTitle>
        <CardDescription>
          Refunding a pack or top-up takes back that share of its credits, but never below zero.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {purchases.length === 0 ? (
          <p className="m-0 text-sm text-ink-soft">Nothing bought yet.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {purchases.map((purchase) => (
              <li key={purchase.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2 text-ink">
                    <Badge variant="outline">{purchase.kind === 'recharge' ? 'Auto-recharge' : 'Pack'}</Badge>
                    <span className="amount">{purchase.credits.toLocaleString('en-US')} credits</span>
                    <OrderStatusBadge status={purchase.status} />
                  </span>
                  <span className="amount text-ink">{formatMoney(purchase.amountTotal, purchase.currency)}</span>
                </div>
                <p className="m-0 text-xs text-ink-soft">
                  <LocalTime iso={purchase.createdAt} />
                  {purchase.creditsTakenBack > 0
                    ? ` · ${purchase.creditsTakenBack.toLocaleString('en-US')} credits taken back`
                    : ''}
                </p>
                {purchase.error ? <p className="m-0 text-sm text-danger">{purchase.error}</p> : null}
                <SellerActions
                  order={purchase}
                  partialRefund={PARTIAL_REFUND}
                  disabled={busy !== null}
                  onRefund={(amount) =>
                    run(purchase.id, () => refundCreditOrder({ data: { orderId: purchase.id, amount } }))
                  }
                  onResolveDispute={(outcome) =>
                    run(purchase.id, () => resolveCreditDispute({ data: { orderId: purchase.id, outcome } }))
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
