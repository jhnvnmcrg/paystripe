import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import type { downloadGrantStatuses, PayOrder } from '#/db/pay-schema'
import {
  payCheckoutSessions,
  payDownloadGrants,
  payOrderItems,
  payOrders,
} from '#/db/pay-schema'
import { StripeLabConfigError } from '#/lib/stripe/client.server'
import {
  findDigitalAsset,
  findDigitalAssetByLookupKey,
  LINK_TTL_SECONDS,
  MAX_DOWNLOADS,
} from './catalog'

type GrantStatus = (typeof downloadGrantStatuses)[number]

const MODULE = 'downloads'
const ASSET_DIR = join(process.cwd(), 'private-assets', 'downloads')

/* ---------- grants (written by the webhook) ---------- */

/** One grant per asset on a freshly paid order. Runs inside the webhook transaction. */
export async function grantDownloadsForOrder(
  tx: DbTransaction,
  orderId: string,
  clerkUserId: string,
): Promise<number> {
  const items = await tx.select().from(payOrderItems).where(eq(payOrderItems.orderId, orderId))

  const rows = items.flatMap((item) => {
    const asset = item.lookupKey ? findDigitalAssetByLookupKey(item.lookupKey) : undefined
    if (!asset) {
      console.warn(`[downloads] order ${orderId}: no asset for ${item.lookupKey}`)
      return []
    }
    return [
      {
        orderId,
        clerkUserId,
        assetId: asset.id,
        productName: asset.name,
        fileName: asset.fileName,
        maxDownloads: MAX_DOWNLOADS,
      },
    ]
  })

  if (rows.length > 0) {
    await tx.insert(payDownloadGrants).values(rows).onConflictDoNothing()
  }
  return rows.length
}

/** Changes every grant on an order, optionally only grants currently in `onlyFrom`. */
export async function setOrderGrantStatus(
  tx: DbTransaction,
  orderId: string,
  status: GrantStatus,
  reason: string | null,
  onlyFrom?: GrantStatus[],
): Promise<void> {
  const where = onlyFrom
    ? and(eq(payDownloadGrants.orderId, orderId), inArray(payDownloadGrants.status, onlyFrom))
    : eq(payDownloadGrants.orderId, orderId)
  await tx
    .update(payDownloadGrants)
    .set({ status, statusReason: reason, updatedAt: new Date() })
    .where(where)
}

/* ---------- signed links ---------- */

function signingSecret(): string {
  const secret = process.env.DOWNLOAD_SIGNING_SECRET
  if (!secret || secret.length < 32) {
    throw new StripeLabConfigError(
      'DOWNLOAD_SIGNING_SECRET is missing or shorter than 32 characters. Add a long random value to .env.local.',
    )
  }
  return secret
}

export function isSigningReady(): boolean {
  const secret = process.env.DOWNLOAD_SIGNING_SECRET
  return Boolean(secret && secret.length >= 32)
}

function signature(grantId: string, expiresAt: number): string {
  return createHmac('sha256', signingSecret()).update(`${grantId}.${expiresAt}`).digest('base64url')
}

/**
 * A link anyone holding it can use until it expires, like an S3 presigned URL.
 * The signature covers the grant ID and the expiry, so neither can be edited.
 */
