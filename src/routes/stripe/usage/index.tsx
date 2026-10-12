import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import FlowNotes from '#/components/stripe/FlowNotes'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import ApiConsole from '#/components/stripe/usage/ApiConsole'
import MeterReadout from '#/components/stripe/usage/MeterReadout'
import RateCard from '#/components/stripe/usage/RateCard'
import UsageAlerts from '#/components/stripe/usage/UsageAlerts'
import UsageSubscriptionPanel from '#/components/stripe/usage/UsageSubscriptionPanel'
import UsageTimeTravel from '#/components/stripe/usage/UsageTimeTravel'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import {
  getUsageAccount,
  getUsageMeters,
  getUsageStore,
  getUsageTimeTravelState,
  retryUsage,
  sendUsage,
} from '#/lib/lab/usage/usage.functions'

export const Route = createFileRoute('/stripe/usage/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'Usage-based billing | Stripe Lab' }] }),
  loader: () => getUsageStore(),
  component: UsagePage,
})

const ACCOUNT_KEY = ['usage-account']
const METERS_KEY = ['usage-meters']
const TIME_TRAVEL_KEY = ['usage-time-travel']
/** Local records settle fast; Stripe's meter summaries take about a minute. */
const ACCOUNT_SETTLE_MS = 15_000
const METERS_SETTLE_MS = 120_000

function UsagePage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()
  const [accountUntil, setAccountUntil] = useState(0)
  const [metersUntil, setMetersUntil] = useState(0)
  const [travelUntil, setTravelUntil] = useState(0)

  const initial = {
    subscription: store.subscription,
    recent: store.recent,
    alerts: store.alerts,
    invoices: store.invoices,
  }
  const { data: account } = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () => getUsageAccount(),
    initialData: initial,
    enabled: store.signedIn,
    refetchInterval: () => (Date.now() < accountUntil ? 2000 : false),
  })
  const live = account.subscription !== null && account.subscription.access !== 'none'

  const meters = useQuery({
    queryKey: METERS_KEY,
    queryFn: () => getUsageMeters(),
    enabled: store.signedIn && live,
    refetchInterval: () => (Date.now() < metersUntil ? 5000 : false),
  })

  const timeTravel = useQuery({
    queryKey: TIME_TRAVEL_KEY,
    queryFn: () => getUsageTimeTravelState(),
    initialData: store.timeTravel,
    enabled: store.signedIn,
    refetchInterval: (query) =>
      Date.now() < travelUntil || (query.state.data && query.state.data.clockStatus !== 'ready') ? 5000 : false,
  })

  useEffect(() => {
    queryClient.setQueryData(ACCOUNT_KEY, {
      subscription: store.subscription,
      recent: store.recent,
      alerts: store.alerts,
      invoices: store.invoices,
    })
    queryClient.setQueryData(TIME_TRAVEL_KEY, store.timeTravel)
  }, [store.subscription, store.recent, store.alerts, store.invoices, store.timeTravel, queryClient])

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== store.signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, store.signedIn, router])

  function refreshAccount() {
    setAccountUntil(Date.now() + ACCOUNT_SETTLE_MS)
    queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY })
  }

  function afterUsage() {
    refreshAccount()
    setMetersUntil(Date.now() + METERS_SETTLE_MS)
    queryClient.invalidateQueries({ queryKey: METERS_KEY })
  }

  function refreshTimeTravel() {
    setTravelUntil(Date.now() + METERS_SETTLE_MS)
    queryClient.invalidateQueries({ queryKey: TIME_TRAVEL_KEY })
  }

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="usage"
        summary="Customers sign up with nothing to pay. Every API call is reported to a Stripe meter, and at the end of the month Stripe invoices whatever the meters counted."
      />

      {canceled ? (
        <Alert className="mt-8 max-w-2xl">
          <AlertTitle>You left checkout</AlertTitle>
          <AlertDescription>No subscription was created.</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <RateCard seeded={store.seeded} catalogError={store.catalogError} subscribed={live} />

          {store.signedIn && live ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">API console</CardTitle>
                  <CardDescription>
                    Each button is a batch of API calls. The server records it, then sends one meter event to
                    Stripe with the record's ID as the identifier.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-6">
                  <ApiConsole
                    recent={account.recent}
                    send={(meter, value) => sendUsage({ data: { meter, value } })}
                    retry={(id) => retryUsage({ data: { id } })}
                    onSent={afterUsage}
                  />
                  <MeterReadout
                    reading={meters.data}
                    fetching={meters.isFetching}
                    onRefresh={() => meters.refetch()}
                  />
                </CardContent>
              </Card>
              <UsageAlerts alerts={account.alerts} onChanged={refreshAccount} />
            </>
          ) : null}

          {store.signedIn && account.subscription ? (
            <UsageSubscriptionPanel
              subscription={account.subscription}
              invoices={account.invoices}
              onChanged={refreshAccount}
            />
          ) : null}

          {store.signedIn && store.seeded ? (
            <UsageTimeTravel run={timeTravel.data} fetching={timeTravel.isFetching} onChanged={refreshTimeTravel} />
          ) : null}
        </div>

        <FlowNotes
          steps={[
            'Each billable thing has a Billing Meter, which adds up usage events for a customer, and a metered monthly Price attached to it.',
            'Signing up is a subscription Checkout with only metered prices. Nothing is due, and Stripe creates no invoice until the month ends, but Checkout still saves the card.',
            'When the API serves a request, the server writes a usage row, then sends a meter event: event name, customer ID, value, and the row ID as identifier.',
            'Stripe adds the events up over about a minute. The meter summaries show what it has counted so far.',
            'The invoice preview shows what the end-of-month invoice would be right now, with the first 1,000 requests free.',
            'At the end of the period Stripe creates the invoice from the meters, finalizes it about an hour later and charges the saved card.',
          ]}
          objects={[
            { name: 'Billing Meter', id: 'mtr_…' },
            { name: 'Metered Price', id: 'price_…' },
            { name: 'Meter event', id: 'identifier' },
            { name: 'Subscription', id: 'sub_…' },
            { name: 'Billing Alert', id: 'alrt_…' },
            { name: 'Invoice (usage)', id: 'in_…' },
          ]}
          events={[
            {
              type: 'checkout.session.completed',
              note: 'The metered subscription exists. Nothing was charged and there is no invoice yet.',
            },
            {
              type: 'billing.alert.triggered',
              note: 'Usage passed the alert threshold. Warn the customer.',
            },
            {
              type: 'invoice.created',
              note: 'The period ended and Stripe built the usage invoice.',
            },
            {
              type: 'invoice.paid',
              note: 'The usage was charged to the saved card.',
            },
          ]}
          testCards={[{ number: '4242 4242 4242 4242', note: 'Succeeds' }]}
          production={[
            'Usage never comes back as a webhook. Keep your own record of what you sent, like this page does, to show customers and to reconcile.',
            'Send events from a worker reading an outbox table, not inside the request. Resend with the same identifier: Stripe rejects the duplicate, so treat that error as success.',
            'Fix wrong usage with meter event adjustments, which cancel an event by its identifier, rather than sending negative values.',
            'For high volume, the v2 meter event stream API takes up to 10,000 events a second.',
            'Invalid events (an unknown customer, a bad payload) arrive later as meter error reports, not as API errors. Watch for them.',
            'Cancelling immediately loses unbilled usage unless you pass invoice_now. Cancelling at period end bills it as normal.',
            'Stripe recommends Metronome for new usage-based billing in production, especially with contracts, commits or credit burn-down. This lab uses Billing Meters directly.',
          ]}
        />
      </div>
    </main>
  )
}
