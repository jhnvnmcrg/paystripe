import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import FlowNotes from '#/components/stripe/FlowNotes'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import ToolCards from '#/components/stripe/web-tools/ToolCards'
import ToolsAccess from '#/components/stripe/web-tools/ToolsAccess'
import ToolsPlans from '#/components/stripe/web-tools/ToolsPlans'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { getToolsAccount, getToolsStore } from '#/lib/lab/web-tools/tools.functions'

export const Route = createFileRoute('/stripe/web-tools/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'Gated web tools | Stripe Lab' }] }),
  loader: () => getToolsStore(),
  component: WebToolsPage,
})

const ACCOUNT_KEY = ['tools-account']
/** Entitlements can arrive a moment after the subscription; keep polling this long after returning. */
const SETTLE_MS = 30_000
const LIVE = ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete']

function WebToolsPage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()
  // Poll briefly on arrival too: returning from the Portal triggers webhooks a few seconds later.
  const [settleUntil, setSettleUntil] = useState(() => Date.now() + SETTLE_MS)

  const initial = {
    subscription: store.subscription,
    invoices: store.invoices,
    entitlements: store.entitlements,
    apiKey: store.apiKey,
  }
  const { data: account } = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () => getToolsAccount(),
    initialData: initial,
    enabled: store.signedIn,
    refetchInterval: () => (Date.now() < settleUntil ? 2000 : false),
  })

  useEffect(() => {
    queryClient.setQueryData(ACCOUNT_KEY, {
      subscription: store.subscription,
      invoices: store.invoices,
      entitlements: store.entitlements,
      apiKey: store.apiKey,
    })
  }, [store.subscription, store.invoices, store.entitlements, store.apiKey, queryClient])

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== store.signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, store.signedIn, router])

  function refresh() {
    setSettleUntil(Date.now() + 5_000)
    queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY })
  }

  const current =
    account.subscription && LIVE.includes(account.subscription.status) ? account.subscription : null

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="web-tools"
        summary="A subscription unlocks specific features, not just 'the app'. Stripe's Entitlements API says which features a customer's plans include; the server checks that list before every gated action."
      />

      {canceled ? (
        <Alert className="mt-8 max-w-2xl">
          <AlertTitle>You left checkout</AlertTitle>
          <AlertDescription>Nothing was charged and your tools stay as they were.</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <ToolsPlans plans={store.plans} catalogError={store.catalogError} currentPlan={current?.planKey ?? null} />
          {store.signedIn ? (
            <>
              <ToolsAccess
                subscription={account.subscription}
                entitlements={account.entitlements}
                invoices={account.invoices}
              />
              <ToolCards entitlements={account.entitlements} apiKey={account.apiKey} onApiKeyChanged={refresh} />
            </>
          ) : null}
        </div>

        <FlowNotes
          steps={[
            'In Stripe, each tool is a Feature (bg_remover, bulk_export, api_access). Features are attached to the plan Products.',
            'You subscribe through Checkout, as in the SaaS step. The subscription is stored the same way.',
            'Stripe works out which Features your active subscriptions include, then sends entitlements.active_entitlement_summary.updated.',
            "The webhook re-reads your full entitlement list from Stripe and caches it, because the event's summary can be cut short.",
            'Every tool action, and every API call, checks that cache on the server. Change plans in the Portal and the next check reflects it.',
          ]}
          objects={[
            { name: 'Feature', id: 'feat_…' },
            { name: 'Product Feature', id: 'prodft_…' },
            { name: 'Subscription', id: 'sub_…' },
            { name: 'Active Entitlement', id: 'ent_…' },
          ]}
          events={[
            {
              type: 'entitlements.active_entitlement_summary.updated',
              note: 'What this customer may use changed. Re-read the full list and cache it.',
            },
            {
              type: 'customer.subscription.updated',
              note: 'A plan change. The entitlement event usually follows a moment later.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds' },
            { number: '4000 0025 0000 3155', note: 'Asks for 3D Secure' },
          ]}
          production={[
            'Check entitlements on the server for every gated request; hiding buttons is only a hint.',
            'Keep the cache, rather than calling Stripe on each request, and refresh it from the webhook.',
            'Add a feature to a plan in the Dashboard and existing subscribers get it without a code change.',
            'Store API keys as hashes and check the entitlement on each call, so a downgrade cuts off access straight away.',
          ]}
        />
      </div>
    </main>
  )
}
