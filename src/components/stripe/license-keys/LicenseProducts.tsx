import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import type { LicenseProductOffer } from '#/lib/lab/license-keys/license-keys.functions'
import { startLicenseCheckout } from '#/lib/lab/license-keys/license-keys.functions'

interface LicenseProductsProps {
  products: LicenseProductOffer[]
  catalogError: string | null
}

export default function LicenseProducts({ products, catalogError }: LicenseProductsProps) {
  const [openingFor, setOpeningFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const notSeeded = !catalogError && products.some((product) => !product.price)

  async function buy(lookupKey: string) {
    setOpeningFor(lookupKey)
    setError(null)
    try {
      const { url } = await startLicenseCheckout({ data: { lookupKey } })
      // Stripe hosts the payment page. Nothing is issued until the webhook arrives.
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpeningFor(null)
    }
  }

  return (
    <section aria-labelledby="buy-heading" className="flex flex-col gap-4">
      <h2 id="buy-heading" className="m-0 text-xl font-semibold tracking-tight text-ink">
        Buy a license
      </h2>

      {catalogError ? (
        <Alert variant="destructive">
          <AlertTitle>Prices could not be loaded from Stripe</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      ) : null}
      {notSeeded ? (
        <Alert>
          <AlertTitle>These products aren't in your sandbox yet</AlertTitle>
          <AlertDescription>
            <p>
              Run <code>npm run stripe:seed license-keys</code>, then reload this page.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {products.map((product) => (
          <Card key={product.lookupKey}>
            <CardHeader>
              <CardTitle>{product.name}</CardTitle>
              <CardDescription>{product.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="m-0 flex items-baseline gap-2">
                <span className="amount text-3xl font-medium text-ink">
                  {product.price
                    ? formatMoney(product.price.unitAmount, product.price.currency)
                    : 'Not seeded'}
                </span>
                {product.price ? <span className="text-sm text-ink-soft">once</span> : null}
              </p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-ink">
                {product.perks.map((perk) => (
                  <li key={perk} className="flex gap-2">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                    {perk}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="mt-auto">
              <Show when="signed-in">
                <Button
                  className="w-full"
                  disabled={!product.price || openingFor !== null}
                  onClick={() => buy(product.lookupKey)}
                >
                  {openingFor === product.lookupKey ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      Opening checkout
                    </>
                  ) : (
                    `Buy ${product.name}`
                  )}
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
        ))}
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
