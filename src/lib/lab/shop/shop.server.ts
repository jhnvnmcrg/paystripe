import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import type { PayOrder, reservationStatuses, StoredShipping } from '#/db/pay-schema'
import {
  payCheckoutSessions,
  payOrderItems,
  payOrders,
  payReservations,
  payShipments,
  paySkus,
} from '#/db/pay-schema'
import { getStripe } from '#/lib/stripe/client.server'
import { findOwnOrder } from '#/lib/stripe/orders.server'
import type { Carrier } from './catalog'
import { findShopSku, shopShippingRates, shopSkus, skuLabel } from './catalog'

const MODULE = 'shop'

type ReservationStatus = (typeof reservationStatuses)[number]

/** Shown to the buyer as-is, so the message names the item and what's left. */
export class OutOfStockError extends Error {
  name = 'OutOfStockError'
}

/* ---------- stock ---------- */

/** Creates a stock row at its starting level for any SKU that doesn't have one yet. */
export async function ensureSkuRows(): Promise<void> {
  await db
    .insert(paySkus)
    .values(shopSkus.map((item) => ({ sku: item.sku, onHand: item.initialStock })))
    .onConflictDoNothing()
}

export interface CartLine {
  sku: string
  quantity: number
}

/**
 * Holds stock for a cart, inside the transaction that creates the order.
 * Each SKU is decremented only if enough is available, in one conditional
 * UPDATE, so two buyers can't both take the last unit.
 */
export async function holdStock(
  tx: DbTransaction,
  orderId: string,
  lines: CartLine[],
  expiresAt: Date,
): Promise<void> {
  // A fixed order, so two carts locking the same rows can't deadlock.
  const sorted = [...lines].sort((a, b) => a.sku.localeCompare(b.sku))

  for (const line of sorted) {
    const [held] = await tx
      .update(paySkus)
      .set({ reserved: sql`${paySkus.reserved} + ${line.quantity}`, updatedAt: new Date() })
      .where(
        and(
          eq(paySkus.sku, line.sku),
          sql`${paySkus.onHand} - ${paySkus.reserved} >= ${line.quantity}`,
        ),
      )
      .returning({ sku: paySkus.sku })

    if (!held) {
      const [row] = await tx.select().from(paySkus).where(eq(paySkus.sku, line.sku))
      const available = row ? row.onHand - row.reserved : 0
      const item = findShopSku(line.sku)
      const label = item ? skuLabel(item) : line.sku
      throw new OutOfStockError(
        available > 0 ? `Only ${available} of ${label} left.` : `${label} is sold out.`,
      )
    }
  }

  await tx.insert(payReservations).values(
    sorted.map((line) => ({ orderId, sku: line.sku, quantity: line.quantity, expiresAt })),
  )
}

/** Moves an order's reservations from one status to another and adjusts stock to match. */
async function moveReservations(
  tx: DbTransaction,
  orderId: string,
  from: ReservationStatus,
  to: ReservationStatus,
  adjust: { onHand: -1 | 0 | 1; reserved: -1 | 0 },
): Promise<number> {
  const moved = await tx
    .update(payReservations)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(payReservations.orderId, orderId), eq(payReservations.status, from)))
    .returning()

  for (const reservation of moved) {
    await tx
      .update(paySkus)
      .set({
        onHand: sql`${paySkus.onHand} + ${adjust.onHand * reservation.quantity}`,
        reserved: sql`${paySkus.reserved} + ${adjust.reserved * reservation.quantity}`,
        updatedAt: new Date(),
      })
      .where(eq(paySkus.sku, reservation.sku))
  }
  return moved.length
}

/** Payment confirmed: the held units are sold and leave the shelf. */
export function convertHeldStock(tx: DbTransaction, orderId: string) {
  return moveReservations(tx, orderId, 'held', 'converted', { onHand: -1, reserved: -1 })
}

/** Checkout expired or failed: the held units go back on sale. */
export function releaseHeldStock(tx: DbTransaction, orderId: string) {
  return moveReservations(tx, orderId, 'held', 'released', { onHand: 0, reserved: -1 })
}

/** After a refund, the seller puts sold units back on the shelf. */
export function restockSoldStock(tx: DbTransaction, orderId: string) {
  return moveReservations(tx, orderId, 'converted', 'restocked', { onHand: 1, reserved: 0 })
}

/**
 * Puts every SKU back to its starting stock, keeping units held by open checkouts.
 * The held count is recounted from the open holds themselves, so a count that
 * drifted (say, after deleting orders by hand) is corrected too.
 */
export async function resetStock(): Promise<void> {
  await ensureSkuRows()
  await db.transaction(async (tx) => {
    for (const item of shopSkus) {
      const [{ held }] = await tx
        .select({ held: sql<number>`coalesce(sum(${payReservations.quantity}), 0)::int` })
        .from(payReservations)
        .where(and(eq(payReservations.sku, item.sku), eq(payReservations.status, 'held')))
      await tx
        .update(paySkus)
        .set({ onHand: item.initialStock + held, reserved: held, updatedAt: new Date() })
        .where(eq(paySkus.sku, item.sku))
    }
  })
}

export interface InventoryRow {
  sku: string
  label: string
  onHand: number
  reserved: number
  available: number
}

export async function listInventory(): Promise<InventoryRow[]> {
  await ensureSkuRows()
  const rows = await db.select().from(paySkus)
  return shopSkus.map((item) => {
    const row = rows.find((candidate) => candidate.sku === item.sku)
    const onHand = row?.onHand ?? 0
    const reserved = row?.reserved ?? 0
    return { sku: item.sku, label: skuLabel(item), onHand, reserved, available: onHand - reserved }
  })
}

