import { and, eq } from 'drizzle-orm'
import type Stripe from 'stripe'
import type { DbTransaction } from '#/db/index'
import { db } from '#/db/index'
import type { PayCheckoutSession, PayOrder } from '#/db/pay-schema'
import { payOrderItems, payOrders } from '#/db/pay-schema'
import type { LabModuleSlug } from '#/lib/lab/modules'
import type { LabCheckoutOptions } from '#/lib/stripe/checkout.server'
import { createLabCheckoutSession } from '#/lib/stripe/checkout.server'
import { getStripe } from '#/lib/stripe/client.server'

type StartOrderOptions = Omit<LabCheckoutOptions, 'refId' | 'idempotencyKey'> & {
  /**
   * Runs in the same transaction that creates the pending order, before Stripe
   * is called (the shop holds stock here). Throwing rolls back the order too.
   */
  reserve?: (tx: DbTransaction, orderId: string) => Promise<void>
  /** Undoes `reserve` if the Checkout Session can't be created. */
  release?: (orderId: string) => Promise<void>
}

/**
 * Starts a one-time purchase: a pending order first, then its Checkout Session.
 * Nothing is granted here. The webhook marks the order paid.
 */
export async function startOrderCheckout(
  options: StartOrderOptions,
): Promise<{ orderId: string; url: string }> {
  const { reserve, release, ...checkoutOptions } = options

  const order = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(payOrders)
      .values({ module: options.module, clerkUserId: options.clerkUserId })
      .returning({ id: payOrders.id })
    await reserve?.(tx, created.id)
    return created
  })

  try {
    const session = await createLabCheckoutSession({
      ...checkoutOptions,
      refId: order.id,
      idempotencyKey: `order:${order.id}`,
    })
    if (!session.url) {
      throw new Error('Stripe did not return a Checkout URL.')
    }

    await db
      .update(payOrders)
      .set({
        checkoutSessionId: session.id,
        currency: session.currency,
        amountTotal: session.amount_total,
        updatedAt: new Date(),
      })
      .where(eq(payOrders.id, order.id))

    return { orderId: order.id, url: session.url }
  } catch (error) {
    await release?.(order.id)
    await db
      .update(payOrders)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(payOrders.id, order.id))
    throw error
  }
}

/** An order from this module that belongs to this user. Throws otherwise, so seller actions stay scoped. */
export async function findOwnOrder(
  clerkUserId: string,
  module: LabModuleSlug,
  orderId: string,
): Promise<PayOrder> {
  const order = await db.query.payOrders.findFirst({
    where: and(
      eq(payOrders.id, orderId),
      eq(payOrders.clerkUserId, clerkUserId),
      eq(payOrders.module, module),
    ),
  })
  if (!order) {
    throw new Error('Order not found.')
  }
  return order
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }
  return typeof value === 'string' ? value : value.id
}

/**
 * Marks the order behind a Checkout Session as paid and copies its line items.
 * Returns null when the order was already processed, so callers fulfill exactly once.
 */
export async function markOrderPaid(
  tx: DbTransaction,
  session: Stripe.Checkout.Session,
  checkout: PayCheckoutSession,
): Promise<PayOrder | null> {
  if (!checkout.refId) {
    return null
  }

  const [order] = await tx
    .update(payOrders)
    .set({
      status: 'paid',
      paymentIntentId: idOf(session.payment_intent),
      currency: session.currency,
      amountSubtotal: session.amount_subtotal,
      amountDiscount: session.total_details?.amount_discount ?? 0,
      amountShipping: session.total_details?.amount_shipping ?? 0,
      amountTotal: session.amount_total,
      shipping: session.collected_information?.shipping_details
        ? {
            ...session.collected_information.shipping_details,
            phone: session.customer_details?.phone ?? null,
          }
        : null,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(payOrders.id, checkout.refId), eq(payOrders.status, 'pending')))
    .returning()

  if (!order) {
    return null
  }

  const lineItems = await getStripe().checkout.sessions.listLineItems(session.id, {
    limit: 100,
  })
  if (lineItems.data.length > 0) {
    await tx.insert(payOrderItems).values(
      lineItems.data.map((item) => ({
        orderId: order.id,
        stripePriceId: item.price?.id ?? null,
        lookupKey: item.price?.lookup_key ?? null,
        stripeProductId: idOf(item.price?.product),
        description: item.description ?? item.price?.nickname ?? 'Item',
        quantity: item.quantity ?? 1,
        unitAmount: item.price?.unit_amount ?? null,
        amountTotal: item.amount_total,
      })),
    )
  }

  return order
}

/** Moves a still-pending order to a final unpaid state. Returns null if it had already moved on. */
export async function closeUnpaidOrder(
  tx: DbTransaction,
  checkout: PayCheckoutSession,
  status: 'failed' | 'expired',
): Promise<PayOrder | null> {
  if (!checkout.refId) {
    return null
  }
  const [order] = await tx
    .update(payOrders)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(payOrders.id, checkout.refId), eq(payOrders.status, 'pending')))
    .returning()
  return order ?? null
}
