import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import InvoiceList from '#/components/stripe/InvoiceList'
import LevelBadge from '#/components/stripe/membership/LevelBadge'
import NextBillingDate from '#/components/stripe/NextBillingDate'
import SubscriptionStatusBadge from '#/components/stripe/SubscriptionStatusBadge'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import { customSupport, levelForMonthlyAmount } from '#/lib/lab/membership/catalog'
import {
  changeMembershipAmount,
  openMembershipPortal,
  setMembershipCancel,
} from '#/lib/lab/membership/membership.functions'
import type { MembershipView } from '#/lib/lab/membership/membership.server'
import type { InvoiceView } from '#/lib/stripe/billing.server'

interface MembershipPanelProps {
  membership: MembershipView
  invoices: InvoiceView[]
  feed: { unlocked: number; total: number }
  onChanged: () => void
}

/** The member's own subscription: level, renewal, and what they can change. */
export default function MembershipPanel({ membership, invoices, feed, onChanged }: MembershipPanelProps) {
  const [busy, setBusy] = useState<'portal' | 'cancel' | 'amount' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const live = membership.access !== 'none'

  async function run(kind: 'portal' | 'cancel' | 'amount', action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    setDone(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That change failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your membership</CardTitle>
        <CardDescription>Read from the database, which Stripe's webhooks keep current.</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run('portal', async () => {
                const { url } = await openMembershipPortal()
                window.location.assign(url)
              })
            }
          >
            {busy === 'portal' ? <Spinner data-icon="inline-start" /> : null}
            Manage billing
          </Button>
        </CardAction>
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

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
            <span className="text-lg font-semibold">{membership.name}</span>
            {membership.level ? <LevelBadge level={membership.level} /> : null}
            <span className="amount text-sm text-ink-soft">
              {formatMoney(membership.amount, membership.currency)} per {membership.interval ?? 'month'}
            </span>
          </p>
          <SubscriptionStatusBadge status={membership.status} />
        </div>
        <p className="m-0 text-sm text-ink-soft">
          <NextBillingDate subscription={membership} />
          {membership.cancelAtPeriodEnd ? '. Your level stays until then.' : null}
        </p>

        {membership.access === 'grace' ? (
          <Alert variant="destructive">
            <AlertTitle>Your last payment failed</AlertTitle>
            <AlertDescription>
              Stripe is retrying it, and you keep your level meanwhile. Update your card in Manage billing.
            </AlertDescription>
          </Alert>
        ) : null}

        {live ? (
          <p className="m-0 text-sm text-ink">
            Your level opens {feed.unlocked} of {feed.total} posts.{' '}
            <Link to="/stripe/membership/feed" className="font-medium">
              Read the feed
            </Link>
          </p>
        ) : null}

        {live && membership.kind === 'custom' ? (
          <CustomAmountForm
            current={membership.amount ?? 0}
            busy={busy === 'amount'}
            disabled={busy !== null}
            onSubmit={(dollars) =>
              run('amount', async () => {
                const result = await changeMembershipAmount({ data: { dollars } })
                setDone(
                  result.charged > 0
                    ? `Now $${dollars} a month. Charged ${formatMoney(result.charged, result.currency)} for the rest of this month.`
                    : result.total < 0
                      ? `Now $${dollars} a month. ${formatMoney(-result.total, result.currency)} credit goes toward your next renewal.`
                      : `Now $${dollars} a month.`,
                )
                onChanged()
              })
            }
          />
        ) : null}
        {live && membership.kind === 'tier' ? (
          <p className="m-0 text-sm text-ink-soft">
            Switch tiers or billing interval in Manage billing. Moving up is charged straight away; moving
            down waits for your renewal.
          </p>
        ) : null}

        {live ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy !== null}
            onClick={() =>
              run('cancel', async () => {
                await setMembershipCancel({ data: { cancel: !membership.cancelAtPeriodEnd } })
                onChanged()
              })
            }
          >
            {busy === 'cancel' ? <Spinner data-icon="inline-start" /> : null}
            {membership.cancelAtPeriodEnd ? 'Stay a member' : 'Cancel at the end of this period'}
          </Button>
        ) : null}

        <Separator />
        <div>
          <h3 className="m-0 mb-2 text-[0.8125rem] font-semibold text-ink-soft">Invoices</h3>
          <InvoiceList invoices={invoices} />
        </div>
      </CardContent>
    </Card>
  )
}

function CustomAmountForm({
  current,
  busy,
  disabled,
  onSubmit,
}: {
  current: number
  busy: boolean
  disabled: boolean
  onSubmit: (dollars: number) => void
}) {
  const id = useId()
  const [dollars, setDollars] = useState(String(Math.round(current / 100)))
  const amount = Number(dollars)
  const valid =
    Number.isInteger(amount) &&
    amount >= customSupport.minimumDollars &&
    amount <= customSupport.maximumDollars &&
    amount * 100 !== current

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) {
          onSubmit(amount)
        }
      }}
    >
      <FieldGroup className="flex-row items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor={`${id}-amount`}>New monthly amount, in dollars</FieldLabel>
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
        </Field>
        <Button type="submit" disabled={!valid || disabled}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          Change amount
        </Button>
      </FieldGroup>
      <p className="m-0 mt-2 flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
        {Number.isInteger(amount) && amount >= customSupport.minimumDollars ? (
          <>
            Reaches <LevelBadge level={levelForMonthlyAmount(amount * 100)} />. Raising it charges the
            difference now; lowering it leaves a credit.
          </>
        ) : (
          `At least $${customSupport.minimumDollars}.`
        )}
      </p>
    </form>
  )
}
