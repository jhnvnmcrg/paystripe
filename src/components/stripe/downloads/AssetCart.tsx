import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '#/components/ui/field'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import type { DigitalAssetOffer } from '#/lib/lab/downloads/downloads.functions'
import { startDownloadCheckout } from '#/lib/lab/downloads/downloads.functions'

interface AssetCartProps {
  assets: DigitalAssetOffer[]
  catalogError: string | null
  promotion: { code: string; percentOff: number; active: boolean }
}

export default function AssetCart({ assets, catalogError, promotion }: AssetCartProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const notSeeded = !catalogError && assets.some((asset) => !asset.price)
  const chosen = assets.filter((asset) => selected.includes(asset.id))
  const subtotal = chosen.reduce((sum, asset) => sum + (asset.price?.unitAmount ?? 0), 0)
  const currency = chosen[0]?.price?.currency ?? 'usd'

  function toggle(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, id] : current.filter((candidate) => candidate !== id),
    )
  }

  async function checkout() {
    setOpening(true)
    setError(null)
    try {
      const { url } = await startDownloadCheckout({ data: { assetIds: selected } })
      // Stripe hosts the payment page. Nothing is granted until the webhook arrives.
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Choose your files</CardTitle>
        <CardDescription>
          Everything you pick goes into one Checkout Session, one line item each.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
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
                Run <code>npm run stripe:seed downloads</code>, then reload this page.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldSet>
          <FieldLegend className="sr-only">Files to buy</FieldLegend>
          <FieldGroup className="gap-3">
            {assets.map((asset) => (
              <Field
                key={asset.id}
                orientation="horizontal"
                className="rounded-lg border border-line px-4 py-3"
                data-disabled={!asset.price || undefined}
              >
                <Checkbox
                  id={`asset-${asset.id}`}
                  checked={selected.includes(asset.id)}
                  disabled={!asset.price}
                  onCheckedChange={(checked) => toggle(asset.id, checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`asset-${asset.id}`}>
                    {asset.name}
                    <Badge variant="secondary">{asset.format}</Badge>
                  </FieldLabel>
                  <FieldDescription>{asset.description}</FieldDescription>
                </FieldContent>
                <span className="amount text-sm font-medium text-ink">
                  {asset.price ? formatMoney(asset.price.unitAmount, asset.price.currency) : '—'}
                </span>
              </Field>
            ))}
          </FieldGroup>
        </FieldSet>

        {promotion.active ? (
          <p className="m-0 text-sm text-ink-soft">
            Have a code? Enter <code>{promotion.code}</code> on Stripe's page for{' '}
            {promotion.percentOff}% off.
          </p>
        ) : (
          <p className="m-0 text-sm text-ink-soft">
            The {promotion.code} code isn't in your sandbox yet. Run{' '}
            <code>npm run stripe:seed downloads</code> to create it.
          </p>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Checkout didn't open</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-ink-soft">
          {chosen.length === 0 ? (
            'Nothing chosen yet'
          ) : (
            <>
              {chosen.length} {chosen.length === 1 ? 'file' : 'files'},{' '}
              <span className="amount font-medium text-ink">
                {formatMoney(subtotal, currency)}
              </span>{' '}
              before any discount
            </>
          )}
        </p>
        <Show when="signed-in">
          <Button disabled={chosen.length === 0 || opening} onClick={checkout}>
            {opening ? <Spinner data-icon="inline-start" /> : null}
            {opening ? 'Opening checkout' : 'Check out'}
          </Button>
        </Show>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button variant="outline">Sign in to buy</Button>
          </SignInButton>
        </Show>
      </CardFooter>
    </Card>
  )
}
