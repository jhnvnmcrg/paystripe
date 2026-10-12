import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'

/** Copies a value to the clipboard and confirms it for a moment. */
export default function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={copied ? 'Copied' : label}>
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}
