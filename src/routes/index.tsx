import { createFileRoute, Link } from '@tanstack/react-router'
import FlowStrip from '#/components/stripe/FlowStrip'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/')({ component: Home })

const rules = [
  {
    title: 'Sandbox only',
    body: 'The server refuses live API keys, so test cards are the only way to pay.',
  },
  {
    title: 'The webhook is the receipt',
    body: "Access is granted when Stripe's event arrives, not when the browser reaches a success page.",
  },
  {
    title: 'Every event counts once',
    body: 'Stripe can deliver the same event twice. The server records each event ID and skips repeats.',
  },
  {
    title: 'Prices are looked up by name',
    body: 'A seed script creates products and prices with lookup keys, so no price IDs are pasted into code.',
  },
]

function Home() {
  return (
    <main className="page-wrap px-4 pb-16 pt-14 sm:pt-20">
      <section className="max-w-3xl">
        <h1 className="display-title m-0 text-4xl leading-[1.05] text-ink sm:text-6xl">
          Ten ways to get paid, wired end to end.
        </h1>
        <p className="m-0 mt-5 max-w-2xl text-base text-ink-soft sm:text-lg">
          Working demos of the most common ways to sell software and goods, from
          a $29 license key to a marketplace payout. Each one runs against your
          Stripe sandbox, so no real money moves.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/stripe">Open the lab</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#rules">Read the rules</a>
          </Button>
        </div>
      </section>

      <FlowStrip className="mt-14" />

      <section id="rules" className="mt-16 scroll-mt-24">
        <h2 className="m-0 text-xl font-semibold tracking-tight text-ink">
          Rules every demo follows
        </h2>
        <dl className="m-0 mt-6 grid gap-x-12 gap-y-6 sm:grid-cols-2">
          {rules.map((rule) => (
            <div key={rule.title} className="max-w-md">
              <dt className="font-medium text-ink">{rule.title}</dt>
              <dd className="m-0 mt-1 text-sm text-ink-soft">{rule.body}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  )
}
