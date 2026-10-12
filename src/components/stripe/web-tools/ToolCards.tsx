import { Lock } from 'lucide-react'
import { useState } from 'react'
import CopyButton from '#/components/stripe/CopyButton'
import LocalTime from '#/components/stripe/LocalTime'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import type { ToolFeatureKey } from '#/lib/lab/web-tools/catalog'
import { cheapestPlanWith, findToolFeature } from '#/lib/lab/web-tools/catalog'
import {
  createToolsApiKey,
  exportProjects,
  runBackgroundRemover,
} from '#/lib/lab/web-tools/tools.functions'

interface ToolCardsProps {
  entitlements: string[]
  apiKey: { prefix: string; createdAt: string; lastUsedAt: string | null } | null
  onApiKeyChanged: () => void
}

/** The tools themselves. Each button calls the server, which checks the entitlement itself. */
export default function ToolCards({ entitlements, apiKey, onApiKeyChanged }: ToolCardsProps) {
  return (
    <section aria-labelledby="tools-heading" className="flex flex-col gap-4">
      <h2 id="tools-heading" className="m-0 text-xl font-semibold tracking-tight text-ink">
        Tools
      </h2>
      <BackgroundRemover unlocked={entitlements.includes('bg_remover')} />
      <BulkExport unlocked={entitlements.includes('bulk_export')} />
      <ApiAccess
        unlocked={entitlements.includes('api_access')}
        apiKey={apiKey}
        onApiKeyChanged={onApiKeyChanged}
      />
    </section>
  )
}

/** Runs a tool action and turns a refusal from the server into a message. */
function useToolAction<T>() {
  const [running, setRunning] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [result, setResult] = useState<T | null>(null)

  async function run(action: () => Promise<T>) {
    setRunning(true)
    setRefusal(null)
    try {
      setResult(await action())
    } catch (caught) {
      setResult(null)
      setRefusal(caught instanceof Error ? caught.message : 'The server refused.')
    } finally {
      setRunning(false)
    }
  }
  return { running, refusal, result, run }
}

function ToolShell({
  feature,
  unlocked,
  running,
  refusal,
  actionLabel,
  onAction,
  children,
}: {
  feature: ToolFeatureKey
  unlocked: boolean
  running: boolean
  refusal: string | null
  actionLabel: string
  onAction: () => void
  children?: React.ReactNode
}) {
  const info = findToolFeature(feature)
  const plan = cheapestPlanWith(feature)

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {unlocked ? null : <Lock aria-hidden="true" className="size-4 text-ink-soft" />}
          {info?.name}
        </CardTitle>
        <CardDescription>
          {info?.description}
          {unlocked ? null : ` Included in ${plan?.name}.`}
        </CardDescription>
      </CardHeader>
      {children || refusal ? (
        <CardContent className="flex flex-col gap-3">
          {refusal ? (
            <Alert variant="destructive">
              <AlertTitle>The server said no</AlertTitle>
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          ) : null}
          {children}
        </CardContent>
      ) : null}
      <CardFooter className="flex flex-wrap items-center gap-3">
        <Button variant={unlocked ? 'default' : 'outline'} size="sm" disabled={running} onClick={onAction}>
          {running ? <Spinner data-icon="inline-start" /> : null}
          {unlocked ? actionLabel : 'Try it anyway'}
        </Button>
        {unlocked ? null : (
          <span className="text-xs text-ink-soft">
            The button is only a hint. The server checks your plan either way.
          </span>
        )}
      </CardFooter>
    </Card>
  )
}

