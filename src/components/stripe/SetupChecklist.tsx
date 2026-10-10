import { useHydrated } from '@tanstack/react-router'
import { CircleCheck, CircleX, RefreshCw, TriangleAlert } from 'lucide-react'
import type { LabSetupStatus, SetupCheckState } from '#/lib/lab/setup.server'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { cn } from '#/lib/utils'

const stateIcon = {
  ok: CircleCheck,
  warn: TriangleAlert,
  missing: CircleX,
} satisfies Record<SetupCheckState, unknown>

const stateColor: Record<SetupCheckState, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  missing: 'text-danger',
}

interface SetupChecklistProps {
  status: LabSetupStatus
  onRefresh: () => void
  refreshing: boolean
  className?: string
}

/** Shows whether the sandbox key, webhook listener and lab tables are ready. */
export default function SetupChecklist({
  status,
  onRefresh,
  refreshing,
  className,
}: SetupChecklistProps) {
  const ready = status.checks.every((check) => check.state !== 'missing')
  // Times are formatted in the browser's timezone, so wait for hydration.
  const hydrated = useHydrated()

  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader>
        <CardTitle className="text-base">Sandbox setup</CardTitle>
        <CardDescription>
          {ready
            ? 'Everything the demos need is connected.'
            : 'Finish these before buying anything in a demo.'}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw data-icon="inline-start" className={cn(refreshing && 'animate-spin')} />
            Check again
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 text-sm">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {status.checks.map((check) => {
            const Icon = stateIcon[check.state]
            return (
              <li key={check.id} className="flex gap-3">
                <Icon
                  aria-hidden="true"
                  className={cn('mt-0.5 size-4 shrink-0', stateColor[check.state])}
                />
                <div className="min-w-0">
                  <p className="m-0 font-medium text-ink">
                    {check.label}
                    <span className="sr-only">: {check.state}</span>
                  </p>
                  <p className="m-0 mt-0.5 text-ink-soft">{check.detail}</p>
                </div>
              </li>
            )
          })}
        </ul>

        {status.recentEvents.length > 0 ? (
          <div>
            <h3 className="m-0 mb-2 text-[0.8125rem] font-semibold text-ink-soft">
              Latest events received
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {status.recentEvents.map((event) => (
                <li key={event.id} className="flex flex-wrap justify-between gap-x-4">
                  <span className="amount break-all text-ink">{event.type}</span>
                  <time className="text-ink-soft" dateTime={event.receivedAt}>
                    {hydrated ? new Date(event.receivedAt).toLocaleTimeString() : null}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
