import { createFileRoute } from '@tanstack/react-router'
import { processStripeWebhook } from '#/lib/stripe/webhooks/index.server'

/*
 * Stripe posts events here. Locally, `npm run stripe:listen` forwards them.
 * No auth middleware on purpose: the Stripe signature is what proves the sender.
 */
export const Route = createFileRoute('/api/stripe/webhook')({
  server: {
    handlers: {
      POST: ({ request }) => processStripeWebhook(request),
    },
  },
})
