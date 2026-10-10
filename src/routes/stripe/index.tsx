import { createFileRoute, Link } from '@tanstack/react-router'
import FlowNotes from '#/components/stripe/FlowNotes'
import { Badge } from '#/components/ui/badge'
import type { LabModule } from '#/lib/lab/modules'
import { labModules } from '#/lib/lab/modules'

export const Route = createFileRoute('/stripe/')({
  head: () => ({ meta: [{ title: 'Selling types | Stripe Lab' }] }),
  component: LabHub,
})

function LabHub() {
  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <header className="max-w-2xl">
        <h1 className="display-title m-0 text-4xl text-ink sm:text-5xl">Selling types</h1>
        <p className="m-0 mt-3 text-base text-ink-soft sm:text-lg">
          Each selling type is a working store connected to your Stripe sandbox.
          Buy something with a test card, then see what Stripe sent and what the
          server did with it.
        </p>
      </header>

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="selling-types-heading">
          <h2 id="selling-types-heading" className="sr-only">
            Selling types in build order
          </h2>
          <ol className="m-0 list-none divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface p-0">
            {labModules.map((module) => (
              <ModuleRow key={module.slug} module={module} />
            ))}
          </ol>
        </section>

        <FlowNotes
          className="lg:sticky lg:top-24"
          title="How every demo works"
          description="The same five steps sit underneath all ten selling types."
          steps={[
            'You sign in, and the server finds or creates your Stripe customer.',
            "The server creates a Checkout Session and sends you to Stripe's payment page.",
            'You pay with a test card. Stripe sends you back, but nothing is granted yet.',
            'Stripe sends a signed webhook event to the server, which verifies it.',
            'The server grants what you bought and the page updates.',
          ]}
          objects={[
            { name: 'Customer', id: 'cus_…' },
            { name: 'Checkout Session', id: 'cs_test_…' },
            { name: 'Payment Intent', id: 'pi_…' },
            { name: 'Event', id: 'evt_…' },
          ]}
          events={[
            {
              type: 'checkout.session.completed',
              note: 'Checkout finished. The server checks the payment status before granting anything.',
            },
            {
              type: 'checkout.session.async_payment_succeeded',
              note: 'A delayed payment method, such as a bank debit, has cleared.',
            },
          ]}
          testCards={[
            { number: '4242 4242 4242 4242', note: 'Succeeds' },
            { number: '4000 0000 0000 0002', note: 'Declined' },
            { number: '4000 0025 0000 3155', note: 'Asks for 3D Secure' },
          ]}
          production={[
            'Replace the sandbox key with a live restricted key.',
            'Register the webhook endpoint in the Stripe Dashboard instead of using the CLI listener.',
            'Turn on Stripe Tax once you have a tax registration.',
          ]}
        />
      </div>
    </main>
  )
}

function ModuleRow({ module }: { module: LabModule }) {
  return (
    <li className="relative flex gap-4 px-4 py-4 transition-colors has-[a:hover]:bg-surface-sunken sm:px-5">
      <span className="amount w-5 shrink-0 pt-px text-sm text-ink-soft">{module.step}</span>
      <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
        <div className="min-w-0">
          <h3 className="m-0 text-[0.9375rem] font-medium text-ink">
            {module.to ? (
              <Link
                to={module.to}
                className="text-ink no-underline after:absolute after:inset-0"
              >
                {module.name}
              </Link>
            ) : (
              module.name
            )}
          </h3>
          <p className="m-0 mt-0.5 text-sm text-ink-soft">{module.examples}</p>
        </div>
        <p className="m-0 text-sm text-ink">{module.moneyFlow}</p>
        <div>
          <StatusBadge status={module.status} />
        </div>
      </div>
    </li>
  )
}

function StatusBadge({ status }: { status: LabModule['status'] }) {
  if (status === 'ready') {
    return <Badge>Ready</Badge>
  }
  if (status === 'next') {
    return <Badge variant="outline">Up next</Badge>
  }
  return <Badge variant="secondary">Planned</Badge>
}
