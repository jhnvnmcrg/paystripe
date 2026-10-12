import { createFileRoute } from '@tanstack/react-router'
import { handleApiCall } from '#/lib/lab/web-tools/tools.server'

/*
 * The tools' public API: GET with "Authorization: Bearer <key>".
 * The key says who is calling; the api_access entitlement is checked on every call.
 */
export const Route = createFileRoute('/api/tools/v1/projects')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const result = await handleApiCall(request.headers.get('authorization'))
        return Response.json(result.body, {
          status: result.status,
          headers: { 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
