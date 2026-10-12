import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import FlowNotes from '#/components/stripe/FlowNotes'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import PricingTable from '#/components/stripe/saas/PricingTable'
import SubscriptionPanel from '#/components/stripe/saas/SubscriptionPanel'
import TimeTravelPanel from '#/components/stripe/saas/TimeTravelPanel'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { getSaasAccount, getSaasStore } from '#/lib/lab/saas/saas.functions'

export const Route = createFileRoute('/stripe/saas/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'SaaS subscriptions | Stripe Lab' }] }),
  loader: () => getSaasStore(),
  component: SaasPage,
})

const ACCOUNT_KEY = ['saas-account']
/** After an action, keep polling this long so the webhooks it triggers show up. */
const SETTLE_MS = 20_000

const LIVE = ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete']

function SaasPage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()
  const [settleUntil, setSettleUntil] = useState(0)

  const initial = { subscription: store.subscription, invoices: store.invoices, timeTravel: store.timeTravel }
  const { data: account } = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () => getSaasAccount(),
    initialData: initial,
    enabled: store.signedIn,
    refetchInterval: (query) =>
      query.state.data?.timeTravel?.clockStatus === 'advancing' || Date.now() < settleUntil ? 2000 : false,
  })

  useEffect(() => {
    queryClient.setQueryData(ACCOUNT_KEY, {
      subscription: store.subscription,
      invoices: store.invoices,
      timeTravel: store.timeTravel,
    })
  }, [store.subscription, store.invoices, store.timeTravel, queryClient])

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== store.signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, store.signedIn, router])

  function settle() {
    setSettleUntil(Date.now() + SETTLE_MS)
    queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY })
  }

  const current = account.subscription && LIVE.includes(account.subscription.status) ? account.subscription : null

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="saas"
        summary="Charge every month or year until the customer cancels. Stripe Billing creates and charges each renewal invoice; your app only stores the subscription's status and decides what that status unlocks."
      />

      {canceled ? (
        <Alert className="mt-8 max-w-2xl">
          <AlertTitle>You left checkout</AlertTitle>
          <AlertDescription>Nothing was charged and no subscription was created.</AlertDescription>
        </Alert>
      ) : null}

      {/* Full width, so three plans sit side by side without squeezing their prices. */}
      <div className="mt-10">
        <PricingTable
          prices={store.prices}
          catalogError={store.catalogError}
          currentPlan={current?.planKey ?? null}
        />
      </div>

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {store.signedIn ? (
            <>
              <SubscriptionPanel subscription={account.subscription} invoices={account.invoices} />
              <TimeTravelPanel run={account.timeTravel} onChanged={settle} />
            </>
          ) : null}
        </div>

        <FlowNotes
          steps={[
            'You pick a plan and an interval. The server opens a Checkout Session in subscription mode, with a 14-day trial for Pro.',
            "On Stripe's page you save a card. With a trial nothing is charged yet; otherwise the first invoice is paid right away.",
            'checkout.session.completed and customer.subscription.created reach the webhook. The server re-fetches the subscription and stores its status and billing period.',
            'Access comes from that stored status: active or trialing unlocks the plan, past_due shows a warning, canceled locks it.',
            'Each period Stripe creates and charges a renewal invoice. invoice.paid or invoice.payment_failed arrives and the server syncs again.',
            "Plan changes, card updates and cancellations happen in Stripe's Customer Portal. Each one arrives as customer.subscription.updated.",
          ]}
          objects={[
            { name: 'Customer', id: 'cus_…' },
            { name: 'Checkout Session', id: 'cs_test_…' },
            { name: 'Subscription', id: 'sub_…' },
            { name: 'Invoice', id: 'in_…' },
            { name: 'Payment Intent', id: 'pi_…' },
            { name: 'Portal Session', id: 'bps_…' },
            { name: 'Test Clock', id: 'clock_…' },
          ]}
          events={[
            {
              type: 'customer.subscription.created',
              note: 'A new subscription. The server stores its status and period.',
            },
            {
              type: 'customer.subscription.updated',
              note: 'Anything changed: plan, seats, trial ending, a cancellation being scheduled.',
            },
            {
              type: 'customer.subscription.trial_will_end',
              note: 'Three days before a trial ends. A good moment to remind the customer.',
            },
            {
              type: 'invoice.paid',
              note: 'A renewal was charged. Access continues for another period.',
            },
            {
              type: 'invoice.payment_failed',
              note: 'A renewal failed. The subscription goes past_due while Stripe retries.',
            },
            {
              type: 'customer.subscription.deleted',
              note: 'The subscription ended, by cancellation or after retries ran out.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds' },
            { number: '4000 0000 0000 0341', note: 'Saves fine, every charge declines' },
            { number: '4000 0025 0000 3155', note: 'Asks for 3D Secure' },
            { number: '4000 0000 0000 0002', note: 'Declined' },
          ]}
          production={[
            'If you charge customers in the US or EU, turn on Stripe Tax with an active registration. Without one, automatic_tax collects nothing.',
            'Turn on Smart Retries and failed-payment emails in Billing settings, so Stripe chases failed renewals for you.',
            'Decide what past_due means for access. Most products keep access during retries.',
            'Use test clocks in automated tests to cover trial endings, renewals and failed payments.',
          ]}
        />
      </div>
    </main>
  )
}
