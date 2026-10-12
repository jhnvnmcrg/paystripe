import { CreditCard } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { Switch } from '#/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import type { PackKey } from '#/lib/lab/credits/catalog'
import { creditPacks, findPack } from '#/lib/lab/credits/catalog'
import { saveRechargeSettings, startCardSetup } from '#/lib/lab/credits/credits.functions'
import type { CreditAccountView, RechargeResult } from '#/lib/lab/credits/credits.server'

interface AutoRechargeProps {
  account: CreditAccountView
  onChanged: () => void
}

/** Top up off-session when the balance drops under a threshold, with the saved card. */
export default function AutoRecharge({ account, onChanged }: AutoRechargeProps) {
  const id = useId()
  const [enabled, setEnabled] = useState(account.autoRecharge)
  const [threshold, setThreshold] = useState(String(account.rechargeThreshold))
  const [pack, setPack] = useState<PackKey>(account.rechargePack)
  const [busy, setBusy] = useState<'save' | 'card' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RechargeResult | null | 'saved'>(null)
  const amount = Number(threshold)
  const chosen = findPack(pack)

  // A declined top-up switches auto-recharge off on the server; show that.
  useEffect(() => {
    setEnabled(account.autoRecharge)
  }, [account.autoRecharge])

  async function save() {
    setBusy('save')
    setError(null)
    setResult(null)
    try {
      const { recharge } = await saveRechargeSettings({ data: { enabled, threshold: amount, pack } })
      setResult(recharge ?? 'saved')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.')
    } finally {
      setBusy(null)
    }
  }

  async function replaceCard() {
    setBusy('card')
    setError(null)
    try {
      const { url } = await startCardSetup()
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open Checkout.')
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Auto-recharge</CardTitle>
        <CardDescription>
          When an action takes your balance under the threshold, the server charges your saved card for a
          pack, with nobody at the keyboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {account.rechargeError ? (
          <Alert variant="destructive">
            <AlertTitle>Your last automatic top-up was declined</AlertTitle>
            <AlertDescription>
              <p>
                {account.rechargeError} Auto-recharge is off until you replace the card or turn it back on.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-ink">
            <CreditCard aria-hidden="true" className="size-4 text-ink-soft" />
            {account.card ? (
              <>
                <span className="capitalize">{account.card.brand}</span>
                <span className="amount">•••• {account.card.last4 ?? '????'}</span>
              </>
            ) : (
              'No saved card. Buying a pack saves one.'
            )}
          </span>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={replaceCard}>
            {busy === 'card' ? <Spinner data-icon="inline-start" /> : null}
            {account.card ? 'Replace card' : 'Save a card'}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id={`${id}-enabled`}
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!account.card}
          />
          <label htmlFor={`${id}-enabled`} className="text-sm text-ink">
            Recharge automatically
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <Field className="w-40">
            <FieldLabel htmlFor={`${id}-threshold`}>When under (credits)</FieldLabel>
            <Input
              id={`${id}-threshold`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              className="amount"
            />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Buy</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={pack}
              onValueChange={(value) => {
                const next = findPack(value)
                if (next) {
                  setPack(next.key)
                }
              }}
              aria-label="Pack to buy"
            >
              {creditPacks.map((option) => (
                <ToggleGroupItem key={option.key} value={option.key}>
                  {option.name.replace(' pack', '')}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        {chosen ? (
          <p className="m-0 text-sm text-ink-soft">
            Adds {chosen.credits.toLocaleString('en-US')} credits each time. If you're already under the
            threshold when you save, it tops up straight away.
          </p>
        ) : null}

        <Button
          className="self-start"
          disabled={busy !== null || !Number.isInteger(amount) || amount < 1}
          onClick={save}
        >
          {busy === 'save' ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {result === 'saved' ? (
          <Alert>
            <AlertDescription>Saved.</AlertDescription>
          </Alert>
        ) : result?.status === 'succeeded' ? (
          <Alert>
            <AlertDescription>
              Saved. You were under the threshold, so {result.credits.toLocaleString('en-US')} credits were added
              now.
            </AlertDescription>
          </Alert>
        ) : result?.status === 'failed' ? (
          <Alert variant="destructive">
            <AlertTitle>Saved, but the top-up was declined</AlertTitle>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
