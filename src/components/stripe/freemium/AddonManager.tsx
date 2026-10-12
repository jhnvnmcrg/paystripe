import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import InvoiceList from '#/components/stripe/InvoiceList'
import NextBillingDate from '#/components/stripe/NextBillingDate'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney, formatPrice } from '#/lib/lab/format'
import { addons } from '#/lib/lab/freemium/catalog'
import {
  applyFreemiumAddon,
  previewFreemiumAddon,
  setFreemiumDowngrade,
} from '#/lib/lab/freemium/freemium.functions'
import type { AddonChange, AddonPreview, FreemiumPlanState } from '#/lib/lab/freemium/freemium.server'
import type { InvoiceView } from '#/lib/stripe/billing.server'

interface AddonManagerProps {
  planState: FreemiumPlanState
  prices: Record<string, number | null>
  invoices: InvoiceView[]
  onChanged: () => void
}

function describe(change: AddonChange): string {
  if (change.addon === 'seats') {
    return change.quantity === 0 ? 'Remove all extra seats' : `Change to ${change.quantity} extra seats`
  }
  const name = addons.find((addon) => addon.key === change.addon)?.name ?? change.addon
  return change.enabled ? `Add ${name}` : `Remove ${name}`
}

/** Add-ons on the live subscription: preview the charge, then confirm. */
export default function AddonManager({ planState, prices, invoices, onChanged }: AddonManagerProps) {
  const [pending, setPending] = useState<{ change: AddonChange; preview: AddonPreview } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function preview(change: AddonChange) {
    setBusy('preview')
    setError(null)
    setDone(null)
    try {
      setPending({ change, preview: await previewFreemiumAddon({ data: change }) })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not preview that change.')
    } finally {
      setBusy(null)
    }
  }

  async function confirm() {
    if (!pending) {
      return
    }
    setBusy('apply')
    setError(null)
    try {
      const result = await applyFreemiumAddon({
        data: { change: pending.change, prorationDate: pending.preview.prorationDate },
      })
      setDone(
        result.charged > 0
          ? `${describe(pending.change)}: charged ${formatMoney(result.charged, result.currency)} now.`
          : result.total < 0
            ? `${describe(pending.change)}: ${formatMoney(-result.total, result.currency)} credit for your next invoice.`
            : `${describe(pending.change)}: nothing to pay today.`,
      )
      setPending(null)
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That change failed.')
      setPending(null)
    } finally {
      setBusy(null)
    }
  }

  async function setDowngrade(cancel: boolean) {
    setBusy('downgrade')
    setError(null)
    try {
      await setFreemiumDowngrade({ data: { cancel } })
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That change failed.')
    } finally {
      setBusy(null)
    }
  }

  const seats = planState.addons.seats
  const seatAddon = addons.find((addon) => addon.key === 'seats')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add-ons</CardTitle>
        <CardDescription>
          Each change is previewed first. Confirming charges the prorated difference straight away.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {done ? (
          <Alert>
            <AlertDescription>{done}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Not changed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0 text-sm">
          {seatAddon ? (
            <li className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div>
                <p className="m-0 font-medium text-ink">{seatAddon.name}</p>
                <p className="m-0 text-ink-soft">{formatPrice(prices[seatAddon.lookupKey], 'usd')} per seat per month</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" aria-label="One fewer seat" disabled={seats === 0 || busy !== null} onClick={() => preview({ addon: 'seats', quantity: seats - 1 })}>
                  <Minus />
                </Button>
                <span className="amount w-6 text-center">{seats}</span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="One more seat"
                  disabled={seats >= seatAddon.maxQuantity || busy !== null}
                  onClick={() => preview({ addon: 'seats', quantity: seats + 1 })}
                >
                  <Plus />
                </Button>
              </div>
            </li>
          ) : null}
          {addons
            .filter((addon) => !addon.perUnit)
            .map((addon) => {
              const on = addon.key === 'analytics' ? planState.addons.analytics : planState.addons.support
              const key = addon.key === 'analytics' ? 'analytics' : 'support'
              return (
                <li key={addon.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="m-0 font-medium text-ink">{addon.name}</p>
                    <p className="m-0 text-ink-soft">{formatPrice(prices[addon.lookupKey], 'usd')} per month</p>
                  </div>
                  <Button
                    variant={on ? 'outline' : 'default'}
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => preview({ addon: key, enabled: !on })}
                  >
                    {on ? 'Remove' : 'Add'}
                  </Button>
                </li>
              )
            })}
        </ul>
        {busy === 'preview' ? (
          <p className="m-0 flex items-center gap-2 text-sm text-ink-soft">
            <Spinner />
            Asking Stripe for a preview
          </p>
        ) : null}

        <Separator />
        <div className="flex flex-col gap-2 text-sm">
          <p className="m-0 text-ink">
            Plus with add-ons:{' '}
            <span className="amount font-medium">{formatMoney(planState.monthlyTotal, planState.currency)}</span> per
            month.{' '}
            <span className="text-ink-soft">
              <NextBillingDate
                subscription={{
                  status: planState.status ?? 'active',
                  cancelAtPeriodEnd: planState.cancelAtPeriodEnd,
                  cancelAt: planState.cancelAt,
                  currentPeriodEnd: planState.currentPeriodEnd,
                  trialEnd: planState.trialEnd,
                }}
              />
              .
            </span>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy !== null}
            onClick={() => setDowngrade(!planState.cancelAtPeriodEnd)}
          >
            {busy === 'downgrade' ? <Spinner data-icon="inline-start" /> : null}
            {planState.cancelAtPeriodEnd ? 'Keep Plus after all' : 'Go back to Free at the end of this period'}
          </Button>
        </div>

        <Separator />
        <div>
          <h3 className="m-0 mb-2 text-[0.8125rem] font-semibold text-ink-soft">Invoices</h3>
          <InvoiceList invoices={invoices} />
        </div>
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? null : setPending(null))}>
        <DialogContent>
          {pending ? (
            <>
              <DialogHeader>
                <DialogTitle>{describe(pending.change)}</DialogTitle>
                <DialogDescription>
                  {pending.preview.amountDueNow > 0
                    ? `You'll be charged ${formatMoney(pending.preview.amountDueNow, pending.preview.currency)} today, for the rest of this billing period.`
                    : pending.preview.total < 0
                      ? `Nothing to pay. You'll get ${formatMoney(-pending.preview.total, pending.preview.currency)} credit toward your next invoice.`
                      : 'Nothing to pay today.'}
                </DialogDescription>
              </DialogHeader>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
                {pending.preview.lines.map((line) => (
                  <li key={`${line.description}-${line.amount}`} className="flex justify-between gap-4">
                    <span className="text-ink-soft">{line.description}</span>
                    <span className="amount text-ink">{formatMoney(line.amount, pending.preview.currency)}</span>
                  </li>
                ))}
              </ul>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)} disabled={busy === 'apply'}>
                  Cancel
                </Button>
                <Button onClick={confirm} disabled={busy === 'apply'}>
                  {busy === 'apply' ? <Spinner data-icon="inline-start" /> : null}
                  {pending.preview.amountDueNow > 0
                    ? `Pay ${formatMoney(pending.preview.amountDueNow, pending.preview.currency)} and confirm`
                    : 'Confirm'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
