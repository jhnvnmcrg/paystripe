import { randomInt } from 'node:crypto'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import type { licenseStatuses, PayOrder } from '#/db/pay-schema'
import {
  payCheckoutSessions,
  payLicenseActivations,
  payLicenseKeys,
  payOrderItems,
  payOrders,
} from '#/db/pay-schema'
import { findLicenseProduct } from './catalog'

type LicenseStatus = (typeof licenseStatuses)[number]

/** No 0/O or 1/I, so keys survive being read aloud or typed from a screenshot. */
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateLicenseKey(): string {
  const group = () =>
    Array.from({ length: 4 }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join('')
  return [group(), group(), group(), group()].join('-')
}

export function normalizeLicenseKey(key: string): string {
  return key.trim().toUpperCase()
}

/**
 * Issues one key per license unit on a freshly paid order.
 * Runs inside the webhook transaction, right after markOrderPaid succeeded.
 */
export async function issueLicensesForOrder(
  tx: DbTransaction,
  orderId: string,
  clerkUserId: string,
): Promise<number> {
  const items = await tx.select().from(payOrderItems).where(eq(payOrderItems.orderId, orderId))

  const rows = items.flatMap((item) => {
    const product = item.lookupKey ? findLicenseProduct(item.lookupKey) : undefined
    if (!product) {
      console.warn(`[license-keys] order ${orderId}: no license product for ${item.lookupKey}`)
      return []
    }
    return Array.from({ length: item.quantity }, () => ({
      key: generateLicenseKey(),
      orderId,
      clerkUserId,
      lookupKey: product.lookupKey,
      productName: product.name,
      maxActivations: product.maxActivations,
    }))
  })

  if (rows.length > 0) {
    await tx.insert(payLicenseKeys).values(rows)
  }
  return rows.length
}

/** Changes the status of every key on an order, optionally only keys currently in `onlyFrom`. */
export async function setOrderLicenseStatus(
  tx: DbTransaction,
  orderId: string,
  status: LicenseStatus,
  reason: string | null,
  onlyFrom?: LicenseStatus[],
): Promise<void> {
  const where = onlyFrom
    ? and(eq(payLicenseKeys.orderId, orderId), inArray(payLicenseKeys.status, onlyFrom))
    : eq(payLicenseKeys.orderId, orderId)
  await tx
    .update(payLicenseKeys)
    .set({ status, statusReason: reason, updatedAt: new Date() })
    .where(where)
}

export type LicenseValidation =
  | {
      valid: true
      product: string
      newlyActivated: boolean
      activations: { used: number; max: number }
    }
  | {
      valid: false
      reason: 'not_found' | 'suspended' | 'revoked' | 'activation_limit'
      message: string
      activations?: { used: number; max: number }
    }

/**
 * What an app calls on launch: is this key good, and may this device use it?
 * The key's row is locked for the transaction, so two devices activating at
 * the same moment can't both squeeze past the limit.
 */
export async function validateAndActivate(
  rawKey: string,
  machineId: string,
): Promise<LicenseValidation> {
  const key = normalizeLicenseKey(rawKey)

  return db.transaction(async (tx) => {
    const [license] = await tx
      .select()
      .from(payLicenseKeys)
      .where(eq(payLicenseKeys.key, key))
      .for('update')

    if (!license) {
      return { valid: false, reason: 'not_found', message: 'No license has this key.' }
    }
    if (license.status !== 'active') {
      return {
        valid: false,
        reason: license.status,
        message:
          license.statusReason ??
          (license.status === 'revoked' ? 'This key was revoked.' : 'This key is suspended.'),
      }
    }

    const devices = await tx
      .select({ id: payLicenseActivations.id, machineId: payLicenseActivations.machineId })
      .from(payLicenseActivations)
      .where(eq(payLicenseActivations.licenseKeyId, license.id))

    const known = devices.find((device) => device.machineId === machineId)
    if (known) {
      await tx
        .update(payLicenseActivations)
        .set({ lastSeenAt: new Date() })
        .where(eq(payLicenseActivations.id, known.id))
      return {
        valid: true,
        product: license.productName,
        newlyActivated: false,
        activations: { used: devices.length, max: license.maxActivations },
      }
    }

    if (devices.length >= license.maxActivations) {
      return {
        valid: false,
        reason: 'activation_limit',
        message: `Already active on ${devices.length} of ${license.maxActivations} devices. Remove a device first.`,
        activations: { used: devices.length, max: license.maxActivations },
      }
    }

    await tx.insert(payLicenseActivations).values({ licenseKeyId: license.id, machineId })
    return {
      valid: true,
      product: license.productName,
      newlyActivated: true,
      activations: { used: devices.length + 1, max: license.maxActivations },
    }
  })
}

/** Frees every device slot on a key the user owns. */
export async function clearActivations(clerkUserId: string, licenseId: string): Promise<void> {
  const license = await db.query.payLicenseKeys.findFirst({
    where: and(eq(payLicenseKeys.id, licenseId), eq(payLicenseKeys.clerkUserId, clerkUserId)),
  })
  if (!license) {
    throw new Error('License not found.')
  }
  await db.delete(payLicenseActivations).where(eq(payLicenseActivations.licenseKeyId, license.id))
}

export interface LicenseView {
  id: string
  key: string
  productName: string
  status: LicenseStatus
  statusReason: string | null
  maxActivations: number
  activations: number
}

export interface LicenseOrderView {
  id: string
  status: PayOrder['status']
  currency: string | null
  amountTotal: number | null
  amountRefunded: number
  createdAt: string
  licenses: LicenseView[]
}

/** Attaches each order's keys and their device counts. */
async function toOrderViews(orders: PayOrder[]): Promise<LicenseOrderView[]> {
  if (orders.length === 0) {
    return []
  }

  const orderIds = orders.map((order) => order.id)
  const keys = await db
    .select()
    .from(payLicenseKeys)
    .where(inArray(payLicenseKeys.orderId, orderIds))
    .orderBy(payLicenseKeys.createdAt)

  const counts = keys.length
    ? await db
        .select({ licenseKeyId: payLicenseActivations.licenseKeyId, used: count() })
        .from(payLicenseActivations)
        .where(
          inArray(
            payLicenseActivations.licenseKeyId,
            keys.map((key) => key.id),
          ),
        )
        .groupBy(payLicenseActivations.licenseKeyId)
    : []
  const usedByKey = new Map(counts.map((row) => [row.licenseKeyId, row.used]))

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    currency: order.currency,
    amountTotal: order.amountTotal,
    amountRefunded: order.amountRefunded,
    createdAt: order.createdAt.toISOString(),
    licenses: keys
      .filter((key) => key.orderId === order.id)
      .map((key) => ({
        id: key.id,
        key: key.key,
        productName: key.productName,
        status: key.status,
        statusReason: key.statusReason,
        maxActivations: key.maxActivations,
        activations: usedByKey.get(key.id) ?? 0,
      })),
  }))
}

/** The signed-in user's license orders, newest first, with their keys. */
export async function listLicenseOrders(clerkUserId: string): Promise<LicenseOrderView[]> {
  const orders = await db
    .select()
    .from(payOrders)
    .where(and(eq(payOrders.clerkUserId, clerkUserId), eq(payOrders.module, 'license-keys')))
    .orderBy(desc(payOrders.createdAt))
    .limit(20)
  return toOrderViews(orders)
}

/** What the success page polls: the order behind a Checkout Session, if it belongs to this user. */
export async function getLicenseCheckoutResult(
  clerkUserId: string,
  sessionId: string,
): Promise<LicenseOrderView | null> {
  const checkout = await db.query.payCheckoutSessions.findFirst({
    where: and(
      eq(payCheckoutSessions.sessionId, sessionId),
      eq(payCheckoutSessions.clerkUserId, clerkUserId),
      eq(payCheckoutSessions.module, 'license-keys'),
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
