import * as Sentry from '@sentry/tanstackstart-react'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getOptionalUserId } from '#/lib/auth.server'
import { readLabSetup } from '#/lib/lab/setup.server'

/** Setup status for the hub page. Event IDs are only shown to signed-in users. */
export const getLabSetup = createServerFn({ method: 'GET' }).handler(async () => {
  return Sentry.startSpan({ name: 'getLabSetup' }, async () => {
    setResponseHeader('Cache-Control', 'no-store')
    const userId = await getOptionalUserId()
    return readLabSetup({ includeEvents: Boolean(userId) })
  })
})
