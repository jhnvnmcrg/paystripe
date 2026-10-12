import { useAuth } from '@clerk/tanstack-react-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import AutoRecharge from '#/components/stripe/credits/AutoRecharge'
import CreditActions from '#/components/stripe/credits/CreditActions'
import CreditPacks from '#/components/stripe/credits/CreditPacks'
import CreditPurchases from '#/components/stripe/credits/CreditPurchases'
import CreditWallet from '#/components/stripe/credits/CreditWallet'
import FlowNotes from '#/components/stripe/FlowNotes'
import ModuleHeader from '#/components/stripe/ModuleHeader'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { getCreditsStore, getCreditsWallet } from '#/lib/lab/credits/credits.functions'

export const Route = createFileRoute('/stripe/credits/')({
  validateSearch: (search: Record<string, unknown>): { canceled?: true } =>
    search.canceled ? { canceled: true } : {},
  head: () => ({ meta: [{ title: 'Prepaid credits | Stripe Lab' }] }),
  loader: () => getCreditsStore(),
  component: CreditsPage,
})

const WALLET_KEY = ['credits-wallet']
const SETTLE_MS = 15_000

function CreditsPage() {
  const store = Route.useLoaderData()
  const { canceled } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { isLoaded, isSignedIn } = useAuth()
  const [settleUntil, setSettleUntil] = useState(0)

  const { data: wallet } = useQuery({
    queryKey: WALLET_KEY,
    queryFn: () => getCreditsWallet(),
    initialData: store.wallet,
    enabled: store.signedIn,
    refetchInterval: () => (Date.now() < settleUntil ? 2000 : false),
  })

  useEffect(() => {
    queryClient.setQueryData(WALLET_KEY, store.wallet)
  }, [store.wallet, queryClient])

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== store.signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, store.signedIn, router])

  function refresh() {
    setSettleUntil(Date.now() + SETTLE_MS)
    queryClient.invalidateQueries({ queryKey: WALLET_KEY })
  }

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <ModuleHeader
        slug="credits"
        summary="Customers buy credits up front and spend them on each action. The balance lives in your database, so an action can be refused the moment credits run out, and a saved card tops it up automatically."
      />

      {canceled ? (
        <Alert className="mt-8 max-w-2xl">
          <AlertTitle>You left checkout</AlertTitle>
          <AlertDescription>Nothing was charged.</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {store.signedIn && wallet ? (
            <div className="grid items-start gap-4 md:grid-cols-2">
              <CreditWallet balance={wallet.account.balance} ledger={wallet.ledger} />
              <CreditActions balance={wallet.account.balance} onSpent={refresh} />
            </div>
          ) : null}

          <CreditPacks prices={store.prices} catalogError={store.catalogError} seeded={store.seeded} />

          {store.signedIn && wallet ? (
            <>
              <AutoRecharge account={wallet.account} onChanged={refresh} />
              <CreditPurchases purchases={wallet.purchases} onChanged={refresh} />
            </>
          ) : null}
        </div>

        <FlowNotes
          steps={[
            'A pack is a one-time Checkout payment. setup_future_usage: off_session asks Checkout to save the card, with the customer’s consent, for later charges.',
            'The webhook adds the pack’s credits to a ledger row keyed by the Payment Intent ID. That key is unique, so the pack can only be credited once.',
            'Spending is one conditional UPDATE: subtract only if the balance covers it. It can’t go below zero, even with two requests at once.',
            'If a spend takes the balance under your threshold, the server creates a Payment Intent with off_session and confirm, charging the saved card right away.',
            'A decline comes back as an error straight away. Auto-recharge turns itself off and the page asks for a new card, saved through Checkout in setup mode.',
            'Refunding a pack or top-up takes back that share of its credits, never below zero.',
          ]}
          objects={[
            { name: 'Price (one per pack)', id: 'price_…' },
            { name: 'Payment Intent (pack)', id: 'pi_…' },
            { name: 'Payment Method (saved)', id: 'pm_…' },
            { name: 'Payment Intent (top-up)', id: 'pi_…' },
            { name: 'Setup Intent (new card)', id: 'seti_…' },
            { name: 'Refund', id: 're_…' },
          ]}
          events={[
            {
              type: 'checkout.session.completed',
              note: 'A pack was paid (credits added) or a card was saved (setup mode).',
            },
            {
              type: 'payment_intent.succeeded',
              note: 'A top-up went through. Credits are added if the request didn’t already.',
            },
            {
              type: 'payment_intent.payment_failed',
              note: 'A top-up was declined. Auto-recharge is switched off.',
            },
            {
              type: 'charge.refunded',
              note: 'Credits from that purchase are taken back.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds, now and later' },
            { number: '4000 0000 0000 0341', note: 'Saves fine, later charges decline: use it to replace the card' },
            {
              number: '4000 0027 6000 3184',
              note: 'Always asks for authentication, so off-session top-ups fail (authentication_required)',
            },
          ]}
          production={[
            'Run top-ups in a background job, not inside the request that spent the credits.',
            'Tell customers what will be charged and when, and get their agreement before saving a card for later.',
            'Stripe Billing Credits (credit grants) can prepay a metered subscription like step 8. This lab keeps its own ledger because it must refuse an action the moment credits run out.',
            'Decide whether credits expire, and say so. Unused prepaid balances can have accounting and legal rules.',
            'Show a receipt for each top-up. Stripe can email one when you set receipt_email or turn on receipts in the Dashboard.',
          ]}
        />
      </div>
    </main>
  )
}
