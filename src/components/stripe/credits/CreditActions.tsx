import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import type { ActionKey } from '#/lib/lab/credits/catalog'
import { creditActions } from '#/lib/lab/credits/catalog'
import { spendOnAction } from '#/lib/lab/credits/credits.functions'
import type { SpendResult } from '#/lib/lab/credits/credits.server'

interface CreditActionsProps {
  balance: number
  onSpent: () => void
}

/** Things that cost credits. The server checks and deducts in one step. */
export default function CreditActions({ balance, onSpent }: CreditActionsProps) {
  const [busy, setBusy] = useState<ActionKey | null>(null)
  const [outcome, setOutcome] = useState<SpendResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function spend(action: ActionKey) {
    setBusy(action)
    setError(null)
    setOutcome(null)
    try {
      setOutcome(await spendOnAction({ data: { action } }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That action failed.')
    } finally {
      setBusy(null)
      onSpent()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Use your credits</CardTitle>
        <CardDescription>
          Buttons stay enabled even when you're short, so you can see the server refuse.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {creditActions.map((action) => (
            <li key={action.key} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-ink">
                {action.name}{' '}
                <span className="amount text-ink-soft">
                  {action.cost} credit{action.cost === 1 ? '' : 's'}
                </span>
              </span>
              <Button
                variant={balance >= action.cost ? 'outline' : 'ghost'}
                size="sm"
                disabled={busy !== null}
                onClick={() => spend(action.key)}
              >
                {busy === action.key ? <Spinner data-icon="inline-start" /> : null}
                Run
              </Button>
            </li>
          ))}
        </ul>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Didn't run</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {outcome ? (
          <Alert>
            <AlertTitle>{outcome.result}</AlertTitle>
            <AlertDescription>
              {outcome.recharge?.status === 'succeeded'
                ? `That took you under your threshold, so your card was charged and ${outcome.recharge.credits.toLocaleString('en-US')} credits were added.`
                : `${outcome.balance.toLocaleString('en-US')} credits left.`}
            </AlertDescription>
          </Alert>
        ) : null}
        {outcome?.recharge?.status === 'failed' ? (
          <Alert variant="destructive">
            <AlertTitle>The automatic top-up was declined</AlertTitle>
            <AlertDescription>{outcome.recharge.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
