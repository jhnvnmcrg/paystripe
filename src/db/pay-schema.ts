import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/*
 * Stripe Lab tables. Every table is prefixed `pay_` and migrated with its own
 * drizzle config (drizzle.pay.config.ts), so the starter's demo tables are never touched.
 */

/** One Stripe Customer per Clerk user. */
export const payCustomers = pgTable('pay_customers', {
  clerkUserId: text('clerk_user_id').primaryKey(),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Every verified webhook event, recorded once. A repeat delivery is skipped. */
export const payStripeEvents = pgTable('pay_stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  livemode: boolean('livemode').notNull(),
  stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Which lab module created a Checkout Session, so its webhook events reach the right handler. */
export const payCheckoutSessions = pgTable('pay_checkout_sessions', {
  sessionId: text('session_id').primaryKey(),
  module: text('module').notNull(),
  clerkUserId: text('clerk_user_id').notNull(),
  /** The module's own record for this checkout, such as an order ID. */
  refId: text('ref_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const orderStatuses = [
  'pending',
  'paid',
  'failed',
  'expired',
  'partially_refunded',
  'refunded',
  'disputed',
] as const

/** One-time purchases (license keys, downloads, physical goods, marketplace). */
export const payOrders = pgTable(
  'pay_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    module: text('module').notNull(),
    clerkUserId: text('clerk_user_id').notNull(),
    checkoutSessionId: text('checkout_session_id').unique(),
    paymentIntentId: text('payment_intent_id').unique(),
    status: text('status', { enum: orderStatuses }).notNull().default('pending'),
    currency: text('currency'),
    amountSubtotal: integer('amount_subtotal'),
    amountDiscount: integer('amount_discount').notNull().default(0),
    amountShipping: integer('amount_shipping').notNull().default(0),
    amountTotal: integer('amount_total'),
    amountRefunded: integer('amount_refunded').notNull().default(0),
    applicationFeeAmount: integer('application_fee_amount'),
    shipping: jsonb('shipping'),
    /** Module-defined, for example `unfulfilled` or `shipped`. */
    fulfillmentStatus: text('fulfillment_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('pay_orders_user_module_idx').on(table.clerkUserId, table.module)],
)

/** Line items copied from the Checkout Session when an order is paid. */
export const payOrderItems = pgTable('pay_order_items', {
  id: serial('id').primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => payOrders.id, { onDelete: 'cascade' }),
  stripePriceId: text('stripe_price_id'),
  lookupKey: text('lookup_key'),
  stripeProductId: text('stripe_product_id'),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitAmount: integer('unit_amount'),
  amountTotal: integer('amount_total').notNull(),
})

export type PayOrder = typeof payOrders.$inferSelect
export type PayCheckoutSession = typeof payCheckoutSessions.$inferSelect