export function signDownloadLink(grantId: string, ttlSeconds = LINK_TTL_SECONDS) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  const sig = signature(grantId, expiresAt)
  return {
    url: `/api/downloads/${grantId}?exp=${expiresAt}&sig=${sig}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  }
}

export type LinkCheck = 'ok' | 'invalid' | 'expired'

/** Checks the signature first, then the expiry, so an edited `exp` is reported as invalid. */
export function verifyDownloadLink(grantId: string, exp: string | null, sig: string | null): LinkCheck {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) {
    return 'invalid'
  }
  const expected = Buffer.from(signature(grantId, Number(exp)))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'invalid'
  }
  return Number(exp) < Math.floor(Date.now() / 1000) ? 'expired' : 'ok'
}

/* ---------- downloading ---------- */

export type DownloadAttempt =
  | { ok: true; fileName: string; contentType: string; body: Buffer }
  | { ok: false; status: 403 | 404 | 410; message: string }

/**
 * Counts one download and returns the file. The grant's row is locked, so two
 * clicks at once can't both take the last download.
 */
export async function consumeDownload(grantId: string): Promise<DownloadAttempt> {
  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(payDownloadGrants)
      .where(eq(payDownloadGrants.id, grantId))
      .for('update')

    if (!grant) {
      return { ok: false, status: 404, message: 'This download does not exist.' }
    }
    if (grant.status !== 'active') {
      return {
        ok: false,
        status: 403,
        message: grant.statusReason ?? 'This download is no longer available.',
      }
    }
    if (grant.downloadsUsed >= grant.maxDownloads) {
      return {
        ok: false,
        status: 410,
        message: `All ${grant.maxDownloads} downloads have been used.`,
      }
    }

    const asset = findDigitalAsset(grant.assetId)
    if (!asset) {
      return { ok: false, status: 404, message: 'This file is no longer offered.' }
    }
    // Read before counting, so a missing file doesn't use up a download.
    const body = await readFile(join(ASSET_DIR, asset.fileName))

    await tx
      .update(payDownloadGrants)
      .set({
        downloadsUsed: grant.downloadsUsed + 1,
        lastDownloadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payDownloadGrants.id, grant.id))

    return { ok: true, fileName: asset.fileName, contentType: asset.contentType, body }
  })
}

/** A fresh signed link for a grant the user owns, if it can still be downloaded. */
export async function issueDownloadLink(clerkUserId: string, grantId: string, ttlSeconds?: number) {
  const grant = await db.query.payDownloadGrants.findFirst({
    where: and(eq(payDownloadGrants.id, grantId), eq(payDownloadGrants.clerkUserId, clerkUserId)),
  })
  if (!grant) {
    throw new Error('Download not found.')
  }
  if (grant.status !== 'active') {
    throw new Error(grant.statusReason ?? 'This download is no longer available.')
  }
  if (grant.downloadsUsed >= grant.maxDownloads) {
    throw new Error(`All ${grant.maxDownloads} downloads have been used.`)
  }
  return signDownloadLink(grant.id, ttlSeconds)
}

/* ---------- views for the pages ---------- */

export interface DownloadGrantView {
  id: string
  productName: string
  fileName: string
  status: GrantStatus
  statusReason: string | null
  downloadsUsed: number
  maxDownloads: number
}

export interface DownloadOrderView {
  id: string
  status: PayOrder['status']
  currency: string | null
  amountSubtotal: number | null
  amountDiscount: number
  amountTotal: number | null
  amountRefunded: number
  createdAt: string
  grants: DownloadGrantView[]
}

async function toOrderViews(orders: PayOrder[]): Promise<DownloadOrderView[]> {
  if (orders.length === 0) {
    return []
  }
  const grants = await db
    .select()
    .from(payDownloadGrants)
    .where(
      inArray(
        payDownloadGrants.orderId,
        orders.map((order) => order.id),
      ),
    )
    .orderBy(payDownloadGrants.createdAt)

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    currency: order.currency,
    amountSubtotal: order.amountSubtotal,
    amountDiscount: order.amountDiscount,
    amountTotal: order.amountTotal,
    amountRefunded: order.amountRefunded,
    createdAt: order.createdAt.toISOString(),
    grants: grants
      .filter((grant) => grant.orderId === order.id)
      .map((grant) => ({
        id: grant.id,
        productName: grant.productName,
        fileName: grant.fileName,
        status: grant.status,
        statusReason: grant.statusReason,
        downloadsUsed: grant.downloadsUsed,
        maxDownloads: grant.maxDownloads,
      })),
  }))
}

/** The signed-in user's download orders, newest first. */
export async function listDownloadOrders(clerkUserId: string): Promise<DownloadOrderView[]> {
  const orders = await db
    .select()
    .from(payOrders)
    .where(and(eq(payOrders.clerkUserId, clerkUserId), eq(payOrders.module, MODULE)))
    .orderBy(desc(payOrders.createdAt))
    .limit(20)
  return toOrderViews(orders)
}

/** What the success page polls: the order behind a Checkout Session, if it belongs to this user. */
export async function getDownloadCheckoutResult(
  clerkUserId: string,
  sessionId: string,
): Promise<DownloadOrderView | null> {
  const checkout = await db.query.payCheckoutSessions.findFirst({
    where: and(
      eq(payCheckoutSessions.sessionId, sessionId),
      eq(payCheckoutSessions.clerkUserId, clerkUserId),
      eq(payCheckoutSessions.module, MODULE),
    ),
  })
  if (!checkout?.refId) {
    return null
  }
  const orders = await db
    .select()
    .from(payOrders)
    .where(and(eq(payOrders.id, checkout.refId), eq(payOrders.clerkUserId, clerkUserId)))
  const [view] = await toOrderViews(orders)
  return view ?? null
}
