import { Show, SignInButton } from '@clerk/tanstack-react-start'
import { Check } from 'lucide-react'
import { useId, useState } from 'react'
import LevelBadge from '#/components/stripe/membership/LevelBadge'
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
import { Field, FieldDescription, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import { formatPrice } from '#/lib/lab/format'
import type { MembershipInterval, Tier, TierKey } from '#/lib/lab/membership/catalog'
import { customSupport, levelForMonthlyAmount, tierLookupKey, tiers } from '#/lib/lab/membership/catalog'
import { startCustomSupportCheckout, startMembershipCheckout } from '#/lib/lab/membership/membership.functions'

interface TierPickerProps {
  prices: Record<string, number | null>
  catalogError: string | null
  seeded: boolean
  /** True while the user has a live membership: joining again is blocked. */
  isMember: boolean
}

export default function TierPicker({ prices, catalogError, seeded, isMember }: TierPickerProps) {
  const id = useId()
  const [interval, setMembershipInterval] = useState<MembershipInterval>('month')
  const [dollars, setDollars] = useState('7')
  const [opening, setOpening] = useState<TierKey | 'custom' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const amount = Number(dollars)
  const validAmount =
    Number.isInteger(amount) &&
    amount >= customSupport.minimumDollars &&
    amount <= customSupport.maximumDollars

  async function open(target: TierKey | 'custom', start: () => Promise<{ url: string }>) {
    setOpening(target)
    setError(null)
    try {
      const { url } = await start()
      window.location.assign(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setOpening(null)
    }
  }

  function joinTier(tier: Tier) {
    return open(tier.key, () => startMembershipCheckout({ data: { tier: tier.key, interval } }))
  }

  return (
    <section aria-labelledby="tiers-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tiers-heading" className="m-0 text-xl font-semibold tracking-tight text-ink">
          Become a member
        </h2>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={interval}
          onValueChange={(value) => {
            if (value === 'month' || value === 'year') {
              setMembershipInterval(value)
            }
          }}
          aria-label="Billing interval for tiers"
        >
          <ToggleGroupItem value="month">Monthly</ToggleGroupItem>
          <ToggleGroupItem value="year">Yearly, 2 months free</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {catalogError ? (
        <Alert variant="destructive">
          <AlertTitle>Prices could not be loaded from Stripe</AlertTitle>
          <AlertDescription>{catalogError}</AlertDescription>
        </Alert>
      ) : null}
      {!catalogError && !seeded ? (
        <Alert>
          <AlertTitle>The membership catalog isn't in your sandbox yet</AlertTitle>
          <AlertDescription>
            <p>
              Run <code>npm run stripe:seed membership</code>, then reload this page.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {tiers.map((tier) => {
          const unit = prices[tierLookupKey(tier.key, interval)]
          return (
            <Card key={tier.key} className={tier.key === 'insider' ? 'border-brand' : undefined}>
              <CardHeader>
                <CardTitle>{tier.name}</CardTitle>
                <CardDescription>{tier.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="m-0 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="amount whitespace-nowrap text-3xl font-medium text-ink">
                    {unit !== undefined ? formatPrice(unit, 'usd') : '—'}
                  </span>
                  <span className="text-sm text-ink-soft">per {interval}</span>
                </p>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-ink">
                  {tier.perks.map((perk) => (
                    <li key={perk} className="flex gap-2">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                      {perk}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="mt-auto">
                <JoinButton
                  isMember={isMember}
                  label={`Join as ${tier.name}`}
                  busy={opening === tier.key}
                  disabled={unit === undefined || opening !== null}
                  primary={tier.key === 'insider'}
                  onClick={() => joinTier(tier)}
                />
              </CardFooter>
            </Card>
          )
        })}

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Name your price</CardTitle>
            <CardDescription>Monthly, from ${customSupport.minimumDollars}. Your amount sets your level.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor={`${id}-amount`}>Dollars per month</FieldLabel>
              <Input
                id={`${id}-amount`}
                type="number"
                inputMode="numeric"
                min={customSupport.minimumDollars}
                max={customSupport.maximumDollars}
                step={1}
                value={dollars}
                onChange={(event) => setDollars(event.target.value)}
                className="amount"
              />
              <FieldDescription className="flex flex-wrap items-center gap-1.5">
                {validAmount ? (
                  <>
                    Reaches <LevelBadge level={levelForMonthlyAmount(amount * 100)} />
                  </>
                ) : (
                  `Whole dollars, ${customSupport.minimumDollars} to ${customSupport.maximumDollars}.`
                )}
              </FieldDescription>
            </Field>
          </CardContent>
          <CardFooter className="mt-auto">
            <JoinButton
              isMember={isMember}
              label={validAmount ? `Support for $${amount} a month` : 'Support monthly'}
              busy={opening === 'custom'}
              disabled={!validAmount || !seeded || opening !== null}
              onClick={() => open('custom', () => startCustomSupportCheckout({ data: { dollars: amount } }))}
            />
          </CardFooter>
        </Card>
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

function JoinButton({
  isMember,
  label,
  busy,
  disabled,
  primary = false,
  onClick,
}: {
  isMember: boolean
  label: string
  busy: boolean
  disabled: boolean
  primary?: boolean
  onClick: () => void
}) {
  return (
    <>
      <Show when="signed-in">
        {isMember ? (
          <Button variant="outline" className="w-full" disabled>
            You're already a member
          </Button>
        ) : (
          <Button className="w-full" variant={primary ? 'default' : 'outline'} disabled={disabled} onClick={onClick}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {label}
          </Button>
        )}
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button variant="outline" className="w-full">
            Sign in to join
          </Button>
        </SignInButton>
      </Show>
    </>
  )
}
