import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { validateAndActivate } from '#/lib/lab/license-keys/licenses.server'

const bodySchema = z.object({
  key: z.string().trim().min(1).max(64),
  machineId: z.string().trim().min(1).max(128),
})

const noStore = { 'Cache-Control': 'no-store' }

/*
 * What a desktop app calls on launch: POST { key, machineId }.
 * Public on purpose, like a real license server. In production, rate-limit it
 * so keys can't be guessed.
 */
export const Route = createFileRoute('/api/license/validate')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown
        try {
          body = await request.json()
        } catch {
          body = null
        }

        const parsed = bodySchema.safeParse(body)
        if (!parsed.success) {
          return Response.json(
            {
              valid: false,
              reason: 'bad_request',
              message: 'Send JSON like { "key": "ABCD-…", "machineId": "my-laptop" }.',
            },
            { status: 400, headers: noStore },
          )
        }

        const result = await validateAndActivate(parsed.data.key, parsed.data.machineId)
        const status = !result.valid && result.reason === 'not_found' ? 404 : 200
        return Response.json(result, { status, headers: noStore })
      },
    },
  },
})
