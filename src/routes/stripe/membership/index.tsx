import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import FlowNotes from '#/components/stripe/FlowNotes'
import MemberProfile from '#/components/stripe/membership/MemberProfile'
import MembershipPanel from '#/components/stripe/membership/MembershipPanel'
import SupporterWall from '#/components/stripe/membership/SupporterWall'
import TierPicker from '#/components/stripe/membership/TierPicker'
import TipJar from '#/components/stripe/membership/TipJar'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '#/components/ui/card'
import { getMembershipAccount, getMembershipStore } from '#/lib/lab/membership/membership.functions'

export const Route = createFileRoute('/stripe/membership/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'Memberships and patronage | Stripe Lab' }] }),
  loader: () => getMembershipStore(),
  component: MembershipPage,
})

const ACCOUNT_KEY = ['membership-account']
const SETTLE_MS = 15_000

function MembershipPage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()
  const [settleUntil, setSettleUntil] = useState(0)

  const initial = {
    membership: store.membership,
    invoices: store.invoices,
    summary: store.summary,
    wall: store.wall,
    feed: store.feed,
  }
  const { data: account } = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () => getMembershipAccount(),
    initialData: initial,
    enabled: store.signedIn,
    refetchInterval: () => (Date.now() < settleUntil ? 2000 : false),
  })

  useEffect(() => {
    queryClient.setQueryData(ACCOUNT_KEY, {
      membership: store.membership,
      invoices: store.invoices,
      summary: store.summary,
      wall: store.wall,
      feed: store.feed,
    })
  }, [store.membership, store.invoices, store.summary, store.wall, store.feed, queryClient])

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== store.signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, store.signedIn, router])

  function refresh() {
    setSettleUntil(Date.now() + SETTLE_MS)
    queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY })
  }

  const isMember = account.membership !== null && account.membership.access !== 'none'

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="membership"
        summary="Supporters join a tier or name their own monthly amount, and anyone can tip once. Their level unlocks posts and a community role, and every payment adds to their total on the wall."
      />

      {canceled ? (
        <Alert className="mt-8 max-w-2xl">
          <AlertTitle>You left checkout</AlertTitle>
          <AlertDescription>Nothing was charged.</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-10">
        <TierPicker
          prices={store.prices}
          catalogError={store.catalogError}
          seeded={store.seeded}
          isMember={isMember}
        />
      </div>

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <TipJar seeded={store.seeded} />
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lock aria-hidden="true" className="size-4 text-brand" />
                  Members-only feed
                </CardTitle>
                <CardDescription>
                  {account.feed.unlocked} of {account.feed.total} posts are open to you. Locked posts' text
                  never leaves the server.
                </CardDescription>
              </CardHeader>
              <CardFooter className="mt-auto">
                <Button variant="outline" asChild>
                  <Link to="/stripe/membership/feed">Read the feed</Link>
                </Button>
              </CardFooter>
            </Card>
          </div>

          {store.signedIn && account.membership ? (
            <MembershipPanel
              membership={account.membership}
              invoices={account.invoices}
              feed={account.feed}
              onChanged={refresh}
            />
          ) : null}
          {store.signedIn && account.summary ? (
            <MemberProfile summary={account.summary} onChanged={refresh} />
          ) : null}
          <SupporterWall entries={account.wall} />
        </div>

        <FlowNotes
          steps={[
            'A tier is an ordinary subscription Checkout with a Price the seed created. Yearly is a second Price on the same Product.',
            'Pay what you want sends price_data instead of a Price ID. Checkout creates a new Price on the Custom support product for that amount.',
            'A tip is a one-time payment. Its Price has custom_unit_amount, so the buyer types the amount on Stripe’s page, and a custom field collects a note.',
            'On every subscription event the webhook works out the member’s level and gives them the matching community role. Here the role change is only recorded.',
            'Each invoice.paid for a membership adds a row to the contributions ledger, keyed by invoice ID. Totals and “member since” come from there.',
            'The feed asks the server for posts. Posts above your level come back without their text.',
            'Cancelling keeps the subscription active until the period ends, so your level and role last until then.',
          ]}
          objects={[
            { name: 'Product per tier', id: 'lab_membership_…' },
            { name: 'Price (tier, monthly or yearly)', id: 'price_…' },
            { name: 'Price from price_data', id: 'price_…' },
            { name: 'Price with custom_unit_amount', id: 'price_…' },
            { name: 'Subscription', id: 'sub_…' },
            { name: 'Payment Intent (tips)', id: 'pi_…' },
          ]}
          events={[
            {
              type: 'checkout.session.completed',
              note: 'Subscription mode stores the membership; payment mode records the tip and its note.',
            },
            {
              type: 'customer.subscription.updated',
              note: 'Tier, amount, status or cancellation changed. The role is re-checked.',
            },
            {
              type: 'invoice.paid',
              note: 'A membership payment. It counts toward the wall total once, keyed by invoice.',
            },
            {
              type: 'customer.subscription.deleted',
              note: 'The membership ended. The role is removed.',
            },
            {
              type: 'charge.refunded',
              note: 'A refunded tip stops counting toward the total.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds' },
            { number: '4000 0025 0000 3155', note: 'Asks for 3D Secure' },
            { number: '4000 0000 0000 0259', note: 'Pays, then is disputed (try it on a tip)' },
          ]}
          production={[
            'Don’t call Discord inside the webhook’s database transaction. Treat the role changes as an outbox: a worker makes each API call and retries on failure.',
            'Every pay-what-you-want amount creates a new Price. That’s expected; filter them out of Dashboard reports by product.',
            'With Adaptive Pricing on, buyers abroad type the tip in their own currency, and the minimum converts too. You still receive dollars.',
            'A declined change with pending_if_incomplete would still apply if its invoice got paid within 23 hours. This lab voids that invoice so “not changed” stays true.',
            'Refunds of membership invoices aren’t subtracted here, only tip refunds. A real ledger would follow refunds on invoice payments too.',
            'Tips are often taxed differently from memberships, and donations may need receipts. Check before calling something a donation.',
            'Stripe Tax collects nothing without a registration, so automatic tax stays off in this sandbox.',
          ]}
        />
      </div>
    </main>
  )
}
