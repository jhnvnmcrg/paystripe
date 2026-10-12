import { CircleCheck, CircleX } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Spinner } from '#/components/ui/spinner'
import type { LicenseValidation } from '#/lib/lab/license-keys/licenses.server'

interface ActivationTesterProps {
  /** The user's keys, offered as suggestions. */
  knownKeys: string[]
  /** Called after each request, so device counts refresh. */
  onRequestDone: () => void
}

/** Sends the same request a desktop app would send on launch. */
export default function ActivationTester({ knownKeys, onRequestDone }: ActivationTesterProps) {
  const keyListId = useId()
  const [typedKey, setTypedKey] = useState<string | null>(null)
  // Until the user types, suggest their newest key (which may arrive after a purchase).
  const key = typedKey ?? knownKeys[0] ?? ''
  const [machineId, setMachineId] = useState('my-laptop')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ status: number; body: LicenseValidation } | null>(null)
  const [networkError, setNetworkError] = useState<string | null>(null)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    setSending(true)
    setNetworkError(null)
    try {
      const response = await fetch('/api/license/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, machineId }),
      })
      setResult({ status: response.status, body: await response.json() })
      onRequestDone()
    } catch {
      setNetworkError('The request did not reach the server.')
    } finally {
      setSending(false)
    }
  }

  function newDevice() {
    setMachineId(`device-${Math.random().toString(36).slice(2, 7)}`)
  }

  return (
    <Card id="activate">
      <CardHeader>
        <CardTitle className="text-base">Activate a key like an app would</CardTitle>
        <CardDescription>
          On launch, an app posts its key and a device ID to <code>/api/license/validate</code>.
          This form sends the same request.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={send}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="license-key">License key</FieldLabel>
              <Input
                id="license-key"
                className="amount"
                list={keyListId}
                value={key}
                onChange={(event) => setTypedKey(event.target.value)}
                placeholder="ABCD-EFGH-JKLM-NPQR"
                autoComplete="off"
                required
              />
              <datalist id={keyListId}>
                {knownKeys.map((known) => (
                  <option key={known} value={known} />
                ))}
              </datalist>
            </Field>
            <Field>
              <FieldLabel htmlFor="machine-id">Device ID</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="machine-id"
                  className="amount"
                  value={machineId}
                  onChange={(event) => setMachineId(event.target.value)}
                  required
                />
                <Button type="button" variant="outline" onClick={newDevice}>
                  New device
                </Button>
              </div>
              <FieldDescription>
                Apps usually derive this from the hardware. Change it to use up device slots.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Button type="submit" disabled={sending}>
                {sending ? <Spinner data-icon="inline-start" /> : null}
                Send request
              </Button>
            </Field>
          </FieldGroup>
        </form>

        {networkError ? <p className="m-0 text-sm text-danger">{networkError}</p> : null}

        {result ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 flex items-center gap-2 text-sm font-medium text-ink">
              {result.body.valid ? (
                <CircleCheck aria-hidden="true" className="size-4 text-success" />
              ) : (
                <CircleX aria-hidden="true" className="size-4 text-danger" />
              )}
              {result.body.valid
                ? result.body.newlyActivated
                  ? `Activated. ${result.body.activations.used} of ${result.body.activations.max} devices in use.`
                  : 'Valid. This device was already activated.'
                : result.body.message}
            </p>
            <pre className="demo-code-block m-0">
              {`HTTP ${result.status}\n${JSON.stringify(result.body, null, 2)}`}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
