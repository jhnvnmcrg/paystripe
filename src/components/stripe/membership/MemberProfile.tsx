import { useId, useState } from 'react'
import LocalTime from '#/components/stripe/LocalTime'
import OrderStatusBadge from '#/components/stripe/OrderStatusBadge'
import SellerActions from '#/components/stripe/SellerActions'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Separator } from '#/components/ui/separator'
import { Spinner } from '#/components/ui/spinner'
import { formatMoney } from '#/lib/lab/format'
import { refundTip, resolveTipDispute, saveWallName } from '#/lib/lab/membership/membership.functions'
import type { MemberSummary, RoleChangeView } from '#/lib/lab/membership/membership.server'

const PARTIAL_REFUND = 100

interface MemberProfileProps {
  summary: MemberSummary
  /** Called after any change, so the page polls until the webhooks land. */
  onChanged: () => void
}

/** The member's side of things: community role, wall name and money given. */
export default function MemberProfile({ summary, onChanged }: MemberProfileProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key)
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
        <CardTitle className="text-base">Your supporter profile</CardTitle>
        <CardDescription>
          {summary.totalContributed > 0 ? (
            <>
              <span className="amount text-ink">{formatMoney(summary.totalContributed, 'usd')}</span> given
              {summary.memberSince ? (
                <>
                  , member since <LocalTime iso={summary.memberSince} />
                </>
              ) : null}
              .
            </>
          ) : (
            'Nothing given yet.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="role-heading" className="flex flex-col gap-2">
          <h3 id="role-heading" className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            Community role
            {summary.communityRole ? <Badge>{summary.communityRole}</Badge> : <Badge variant="secondary">None</Badge>}
            <span className="text-xs font-normal text-ink-soft">simulated Discord</span>
          </h3>
          <p className="m-0 text-sm text-ink-soft">
            The webhook works out your role from your subscription. Each change below is where a real
            integration would call Discord's API.
          </p>
          {summary.roleChanges.length > 0 ? (
            <ol className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
              {summary.roleChanges.map((change) => (
                <li key={change.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                  <span className="text-ink">{describeRoleChange(change)}</span>
                  <span className="text-ink-soft">
                    {change.subscriptionStatus ? `${change.subscriptionStatus.replace('_', ' ')}, ` : ''}
                    <LocalTime iso={change.createdAt} />
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <Separator />
        <WallNameForm
          current={summary.wallName}
          busy={busy === 'name'}
          onSave={(name) => run('name', () => saveWallName({ data: { name } }))}
        />

        <Separator />
        <section aria-labelledby="given-heading" className="flex flex-col gap-2">
          <h3 id="given-heading" className="m-0 text-sm font-semibold text-ink">
            What you've given
          </h3>
          {summary.contributions.length === 0 ? (
            <p className="m-0 text-sm text-ink-soft">
              Paid membership invoices and tips show up here once their webhooks arrive.
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {summary.contributions.map((contribution) => (
                <li key={contribution.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2 text-ink">
                      {contribution.description}
                      {contribution.order ? <OrderStatusBadge status={contribution.order.status} /> : null}
                    </span>
                    <span className="amount text-ink">
                      {contribution.amountRefunded > 0 ? (
                        <>
                          <s className="text-ink-soft">{formatMoney(contribution.amount, contribution.currency)}</s>{' '}
                          {formatMoney(contribution.amount - contribution.amountRefunded, contribution.currency)}
                        </>
                      ) : (
                        formatMoney(contribution.amount, contribution.currency)
                      )}
                    </span>
                  </div>
                  <p className="m-0 text-xs text-ink-soft">
                    <LocalTime iso={contribution.paidAt} />
                    {contribution.message ? ` · “${contribution.message}”` : ''}
                  </p>
                  {contribution.order ? (
                    <SellerActions
                      order={contribution.order}
                      partialRefund={PARTIAL_REFUND}
                      disabled={busy !== null}
                      onRefund={(amount) => {
                        const orderId = contribution.order?.id
                        if (orderId) {
                          run(orderId, () => refundTip({ data: { orderId, amount } }))
                        }
                      }}
                      onResolveDispute={(outcome) => {
                        const orderId = contribution.order?.id
                        if (orderId) {
                          run(orderId, () => resolveTipDispute({ data: { orderId, outcome } }))
                        }
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

function describeRoleChange(change: RoleChangeView): string {
  if (change.fromRole && change.toRole) {
    return `${change.fromRole} → ${change.toRole}`
  }
  if (change.toRole) {
    return `Granted ${change.toRole}`
  }
  return `Removed ${change.fromRole ?? 'role'}`
}

function WallNameForm({
  current,
  busy,
  onSave,
}: {
  current: string | null
  busy: boolean
  onSave: (name: string) => void
}) {
  const id = useId()
  const [name, setName] = useState(current ?? '')
  const unchanged = name.trim() === (current ?? '')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave(name)
      }}
    >
      <FieldGroup className="flex-row items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor={`${id}-wall-name`}>Name on the supporter wall</FieldLabel>
          <Input
            id={`${id}-wall-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Leave empty to stay anonymous"
            maxLength={40}
          />
        </Field>
        <Button type="submit" variant="outline" disabled={busy || unchanged}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </FieldGroup>
    </form>
  )
}
