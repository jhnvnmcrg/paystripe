import { LifeBuoy, Trash2, Users } from 'lucide-react'
import { useId, useState } from 'react'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import { FREE_PROJECT_LIMIT } from '#/lib/lab/freemium/catalog'
import { createFreemiumProject, deleteFreemiumProject } from '#/lib/lab/freemium/freemium.functions'
import type { FreemiumPlanState } from '#/lib/lab/freemium/freemium.server'

interface WorkspaceProps {
  planState: FreemiumPlanState
  projects: Array<{ id: number; name: string; createdAt: string }>
  onChanged: () => void
}

/** The product itself: what Free allows, and what each add-on switches on. */
export default function Workspace({ planState, projects, onChanged }: WorkspaceProps) {
  const id = useId()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const atLimit = projects.length >= planState.projectLimit
  const overFreeLimit = planState.plan === 'free' && projects.length > FREE_PROJECT_LIMIT

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createFreemiumProject({ data: { name } })
      setName('')
      onChanged()
    } catch (caught) {
      // The limit is enforced on the server; this shows its answer.
      setError(caught instanceof Error ? caught.message : 'Could not create the project.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(projectId: number) {
    await deleteFreemiumProject({ data: { id: projectId } })
    onChanged()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Your workspace
          <Badge variant={planState.plan === 'plus' ? 'default' : 'secondary'}>
            {planState.plan === 'plus' ? 'Plus' : 'Free'}
          </Badge>
        </CardTitle>
        <CardDescription>
          {planState.plan === 'plus'
            ? `${projects.length} projects. Plus has room for ${planState.projectLimit}.`
            : `${projects.length} of ${FREE_PROJECT_LIMIT} free projects used.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {overFreeLimit ? (
          <Alert>
            <AlertDescription>
              You have more projects than Free allows. They stay, but new ones need Plus.
            </AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={create}>
          <FieldGroup className="flex-row items-end gap-2">
            <Field className="flex-1">
              <FieldLabel htmlFor={`${id}-name`}>New project</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Autumn campaign"
                maxLength={60}
                required
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Create
            </Button>
          </FieldGroup>
        </form>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : atLimit && planState.plan === 'free' ? (
          <p className="m-0 text-sm text-ink-soft">
            That's every free project. The server refuses the next one until you upgrade.
          </p>
        ) : null}

        {projects.length > 0 ? (
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0 text-sm">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-ink">{project.name}</span>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${project.name}`} onClick={() => remove(project.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {planState.plan === 'plus' ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <AddonTile
              on={planState.addons.seats > 0}
              title="Team"
              detail={
                planState.addons.seats > 0
                  ? `You plus ${planState.addons.seats} teammate${planState.addons.seats === 1 ? '' : 's'}`
                  : 'Just you. Add seats to invite people.'
              }
              icon={<Users aria-hidden="true" className="size-4" />}
            />
            <AddonTile
              on={planState.addons.analytics}
              title="Analytics"
              detail={planState.addons.analytics ? <ActivityChart /> : 'Needs the Advanced analytics add-on.'}
            />
            <AddonTile
              on={planState.addons.support}
              title="Support"
              detail={planState.addons.support ? 'Priority: answers within 4 hours' : 'Standard: answers within 2 days'}
              icon={<LifeBuoy aria-hidden="true" className="size-4" />}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function AddonTile({
  on,
  title,
  detail,
  icon,
}: {
  on: boolean
  title: string
  detail: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className={on ? 'rounded-lg border border-line bg-surface p-3' : 'rounded-lg border border-dashed border-line p-3'}>
      <p className="m-0 flex items-center gap-1.5 text-sm font-medium text-ink">
        {icon}
        {title}
      </p>
      <div className="mt-1 text-sm text-ink-soft">{detail}</div>
    </div>
  )
}

/** A small, fixed bar chart standing in for the analytics feature. */
function ActivityChart() {
  const bars = [4, 7, 5, 9, 6, 11, 8]
  return (
    <div className="flex h-12 items-end gap-1" role="img" aria-label="Activity over the last 7 days">
      {bars.map((value, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed sample series
          key={index}
          className="w-full rounded-sm bg-brand"
          style={{ height: `${(value / 11) * 100}%` }}
        />
      ))}
    </div>
  )
}