/* ---------- Stripe lookups ---------- */

/** The seeded shipping rates, found by their metadata key (rates can't have fixed IDs). */
export async function findShippingRateIds(): Promise<string[]> {
  const { data } = await getStripe().shippingRates.list({ active: true, limit: 100 })
  const ids = shopShippingRates.flatMap((spec) => {
    const rate = data.find((candidate) => candidate.metadata?.lab_key === spec.key)
    return rate ? [rate.id] : []
  })
  if (ids.length !== shopShippingRates.length) {
    throw new Error('Shipping rates are missing from your sandbox. Run npm run stripe:seed shop.')
  }
  return ids
}

/* ---------- fulfillment ---------- */

/**
 * Records the shipment, then copies the tracking number into the Payment
 * Intent's metadata so it's visible in the Dashboard. Stripe doesn't allow
 * editing `shipping` on a Payment Intent that Checkout created, so metadata it is.
 */
export async function markShipped(
  clerkUserId: string,
  orderId: string,
  carrier: Carrier,
  trackingNumber: string,
): Promise<void> {
  const order = await findOwnOrder(clerkUserId, MODULE, orderId)
  if (!['paid', 'partially_refunded'].includes(order.status) || order.fulfillmentStatus !== 'unfulfilled') {
    throw new Error('Only paid orders waiting to ship can be marked shipped.')
  }

  await db.transaction(async (tx) => {
    await tx.insert(payShipments).values({ orderId, carrier, trackingNumber })
    await tx
      .update(payOrders)
      .set({ fulfillmentStatus: 'shipped', updatedAt: new Date() })
      .where(eq(payOrders.id, orderId))
  })

  if (!order.paymentIntentId) {
    return
  }
  // Best effort: the shipment is already recorded, so a Stripe hiccup mustn't undo it.
  try {
    await getStripe().paymentIntents.update(order.paymentIntentId, {
      metadata: { lab_carrier: carrier, lab_tracking_number: trackingNumber },
    })
  } catch (error) {
    console.warn(`[shop] order ${orderId}: could not copy tracking to Stripe`, error)
  }
}

/* ---------- views ---------- */

export interface ShopOrderView {
  id: string
  status: PayOrder['status']
  fulfillmentStatus: string | null
  currency: string | null
  amountSubtotal: number | null
  amountShipping: number
  amountDiscount: number
  amountTotal: number | null
  amountRefunded: number
  createdAt: string
  items: Array<{ description: string; quantity: number; amountTotal: number }>
  shipping: StoredShipping | null
  shipment: { carrier: string; trackingNumber: string; shippedAt: string } | null
  holds: Array<{ label: string; quantity: number; status: ReservationStatus; expiresAt: string }>
  /** Sold units that a refund made eligible to go back on the shelf. */
  restockable: boolean
}

async function toOrderViews(orders: PayOrder[]): Promise<ShopOrderView[]> {
  if (orders.length === 0) {
    return []
  }
  const ids = orders.map((order) => order.id)
  const [items, reservations, shipments] = await Promise.all([
    db.select().from(payOrderItems).where(inArray(payOrderItems.orderId, ids)),
    db.select().from(payReservations).where(inArray(payReservations.orderId, ids)),
    db.select().from(payShipments).where(inArray(payShipments.orderId, ids)),
  ])

  return orders.map((order) => {
    const holds = reservations.filter((reservation) => reservation.orderId === order.id)
    const shipment = shipments.find((candidate) => candidate.orderId === order.id)
    const afterRefund = ['refunded', 'partially_refunded', 'dispute_lost'].includes(order.status)

    return {
      id: order.id,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      currency: order.currency,
      amountSubtotal: order.amountSubtotal,
      amountShipping: order.amountShipping,
      amountDiscount: order.amountDiscount,
      amountTotal: order.amountTotal,
      amountRefunded: order.amountRefunded,
      createdAt: order.createdAt.toISOString(),
      items: items
        .filter((item) => item.orderId === order.id)
        .map((item) => ({
          description: item.description,
          quantity: item.quantity,
          amountTotal: item.amountTotal,
        })),
      shipping: order.shipping,
      shipment: shipment
        ? {
            carrier: shipment.carrier,
            trackingNumber: shipment.trackingNumber,
            shippedAt: shipment.shippedAt.toISOString(),
          }
        : null,
      holds: holds.map((reservation) => {
        const item = findShopSku(reservation.sku)
        return {
          label: item ? skuLabel(item) : reservation.sku,
          quantity: reservation.quantity,
          status: reservation.status,
          expiresAt: reservation.expiresAt.toISOString(),
        }
      }),
      restockable: afterRefund && holds.some((reservation) => reservation.status === 'converted'),
    }
  })
}

/** The signed-in user's shop orders, newest first. */
export async function listShopOrders(clerkUserId: string): Promise<ShopOrderView[]> {
  const orders = await db
    .select()
    .from(payOrders)
    .where(and(eq(payOrders.clerkUserId, clerkUserId), eq(payOrders.module, MODULE)))
    .orderBy(desc(payOrders.createdAt))
    .limit(20)
  return toOrderViews(orders)
}

/** What the success page polls: the order behind a Checkout Session, if it belongs to this user. */
export async function getShopCheckoutResult(
  clerkUserId: string,
  sessionId: string,
): Promise<ShopOrderView | null> {
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
