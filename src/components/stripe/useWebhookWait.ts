import { useEffect, useState } from 'react'

/**
 * After a seller action, the page polls until the webhook changes the record.
 * `fingerprint` captures everything a webhook can change; waiting stops when it
 * differs from the moment the action was taken, or after `timeoutMs`.
 */
export function useWebhookWait<T extends { id: string }>(
  items: T[],
  fingerprint: (item: T | undefined) => string,
  timeoutMs = 45_000,
) {
  const [awaiting, setAwaiting] = useState<{
    id: string
    signature: string
    until: number
  } | null>(null)

  useEffect(() => {
    if (!awaiting) {
      return
    }
    const item = items.find((candidate) => candidate.id === awaiting.id)
    if (fingerprint(item) !== awaiting.signature || Date.now() > awaiting.until) {
      setAwaiting(null)
    }
  }, [items, awaiting, fingerprint])

  function waitFor(id: string) {
    const item = items.find((candidate) => candidate.id === id)
    setAwaiting({ id, signature: fingerprint(item), until: Date.now() + timeoutMs })
  }

  return { awaitingId: awaiting?.id ?? null, waitFor }
}
