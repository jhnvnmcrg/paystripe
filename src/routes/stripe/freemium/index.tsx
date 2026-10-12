import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import AddonManager from '#/components/stripe/freemium/AddonManager'
import PlanChooser from '#/components/stripe/freemium/PlanChooser'
import Workspace from '#/components/stripe/freemium/Workspace'
import FlowNotes from '#/components/stripe/FlowNotes'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { getFreemiumAccount, getFreemiumStore } from '#/lib/lab/freemium/freemium.functions'

export const Route = createFileRoute('/stripe/freemium/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'Freemium with add-ons | Stripe Lab' }] }),
  loader: () => getFreemiumStore(),
  component: FreemiumPage,
})

const ACCOUNT_KEY = ['freemium-account']
const SETTLE_MS = 15_000

function FreemiumPage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()
  const [settleUntil, setSettleUntil] = useState(0)

  const initial = { planState: store.planState, projects: store.projects, invoices: store.invoices }
  const { data: account } = useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: () => getFreemiumAccount(),
    initialData: initial,
    enabled: store.signedIn,
    refetchInterval: () => (Date.now() < settleUntil ? 2000 : false),
  })

  useEffect(() => {
    queryClient.setQueryData(ACCOUNT_KEY, {
      planState: store.planState,
      projects: store.projects,
      invoices: store.invoices,
    })
  }, [store.planState, store.projects, store.invoices, queryClient])

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== store.signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, store.signedIn, router])

  function refresh() {
    setSettleUntil(Date.now() + SETTLE_MS)
    queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY })
  }

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="freemium"
        summary="Free costs nothing and touches no Stripe objects. Paying users get Plus, then add or remove add-ons on the same subscription, with an exact preview of what each change charges today."
      />

      {canceled ? (
        <Alert className="mt-8 max-w-2xl">
          <AlertTitle>You left checkout</AlertTitle>
          <AlertDescription>Nothing was charged. You're still on Free.</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <PlanChooser
            prices={store.prices}
            catalogError={store.catalogError}
            seeded={store.seeded}
            plan={account.planState.plan}
          />
          {store.signedIn ? (
            <>
              <Workspace planState={account.planState} projects={account.projects} onChanged={refresh} />
              {account.planState.plan === 'plus' ? (
                <AddonManager
                  planState={account.planState}
                  prices={store.prices}
                  invoices={account.invoices}
                  onChanged={refresh}
                />
              ) : null}
            </>
          ) : null}
        </div>

        <FlowNotes
          steps={[
            'Free users get 3 projects and have no Stripe objects at all: no customer, no subscription.',
            'Upgrading opens Checkout with Plus and any add-ons you picked, each as its own line on one subscription.',
            "Changing an add-on later edits the subscription's items. First the server asks Stripe for an invoice preview, with a fixed proration date.",
            "The preview is exactly what today's prorated invoice will be. Confirming sends the same change with the same proration date, and always_invoice charges it at once.",
            'payment_behavior pending_if_incomplete means the change only takes effect if that charge succeeds.',
            'Going back to Free cancels Plus at the end of the period. You keep it until then.',
          ]}
          objects={[
            { name: 'Customer (Plus only)', id: 'cus_…' },
            { name: 'Subscription', id: 'sub_…' },
            { name: 'Subscription Item', id: 'si_…' },
            { name: 'Invoice (prorations)', id: 'in_…' },
          ]}
          events={[
            {
              type: 'customer.subscription.updated',
              note: 'Items changed: an add-on was added, removed or resized.',
            },
            {
              type: 'invoice.paid',
              note: 'The prorated charge for an add-on went through.',
            },
            {
              type: 'customer.subscription.deleted',
              note: 'Plus ended. The workspace is back on Free.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds' },
            { number: '4000 0000 0000 0341', note: 'Saves fine, later charges decline' },
          ]}
          production={[
            'create_prorations instead of always_invoice adds the difference to the next renewal rather than charging now. Pick one and tell customers which.',
            "Reuse the preview's proration date when confirming, or the amounts drift by the second.",
            'Decide what happens to data over the free limit after a downgrade. Here it stays, but new projects are blocked.',
            'Free users cost nothing in Stripe until they upgrade, so there is no reason to create a customer earlier.',
          ]}
        />
      </div>
    </main>
  )
}
