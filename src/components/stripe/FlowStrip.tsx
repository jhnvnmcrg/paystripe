import { cn } from '#/lib/utils'

const stops = [
  {
    name: 'Buyer',
    detail: 'Signs in. The server finds or creates their Stripe customer.',
    id: 'cus_…',
  },
  {
    name: 'Checkout',
    detail: "Pays on Stripe's hosted page with a test card.",
    id: 'cs_test_…',
  },
  {
    name: 'Webhook',
    detail: 'Stripe tells the server the payment went through.',
    id: 'checkout.session.completed',
  },
  {
    name: 'Fulfilled',
    detail: 'The server grants what was bought: a key, a file, a plan or credits.',
    id: null,
  },
]

/** The payment flow every lab demo follows, drawn as one track. */
export default function FlowStrip({ className }: { className?: string }) {
  return (
    <figure
      className={cn('island-shell m-0 rounded-xl px-5 py-6 sm:px-8 sm:py-8', className)}
    >
      <figcaption className="text-sm text-ink-soft">
        What happens when someone pays, in every demo
      </figcaption>

      <div className="relative mt-7">
        {/* Vertical track on phones, horizontal from sm up. Both run dot centre to dot centre. */}
        <div
          aria-hidden="true"
          className="absolute bottom-3 left-[10px] top-3 w-px bg-line-strong sm:hidden"
        >
          <div className="flow-track-fill-y h-full w-full bg-brand" />
        </div>
        <div
          aria-hidden="true"
          className="absolute left-[12.5%] right-[12.5%] top-[10px] hidden h-px bg-line-strong sm:block"
        >
          <div className="flow-track-fill h-full w-full bg-brand" />
        </div>

        <ol className="relative m-0 grid list-none gap-7 p-0 sm:grid-cols-4 sm:gap-0">
          {stops.map((stop, index) => (
            <li key={stop.name} className="relative pl-9 sm:px-3 sm:text-center">
              <span
                aria-hidden="true"
                className="flow-dot absolute left-0 top-0 block size-[21px] rounded-full sm:relative sm:mx-auto"
                style={{ animationDelay: `${index * 700 + 150}ms` }}
              />
              <p className="m-0 font-medium text-ink sm:mt-4">
                <span className="sr-only">Step {index + 1}: </span>
                {stop.name}
              </p>
              <p className="m-0 mt-1 text-sm text-ink-soft">{stop.detail}</p>
              {stop.id ? (
                <p className="amount m-0 mt-2 break-all text-xs text-ink-soft">
                  {stop.id}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </figure>
  )
}
