import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { cn } from '#/lib/utils'

interface FlowNotesProps {
  title?: string
  description?: string
  /** The flow in order, one sentence per step. */
  steps: string[]
  /** Stripe objects the flow creates, with their ID prefix. */
  objects?: Array<{ name: string; id: string }>
  /** Webhook events to watch for in `stripe listen`. */
  events?: Array<{ type: string; note: string }>
  testCards?: Array<{ number: string; note: string }>
  /** What would change before taking real payments. */
  production?: string[]
  className?: string
}

/** The "How this flow works" panel shown beside each lab demo. */
export default function FlowNotes({
  title = 'How this flow works',
  description,
  steps,
  objects,
  events,
  testCards,
  production,
  className,
}: FlowNotesProps) {
  return (
    <Card className={cn('gap-5', className)}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-6 text-sm">
        <NotesSection title="Steps">
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="amount w-4 shrink-0 text-ink-soft">{index + 1}</span>
                <span className="text-ink">{step}</span>
              </li>
            ))}
          </ol>
        </NotesSection>

        {objects?.length ? (
          <NotesSection title="Stripe objects created">
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              {objects.map((object) => (
                <div key={object.name} className="contents">
                  <dt className="text-ink">{object.name}</dt>
                  <dd className="amount m-0 text-ink-soft">{object.id}</dd>
                </div>
              ))}
            </dl>
          </NotesSection>
        ) : null}

        {events?.length ? (
          <NotesSection title="Webhook events to watch">
            <dl className="m-0 flex flex-col gap-2.5">
              {events.map((event) => (
                <div key={event.type}>
                  <dt className="amount break-all text-ink">{event.type}</dt>
                  <dd className="m-0 mt-0.5 text-ink-soft">{event.note}</dd>
                </div>
              ))}
            </dl>
          </NotesSection>
        ) : null}

        {testCards?.length ? (
          <NotesSection title="Test cards">
            <dl className="m-0 flex flex-col gap-1.5">
              {testCards.map((card) => (
                <div key={card.number} className="flex flex-wrap justify-between gap-x-4">
                  <dt className="amount text-ink">{card.number}</dt>
                  <dd className="m-0 text-ink-soft">{card.note}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 mt-2 text-xs text-ink-soft">
              Use any future expiry date, any CVC and any postcode.
            </p>
          </NotesSection>
        ) : null}

        {production?.length ? (
          <NotesSection title="Before taking real payments">
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 text-ink">
              {production.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </NotesSection>
        ) : null}
      </CardContent>
    </Card>
  )
}

function NotesSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="m-0 mb-2.5 text-[0.8125rem] font-semibold text-ink-soft">{title}</h3>
      {children}
    </section>
  )
}
