import { count, desc } from 'drizzle-orm'
import Stripe from 'stripe'
import { db } from '#/db/index'
import { payStripeEvents } from '#/db/pay-schema'
import { getStripe, isRestrictedKey, StripeLabConfigError } from '#/lib/stripe/client.server'

export type SetupCheckState = 'ok' | 'warn' | 'missing'

export interface SetupCheck {
  id: 'key' | 'webhook-secret' | 'database' | 'events'
  label: string
  state: SetupCheckState
  detail: string
}

export interface RecentEvent {
  id: string
  type: string
  receivedAt: string
}

export interface LabSetupStatus {
  checks: SetupCheck[]
  recentEvents: RecentEvent[]
}

async function checkKey(): Promise<SetupCheck> {
  const base = { id: 'key', label: 'Sandbox API key' } as const
  try {
    // Cheapest call the lab's key must be allowed to make anyway.
    await getStripe().customers.list({ limit: 1 })
  } catch (error) {
    if (error instanceof StripeLabConfigError) {
      return { ...base, state: 'missing', detail: error.message }
    }
    if (error instanceof Stripe.errors.StripeAuthenticationError) {
      return {
        ...base,
        state: 'missing',
        detail: 'Stripe rejected STRIPE_SECRET_KEY. Check it was copied in full from the sandbox.',
      }
    }
    if (error instanceof Stripe.errors.StripePermissionError) {
      return {
        ...base,
        state: 'missing',
        detail: 'The key works but cannot read Customers. Give the restricted key Customers: Write.',
      }
    }
    return {
      ...base,
      state: 'missing',
      detail: 'Could not reach Stripe. Check your connection and try again.',
    }
  }

  if (!isRestrictedKey()) {
    return {
      ...base,
      state: 'warn',
      detail: 'Connected with a full secret key. A restricted key (rk_test_…) limits the damage if it leaks.',
    }
  }
  return { ...base, state: 'ok', detail: 'Connected to your sandbox with a restricted key.' }
}

function checkWebhookSecret(): SetupCheck {
  const base = { id: 'webhook-secret', label: 'Webhook signing secret' } as const
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return {
      ...base,
      state: 'missing',
      detail: 'Run npm run stripe:listen and copy the whsec_… value into STRIPE_WEBHOOK_SECRET.',
    }
  }
  if (!secret.startsWith('whsec_')) {
    return { ...base, state: 'warn', detail: 'STRIPE_WEBHOOK_SECRET should start with whsec_.' }
  }
  return { ...base, state: 'ok', detail: 'Set. Incoming events are verified against it.' }
}

function minutesAgo(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

export async function readLabSetup({
  includeEvents,
}: {
  includeEvents: boolean
}): Promise<LabSetupStatus> {
  const checks: SetupCheck[] = [await checkKey(), checkWebhookSecret()]
  let recentEvents: RecentEvent[] = []

  try {
    const [{ total }] = await db.select({ total: count() }).from(payStripeEvents)
    checks.push({
      id: 'database',
      label: 'Lab tables',
      state: 'ok',
      detail: 'The pay_* tables exist in Postgres.',
    })

    const latest = await db
      .select()
      .from(payStripeEvents)
      .orderBy(desc(payStripeEvents.receivedAt))
      .limit(5)

    checks.push(
      latest[0]
        ? {
            id: 'events',
            label: 'Webhook events',
            state: 'ok',
            detail: `${total} received. Last: ${latest[0].type}, ${minutesAgo(latest[0].receivedAt)}.`,
          }
        : {
            id: 'events',
            label: 'Webhook events',
            state: 'missing',
            detail: 'None yet. With npm run stripe:listen running, try: stripe trigger payment_intent.succeeded',
          },
    )

    if (includeEvents) {
      recentEvents = latest.map((event) => ({
        id: event.id,
        type: event.type,
        receivedAt: event.receivedAt.toISOString(),
      }))
    }
  } catch {
    checks.push({
      id: 'database',
      label: 'Lab tables',
      state: 'missing',
      detail: 'The pay_* tables are missing. Run npm run db:pay:migrate.',
    })
  }

  return { checks, recentEvents }
}
