import Stripe from 'stripe'

/*
 * No framework imports in this file: the tsx seed script imports it too.
 * Keys are read on first use, never at module load.
 */

export class StripeLabConfigError extends Error {
  name = 'StripeLabConfigError'
}

let client: Stripe | undefined

/** The lab's Stripe client. It refuses live keys, so it can only reach a sandbox. */
export function getStripe(): Stripe {
  if (client) {
    return client
  }

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new StripeLabConfigError(
      'STRIPE_SECRET_KEY is not set. Add your sandbox restricted key (rk_test_…) to .env.local and restart the dev server.',
    )
  }
  if (/^[rs]k_live_/.test(key)) {
    throw new StripeLabConfigError(
      'STRIPE_SECRET_KEY is a live key. Stripe Lab only runs against a sandbox, so use an rk_test_ key.',
    )
  }
  if (!/^[rs]k_test_/.test(key)) {
    throw new StripeLabConfigError(
      'STRIPE_SECRET_KEY should start with rk_test_ (a restricted sandbox key).',
    )
  }

  // The SDK pins its own API version (2026-09-30.endive for stripe@23); don't override it.
  client = new Stripe(key, { appInfo: { name: 'paystripe-stripe-lab' } })
  return client
}

/** The signing secret printed by `stripe listen`, used to verify webhook events. */
export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new StripeLabConfigError(
      'STRIPE_WEBHOOK_SECRET is not set. Run `npm run stripe:listen` and copy the whsec_… value into .env.local.',
    )
  }
  return secret
}

/** True when the key is a restricted key (rk_), which is what the lab recommends. */
export function isRestrictedKey(): boolean {
  return process.env.STRIPE_SECRET_KEY?.startsWith('rk_') ?? false
}
