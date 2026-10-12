import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { Minus, Plus, X } from 'lucide-react'
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
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import { formatMoney } from '#/lib/lab/format'
import type { ShopShippingRate } from '#/lib/lab/shop/catalog'
import type { ShopProductOffer } from '#/lib/lab/shop/shop.functions'
import { startShopCheckout } from '#/lib/lab/shop/shop.functions'
import type { InventoryRow } from '#/lib/lab/shop/shop.server'

interface ShopFrontProps {
  products: ShopProductOffer[]
  inventory: InventoryRow[]
  catalogError: string | null
  shippingRates: ShopShippingRate[]
  holdMinutes: number
  maxPerLine: number
}

/** One card per item; sizes of the tee share a card. */
function groupProducts(products: ShopProductOffer[]) {
  const groups = new Map<string, ShopProductOffer[]>()
  for (const product of products) {
    groups.set(product.name, [...(groups.get(product.name) ?? []), product])
  }
  return [...groups.values()]
}

function label(product: ShopProductOffer) {
  return product.variant ? `${product.name} (${product.variant})` : product.name
}

export default function ShopFront({
  products,
  inventory,
  catalogError,
  shippingRates,
  holdMinutes,
  maxPerLine,
}: ShopFrontProps) {
  const [cart, setCart] = useState<Record<string, number>>({})
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = (sku: string) => inventory.find((row) => row.sku === sku)?.available ?? 0
  const limit = (sku: string) => Math.min(available(sku), maxPerLine)
  const notSeeded = !catalogError && products.some((product) => !product.price)

  function setQuantity(sku: string, quantity: number) {
    setCart((current) => {
      const next = { ...current }
      if (quantity <= 0) {
        delete next[sku]
      } else {
        next[sku] = Math.min(quantity, limit(sku))
      }
      return next
    })
  }

  const lines = Object.entries(cart).flatMap(([sku, quantity]) => {
    const product = products.find((candidate) => candidate.sku === sku)
    return product ? [{ product, quantity }] : []
  })
  const subtotal = lines.reduce(
    (sum, line) => sum + (line.product.price?.unitAmount ?? 0) * line.quantity,
    0,
  )
  const currency = lines[0]?.product.price?.currency ?? 'usd'

  async function checkout() {
    setOpening(true)
    setError(null)
    try {
      const { url } = await startShopCheckout({
        data: { items: lines.map((line) => ({ sku: line.product.sku, quantity: line.quantity })) },
      })
      // Stock is now held for this order. Stripe hosts the payment page.
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(false)
    }
  }

  return (
    <section aria-labelledby="shop-heading" className="flex flex-col gap-4">
      <h2 id="shop-heading" className="m-0 text-xl font-semibold tracking-tight text-ink">
        Shop
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
              Run <code>npm run stripe:seed shop</code>, then reload this page.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        {groupProducts(products).map((group) => (
          <ProductCard
            key={group[0].name}
            variants={group}
            available={available}
            inCart={(sku) => cart[sku] ?? 0}
            limit={limit}
            onAdd={(sku) => setQuantity(sku, (cart[sku] ?? 0) + 1)}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your cart</CardTitle>
          <CardDescription>
            Checking out holds these items for {holdMinutes} minutes. If you don't pay by then,
            Stripe expires the checkout and they go back on sale.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {lines.length === 0 ? (
            <p className="m-0 text-sm text-ink-soft">Your cart is empty.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {lines.map(({ product, quantity }) => (
                <li key={product.sku} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span className="text-sm font-medium text-ink">{label(product)}</span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`One fewer ${label(product)}`}
                        onClick={() => setQuantity(product.sku, quantity - 1)}
                      >
                        <Minus />
                      </Button>
                      <span className="amount w-6 text-center text-sm">{quantity}</span>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`One more ${label(product)}`}
                        disabled={quantity >= limit(product.sku)}
                        onClick={() => setQuantity(product.sku, quantity + 1)}
                      >
                        <Plus />
                      </Button>
                    </div>
                    <span className="amount w-20 text-right text-sm text-ink">
                      {formatMoney((product.price?.unitAmount ?? 0) * quantity, currency)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${label(product)}`}
                      onClick={() => setQuantity(product.sku, 0)}
                    >
                      <X />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 text-sm text-ink-soft">
            Shipping is chosen on Stripe's page:{' '}
            {shippingRates
              .map(
                (rate) =>
                  `${rate.displayName} ${formatMoney(rate.amount, 'usd')} (${rate.minDays} to ${rate.maxDays} business days)`,
              )
              .join(' or ')}
            .
          </p>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Checkout didn't open</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-ink-soft">
            Subtotal{' '}
            <span className="amount font-medium text-ink">{formatMoney(subtotal, currency)}</span>
          </p>
          <Show when="signed-in">
            <Button disabled={lines.length === 0 || opening} onClick={checkout}>
              {opening ? <Spinner data-icon="inline-start" /> : null}
              {opening ? 'Holding stock' : 'Check out'}
            </Button>
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button variant="outline">Sign in to buy</Button>
            </SignInButton>
          </Show>
        </CardFooter>
      </Card>
    </section>
  )
}

function ProductCard({
  variants,
  available,
  inCart,
  limit,
  onAdd,
}: {
  variants: ShopProductOffer[]
  available: (sku: string) => number
  inCart: (sku: string) => number
  limit: (sku: string) => number
  onAdd: (sku: string) => void
}) {
  const [chosen, setChosen] = useState(variants[0].sku)
  const product = variants.find((variant) => variant.sku === chosen) ?? variants[0]
  const left = available(product.sku)
  const canAdd = Boolean(product.price) && inCart(product.sku) < limit(product.sku)

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{product.name}</CardTitle>
        <CardDescription>{product.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <span className="amount text-2xl font-medium text-ink">
          {product.price ? formatMoney(product.price.unitAmount, product.price.currency) : 'Not seeded'}
        </span>
        {variants.length > 1 ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={chosen}
            onValueChange={(value) => value && setChosen(value)}
            aria-label={`${product.name} size`}
          >
            {variants.map((variant) => (
              <ToggleGroupItem key={variant.sku} value={variant.sku} aria-label={`Size ${variant.variant}`}>
                {variant.variant}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
        <p className={left === 0 ? 'm-0 text-sm text-danger' : 'm-0 text-sm text-ink-soft'}>
          {left === 0 ? 'Sold out' : left <= 3 ? `Only ${left} left` : `${left} in stock`}
        </p>
      </CardContent>
      <CardFooter className="mt-auto">
        <Button variant="outline" className="w-full" disabled={!canAdd} onClick={() => onAdd(product.sku)}>
          {inCart(product.sku) > 0 ? `Add another (${inCart(product.sku)} in cart)` : 'Add to cart'}
        </Button>
      </CardFooter>
    </Card>
  )
}
