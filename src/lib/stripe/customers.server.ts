import { eq } from 'drizzle-orm'
import { db } from '#/db/index'
import { payCustomers } from '#/db/pay-schema'
import { getUserEmail } from '#/lib/auth.server'
import { getStripe } from '#/lib/stripe/client.server'

/**
 * The Stripe Customer for a Clerk user, created on first use.
 * The idempotency key is derived from the user ID, so two concurrent first
 * purchases still produce one Customer.
 */
export async function getOrCreateStripeCustomer(clerkUserId: string): Promise<string> {
  const existing = await db.query.payCustomers.findFirst({
    where: eq(payCustomers.clerkUserId, clerkUserId),
  })
  if (existing) {
    return existing.stripeCustomerId
  }

  const email = await getUserEmail(clerkUserId)
  const customer = await getStripe().customers.create(
    { email, metadata: { clerk_user_id: clerkUserId } },
    { idempotencyKey: `cust:${clerkUserId}` },
  )

  await db
    .insert(payCustomers)
    .values({ clerkUserId, stripeCustomerId: customer.id, email })
    .onConflictDoNothing()

  return customer.id
}

/** The Clerk user that owns a Stripe Customer, if it's one of ours. */
export async function findUserByStripeCustomer(
  stripeCustomerId: string,
): Promise<string | null> {
  const row = await db.query.payCustomers.findFirst({
    where: eq(payCustomers.stripeCustomerId, stripeCustomerId),
  })
  return row?.clerkUserId ?? null
}
