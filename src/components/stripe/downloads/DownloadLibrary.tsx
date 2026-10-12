import { Download, Timer } from 'lucide-react'
import { useState } from 'react'
import LocalTime from '#/components/stripe/LocalTime'
import OrderHeading from '#/components/stripe/OrderHeading'
import SellerActions from '#/components/stripe/SellerActions'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Spinner } from '#/components/ui/spinner'
import {
  getDownloadLink,
  refundDownloadOrder,
  resolveDownloadDispute,
} from '#/lib/lab/downloads/downloads.functions'
import type { DownloadGrantView, DownloadOrderView } from '#/lib/lab/downloads/downloads.server'

const PARTIAL_REFUND = 500

const grantStatusVariant = {
  active: 'default',
  suspended: 'destructive',
  revoked: 'secondary',
} as const

export interface IssuedLink {
  productName: string
  url: string
  expiresAt: string
  short: boolean
}

interface DownloadLibraryProps {
  orders: DownloadOrderView[]
  awaitingOrderId: string | null
  onAction: (orderId: string) => void
  /** Called after a download starts, so the remaining count refreshes. */
  onDownloaded: () => void
}

export default function DownloadLibrary({
  orders,
  awaitingOrderId,
  onAction,
  onDownloaded,
}: DownloadLibraryProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastLink, setLastLink] = useState<IssuedLink | null>(null)

  async function run(id: string, action: () => Promise<unknown>, after?: () => void) {
    setBusy(id)
    setError(null)
    try {
      await action()
      after?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That action failed.')
    } finally {
      setBusy(null)
    }
  }

  function download(grant: DownloadGrantView) {
    return run(grant.id, async () => {
      const link = await getDownloadLink({ data: { grantId: grant.id } })
      setLastLink({ productName: grant.productName, short: false, ...link })
      // The response is an attachment, so the browser saves it and stays on this page.
      window.location.assign(link.url)
      window.setTimeout(onDownloaded, 1500)
    })
  }

  function shortLink(grant: DownloadGrantView) {
    return run(grant.id, async () => {
      const link = await getDownloadLink({ data: { grantId: grant.id, short: true } })
      setLastLink({ productName: grant.productName, short: true, ...link })
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your library</CardTitle>
          <CardDescription>
            Each file can be downloaded {orders[0]?.grants[0]?.maxDownloads ?? 5} times. Every
            download gets a fresh signed link that expires after 10 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {orders.length === 0 ? (
            <p className="m-0 text-sm text-ink-soft">
              Nothing here yet. Pick some files above and pay with 4242 4242 4242 4242.
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {orders.map((order) => {
                const awaiting = awaitingOrderId === order.id
                return (
                  <li key={order.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                    <OrderHeading order={order} awaiting={awaiting} />

                    {order.grants.map((grant) => (
                      <GrantRow
                        key={grant.id}
                        grant={grant}
                        busy={busy === grant.id}
                        onDownload={() => download(grant)}
                        onShortLink={() => shortLink(grant)}
                      />
                    ))}

                    <SellerActions
                      order={order}
                      partialRefund={PARTIAL_REFUND}
                      disabled={busy !== null || awaiting}
                      onRefund={(amount) =>
                        run(
                          order.id,
                          () => refundDownloadOrder({ data: { orderId: order.id, amount } }),
                          () => onAction(order.id),
                        )
                      }
                      onResolveDispute={(outcome) =>
                        run(
                          order.id,
                          () => resolveDownloadDispute({ data: { orderId: order.id, outcome } }),
                          () => onAction(order.id),
                        )
                      }
                    />
                  </li>
                )
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {lastLink ? <LinkInspector link={lastLink} onUsed={onDownloaded} /> : null}
    </div>
  )
}

function GrantRow({
  grant,
  busy,
  onDownload,
  onShortLink,
}: {
  grant: DownloadGrantView
  busy: boolean
  onDownload: () => void
  onShortLink: () => void
}) {
  const left = grant.maxDownloads - grant.downloadsUsed
  const usable = grant.status === 'active' && left > 0

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-ink">{grant.productName}</span>
          <span className="amount text-xs text-ink-soft">{grant.fileName}</span>
          <Badge variant={grantStatusVariant[grant.status]}>
            {grant.status === 'active'
              ? 'Available'
              : grant.status === 'suspended'
                ? 'Suspended'
                : 'Revoked'}
          </Badge>
        </div>
        <span className="text-sm text-ink-soft">
          {left} of {grant.maxDownloads} downloads left
        </span>
      </div>
      {grant.statusReason ? (
        <p className="m-0 text-sm text-ink-soft">{grant.statusReason}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!usable || busy} onClick={onDownload}>
          {busy ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
          Download
        </Button>
        <Button size="sm" variant="ghost" disabled={!usable || busy} onClick={onShortLink}>
          <Timer data-icon="inline-start" />
          Get a 5-second link
        </Button>
      </div>
    </div>
  )
}

/** Shows what a signed link is made of, and lets you try it as-is or tampered with. */
function LinkInspector({ link, onUsed }: { link: IssuedLink; onUsed: () => void }) {
  const url = new URL(link.url, 'http://lab.local')
  const sig = url.searchParams.get('sig') ?? ''
  // Flip the last character: still well-formed, but no longer what the server signed.
  const tamperedSig = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`
  const tamperedUrl = link.url.replace(`sig=${sig}`, `sig=${tamperedSig}`)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">The last link, taken apart</CardTitle>
        <CardDescription>
          Anyone holding this link can download {link.productName} until it expires. That's how S3
          presigned URLs work too.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <pre className="demo-code-block m-0 whitespace-pre-wrap break-all">{link.url}</pre>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-soft">Grant</dt>
          <dd className="amount m-0 break-all text-ink">{url.pathname.split('/').pop()}</dd>
          <dt className="text-ink-soft">exp</dt>
          <dd className="m-0 text-ink">
            <span className="amount">{url.searchParams.get('exp')}</span>, which is{' '}
            <LocalTime iso={link.expiresAt} />
            {link.short ? ' (5 seconds after it was made)' : ''}
          </dd>
          <dt className="text-ink-soft">sig</dt>
          <dd className="amount m-0 break-all text-ink">{sig}</dd>
        </dl>
        <p className="m-0 text-ink-soft">
          sig is an HMAC-SHA256 of the grant and exp, made with a secret only the server knows.
          Change either one and the signature no longer matches.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={link.url} target="_blank" rel="noreferrer" onClick={() => window.setTimeout(onUsed, 1500)}>
              Open this link
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={tamperedUrl} target="_blank" rel="noreferrer">
              Open it with a changed signature
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