function svgSrc(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function BackgroundRemover({ unlocked }: { unlocked: boolean }) {
  const { running, refusal, result, run } = useToolAction<{ before: string; after: string }>()
  return (
    <ToolShell
      feature="bg_remover"
      unlocked={unlocked}
      running={running}
      refusal={refusal}
      actionLabel="Remove the background"
      onAction={() => run(() => runBackgroundRemover())}
    >
      {result ? (
        <div className="grid grid-cols-2 gap-3">
          <figure className="m-0">
            <img src={svgSrc(result.before)} alt="A mug on an orange backdrop" className="w-full rounded-lg border border-line" />
            <figcaption className="mt-1 text-xs text-ink-soft">Before</figcaption>
          </figure>
          <figure className="m-0">
            <img
              src={svgSrc(result.after)}
              alt="The same mug with the backdrop removed"
              className="w-full rounded-lg border border-line bg-[conic-gradient(var(--line)_25%,transparent_0_50%,var(--line)_0_75%,transparent_0)] bg-[length:16px_16px]"
            />
            <figcaption className="mt-1 text-xs text-ink-soft">After</figcaption>
          </figure>
        </div>
      ) : null}
    </ToolShell>
  )
}

function BulkExport({ unlocked }: { unlocked: boolean }) {
  const { running, refusal, result, run } = useToolAction<{ csv: string }>()

  async function exportAndDownload() {
    const output = await exportProjects()
    const url = URL.createObjectURL(new Blob([output.csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'projects.csv'
    link.click()
    URL.revokeObjectURL(url)
    return output
  }

  return (
    <ToolShell
      feature="bulk_export"
      unlocked={unlocked}
      running={running}
      refusal={refusal}
      actionLabel="Download projects.csv"
      onAction={() => run(exportAndDownload)}
    >
      {result ? <pre className="demo-code-block m-0">{result.csv}</pre> : null}
    </ToolShell>
  )
}

function ApiAccess({
  unlocked,
  apiKey,
  onApiKeyChanged,
}: {
  unlocked: boolean
  apiKey: ToolCardsProps['apiKey']
  onApiKeyChanged: () => void
}) {
  const { running, refusal, result, run } = useToolAction<{ key: string }>()
  const [call, setCall] = useState<{ status: number; body: string } | null>(null)
  const [calling, setCalling] = useState(false)

  async function callApi(key: string) {
    setCalling(true)
    try {
      const response = await fetch('/api/tools/v1/projects', { headers: { authorization: `Bearer ${key}` } })
      setCall({ status: response.status, body: JSON.stringify(await response.json(), null, 2) })
      onApiKeyChanged()
    } finally {
      setCalling(false)
    }
  }

  return (
    <ToolShell
      feature="api_access"
      unlocked={unlocked}
      running={running}
      refusal={refusal}
      actionLabel={apiKey ? 'Replace my API key' : 'Create an API key'}
      onAction={() =>
        run(async () => {
          const created = await createToolsApiKey()
          onApiKeyChanged()
          return created
        })
      }
    >
      {apiKey && !result ? (
        <p className="m-0 text-sm text-ink-soft">
          Your key starts with <span className="amount text-ink">{apiKey.prefix}</span>, created{' '}
          <LocalTime iso={apiKey.createdAt} />. Only its hash is stored, so it can't be shown again;
          replace it to get a new one.
        </p>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="m-0 text-ink">Copy it now. This is the only time it's shown.</p>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2">
            <span className="amount min-w-0 break-all text-ink">{result.key}</span>
            <CopyButton value={result.key} label="Copy API key" />
          </div>
          <pre className="demo-code-block m-0 whitespace-pre-wrap break-all">
            {`curl -H "Authorization: Bearer ${result.key}" \\\n  ${typeof window === 'undefined' ? '' : window.location.origin}/api/tools/v1/projects`}
          </pre>
          <Button variant="outline" size="sm" className="self-start" disabled={calling} onClick={() => callApi(result.key)}>
            {calling ? <Spinner data-icon="inline-start" /> : null}
            Call the API with this key
          </Button>
          {call ? (
            <pre className="demo-code-block m-0">{`HTTP ${call.status}\n${call.body}`}</pre>
          ) : null}
        </div>
      ) : null}
    </ToolShell>
  )
}
