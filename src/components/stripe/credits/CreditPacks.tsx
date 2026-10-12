import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import type { PackKey } from '#/lib/lab/credits/catalog'
import { creditPacks } from '#/lib/lab/credits/catalog'
import { startPackCheckout } from '#/lib/lab/credits/credits.functions'
import { formatMoney, formatPrice } from '#/lib/lab/format'

interface CreditPacksProps {
  prices: Record<string, number | null>
  catalogError: string | null
  seeded: boolean
}

/** One-time packs. Paying also saves the card for automatic top-ups. */
export default function CreditPacks({ prices, catalogError, seeded }: CreditPacksProps) {
  const [opening, setOpening] = useState<PackKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function buy(pack: PackKey) {
    setOpening(pack)
    setError(null)
    try {
      const { url } = await startPackCheckout({ data: { pack } })
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(null)
    }
  }

  return (
    <section aria-labelledby="packs-heading" className="flex flex-col gap-4">
      <h2 id="packs-heading" className="m-0 text-xl font-semibold tracking-tight text-ink">
        Credit packs
      </h2>
      {catalogError ? (
        <Alert variant="destructive">
          <AlertTitle>Prices could not be loaded from Stripe</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      ) : null}
      {!catalogError && !seeded ? (
        <Alert>
          <AlertTitle>The packs aren't in your sandbox yet</AlertTitle>
          <AlertDescription>
            <p>
              Run <code>npm run stripe:seed credits</code>, then reload this page.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {creditPacks.map((pack) => {
          const price = prices[pack.lookupKey]
          return (
            <Card key={pack.key} className={pack.key === 'pro' ? 'border-brand' : undefined}>
              <CardHeader>
                <CardTitle>{pack.name}</CardTitle>
                <CardDescription>
                  <span className="amount">{pack.credits.toLocaleString('en-US')}</span> credits
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="amount m-0 text-3xl font-medium text-ink">
                  {price !== undefined ? formatPrice(price, 'usd') : '—'}
                </p>
                {price ? (
                  <p className="m-0 text-sm text-ink-soft">
                    {formatMoney((price / pack.credits) * 100, 'usd')} per 100 credits
                  </p>
                ) : null}
              </CardContent>
              <CardFooter className="mt-auto">
                <Show when="signed-in">
                  <Button
                    className="w-full"
                    variant={pack.key === 'pro' ? 'default' : 'outline'}
                    disabled={!price || opening !== null}
                    onClick={() => buy(pack.key)}
                  >
                    {opening === pack.key ? <Spinner data-icon="inline-start" /> : null}
                    Buy {pack.name.toLowerCase()}
                  </Button>
                </Show>
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <Button variant="outline" className="w-full">
                      Sign in to buy
                    </Button>
                  </SignInButton>
                </Show>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Checkout didn't open</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
