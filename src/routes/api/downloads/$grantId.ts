import { createFileRoute } from '@tanstack/react-router'
import { consumeDownload, verifyDownloadLink } from '#/lib/lab/downloads/downloads.server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function refuse(status: number, message: string) {
  return new Response(`${message}\n`, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/*
 * The signed download link. No sign-in needed: the signature is the permission,
 * like an S3 presigned URL. It covers the grant ID and expiry, so neither can be edited.
 */
export const Route = createFileRoute('/api/downloads/$grantId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!UUID.test(params.grantId)) {
          return refuse(404, 'This download does not exist.')
        }

        const url = new URL(request.url)
        const check = verifyDownloadLink(
          params.grantId,
          url.searchParams.get('exp'),
          url.searchParams.get('sig'),
        )
        if (check === 'invalid') {
          return refuse(403, 'This download link is not valid.')
        }
        if (check === 'expired') {
          return refuse(410, 'This download link has expired. Get a new one from your library.')
        }

        const attempt = await consumeDownload(params.grantId)
        if (!attempt.ok) {
          return refuse(attempt.status, attempt.message)
        }

        return new Response(new Uint8Array(attempt.body), {
          headers: {
            'Content-Type': attempt.contentType,
            'Content-Disposition': `attachment; filename="${attempt.fileName}"`,
            'Content-Length': String(attempt.body.length),
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
