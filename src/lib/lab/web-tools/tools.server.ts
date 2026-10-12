import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import { payApiKeys, payCustomers, payEntitlements } from '#/db/pay-schema'
import { getStripe } from '#/lib/stripe/client.server'
import type { ToolFeatureKey } from './catalog'
import { cheapestPlanWith, findToolFeature, sampleImage } from './catalog'

/* ---------- entitlements ---------- */

/**
 * Re-reads a customer's active entitlements from Stripe and replaces the cache.
 * The webhook's summary can be truncated, so the full list is always fetched.
 */
export async function syncEntitlements(tx: DbTransaction, stripeCustomerId: string): Promise<void> {
  const owner = await tx.query.payCustomers.findFirst({
    where: eq(payCustomers.stripeCustomerId, stripeCustomerId),
  })
  if (!owner) {
    return
  }

  const lookupKeys: string[] = []
  for await (const entitlement of getStripe().entitlements.activeEntitlements.list({
    customer: stripeCustomerId,
    limit: 100,
  })) {
    lookupKeys.push(entitlement.lookup_key)
  }

  await tx.delete(payEntitlements).where(eq(payEntitlements.clerkUserId, owner.clerkUserId))
  if (lookupKeys.length > 0) {
    await tx.insert(payEntitlements).values(
      lookupKeys.map((featureLookupKey) => ({
        clerkUserId: owner.clerkUserId,
        featureLookupKey,
        stripeCustomerId,
      })),
    )
  }
}

/** The features the user is entitled to, from the cache. Fast enough to check on every request. */
export async function getEntitlements(clerkUserId: string): Promise<string[]> {
  const rows = await db
    .select({ key: payEntitlements.featureLookupKey })
    .from(payEntitlements)
    .where(eq(payEntitlements.clerkUserId, clerkUserId))
  return rows.map((row) => row.key)
}

export class EntitlementError extends Error {
  name = 'EntitlementError'
}

/**
 * The real gate. Hiding a button in the UI is a courtesy; this check on the
 * server is what actually keeps a feature to the plans that include it.
 */
export async function requireEntitlement(clerkUserId: string, feature: ToolFeatureKey): Promise<void> {
  const has = await db.query.payEntitlements.findFirst({
    where: and(eq(payEntitlements.clerkUserId, clerkUserId), eq(payEntitlements.featureLookupKey, feature)),
  })
  if (!has) {
    const name = findToolFeature(feature)?.name ?? feature
    const plan = cheapestPlanWith(feature)
    throw new EntitlementError(
      `${name} isn't in your plan${plan ? `. It's included in ${plan.name}` : ''}.`,
    )
  }
}

/* ---------- the tools ---------- */

/** A stand-in for real image processing: returns the photo with its background removed. */
export async function removeBackground(clerkUserId: string) {
  await requireEntitlement(clerkUserId, 'bg_remover')
  return { before: sampleImage.before, after: sampleImage.after, processedAt: new Date().toISOString() }
}

const sampleProjects = [
  { id: 'proj_01', name: 'Spring catalogue', images: 48, updated: '2026-09-02' },
  { id: 'proj_02', name: 'Mug product shots', images: 12, updated: '2026-09-18' },
  { id: 'proj_03', name: 'Team headshots', images: 9, updated: '2026-10-01' },
]

/** Every project as one CSV file. */
export async function exportProjectsCsv(clerkUserId: string): Promise<string> {
  await requireEntitlement(clerkUserId, 'bulk_export')
  const header = 'id,name,images,updated'
  const rows = sampleProjects.map((project) =>
    [project.id, `"${project.name}"`, project.images, project.updated].join(','),
  )
  return [header, ...rows].join('\n')
}

/* ---------- API keys ---------- */

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Creates a new key, replacing any old one. The key is returned once and only its hash is kept. */
export async function createApiKey(clerkUserId: string): Promise<string> {
  await requireEntitlement(clerkUserId, 'api_access')
  const key = `labtools_${randomBytes(24).toString('base64url')}`
  await db.transaction(async (tx) => {
    await tx.delete(payApiKeys).where(eq(payApiKeys.clerkUserId, clerkUserId))
    await tx.insert(payApiKeys).values({ clerkUserId, prefix: key.slice(0, 14), keyHash: hashKey(key) })
  })
  return key
}

export async function getApiKeyInfo(clerkUserId: string) {
  const row = await db.query.payApiKeys.findFirst({ where: eq(payApiKeys.clerkUserId, clerkUserId) })
  return row
    ? {
        prefix: row.prefix,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      }
    : null
}

export type ApiCallResult =
  | { status: 200; body: { projects: typeof sampleProjects } }
  | { status: 401 | 403; body: { error: string } }

/**
 * Handles one API call. The key identifies the user; the entitlement is checked
 * on every call, so downgrading the plan cuts off the API without revoking the key.
 */
export async function handleApiCall(authorization: string | null): Promise<ApiCallResult> {
  const key = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!key) {
    return { status: 401, body: { error: 'Send your API key as: Authorization: Bearer <key>' } }
  }
  const row = await db.query.payApiKeys.findFirst({ where: eq(payApiKeys.keyHash, hashKey(key)) })
  if (!row) {
    return { status: 401, body: { error: 'This API key is not valid.' } }
  }

  await db.update(payApiKeys).set({ lastUsedAt: new Date() }).where(eq(payApiKeys.id, row.id))
  try {
    await requireEntitlement(row.clerkUserId, 'api_access')
  } catch (error) {
    return { status: 403, body: { error: error instanceof Error ? error.message : 'Not allowed.' } }
  }
  return { status: 200, body: { projects: sampleProjects } }
}
