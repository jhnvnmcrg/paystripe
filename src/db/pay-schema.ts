import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
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

/** The shipping address collected by Checkout, as stored on an order. */
export interface StoredShipping {
  name: string
  address: {
    line1: string | null
    line2: string | null
    city: string | null
    state: string | null
    postal_code: string | null
    country: string | null
  }
  phone?: string | null
  /** The shipping rate the buyer chose, added by the shop's webhook. */
  method?: string | null
}

export const orderStatuses = [
  'pending',
  'paid',
  'failed',
  'expired',
  'partially_refunded',
  'refunded',
  'disputed',
  'dispute_lost',
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
    shipping: jsonb('shipping').$type<StoredShipping>(),
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

/* Step 1: one-time purchases and license keys */

export const licenseStatuses = ['active', 'suspended', 'revoked'] as const

/** One key per unit bought. Issued by the webhook, never by the success page. */
export const payLicenseKeys = pgTable(
  'pay_license_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => payOrders.id, { onDelete: 'cascade' }),
    clerkUserId: text('clerk_user_id').notNull(),
    /** The price lookup key, which maps to the product's settings in the catalog. */
    lookupKey: text('lookup_key').notNull(),
    productName: text('product_name').notNull(),
    maxActivations: integer('max_activations').notNull(),
    status: text('status', { enum: licenseStatuses }).notNull().default('active'),
    /** Why the status last changed, shown to the buyer. */
    statusReason: text('status_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('pay_license_keys_user_idx').on(table.clerkUserId)],
)

/** Devices that have activated a key. The validate API enforces `maxActivations`. */
export const payLicenseActivations = pgTable(
  'pay_license_activations',
  {
    id: serial('id').primaryKey(),
    licenseKeyId: uuid('license_key_id')
      .notNull()
      .references(() => payLicenseKeys.id, { onDelete: 'cascade' }),
    machineId: text('machine_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pay_license_activations_key_machine_idx').on(
      table.licenseKeyId,
      table.machineId,
    ),
  ],
)

export type PayLicenseKey = typeof payLicenseKeys.$inferSelect

/* Step 2: digital downloads */

export const downloadGrantStatuses = ['active', 'suspended', 'revoked'] as const

/**
 * The right to download one asset from a paid order, a limited number of times.
 * Created by the webhook. Download links are signed separately and expire.
 */
export const payDownloadGrants = pgTable(
  'pay_download_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => payOrders.id, { onDelete: 'cascade' }),
    clerkUserId: text('clerk_user_id').notNull(),
    /** The asset's ID in the downloads catalog, which maps to the file on disk. */
    assetId: text('asset_id').notNull(),
    productName: text('product_name').notNull(),
    fileName: text('file_name').notNull(),
    maxDownloads: integer('max_downloads').notNull(),
    downloadsUsed: integer('downloads_used').notNull().default(0),
    status: text('status', { enum: downloadGrantStatuses }).notNull().default('active'),
    statusReason: text('status_reason'),
    lastDownloadedAt: timestamp('last_downloaded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pay_download_grants_user_idx').on(table.clerkUserId),
    uniqueIndex('pay_download_grants_order_asset_idx').on(table.orderId, table.assetId),
  ],
)

export type PayDownloadGrant = typeof payDownloadGrants.$inferSelect

/* Step 3: physical goods with inventory */

/**
 * Stock per SKU. `onHand` counts every unit on the shelf, including units held
 * by open checkouts; `reserved` is that held part. Available = onHand - reserved.
 */
export const paySkus = pgTable(
  'pay_skus',
  {
    sku: text('sku').primaryKey(),
    onHand: integer('on_hand').notNull(),
    reserved: integer('reserved').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The database refuses to oversell, even if application code gets it wrong.
    check('pay_skus_stock_ok', sql`${table.reserved} >= 0 AND ${table.reserved} <= ${table.onHand}`),
  ],
)

export const reservationStatuses = ['held', 'converted', 'released', 'restocked'] as const

/**
 * Units an order holds while its buyer is on Stripe's page. Converted into a
 * sale when the webhook confirms payment, released when checkout expires or fails.
 */
export const payReservations = pgTable(
  'pay_reservations',
  {
    id: serial('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => payOrders.id, { onDelete: 'cascade' }),
    sku: text('sku')
      .notNull()
      .references(() => paySkus.sku),
    quantity: integer('quantity').notNull(),
    status: text('status', { enum: reservationStatuses }).notNull().default('held'),
    /** When the hold lapses: the Checkout Session's expires_at. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('pay_reservations_order_sku_idx').on(table.orderId, table.sku)],
)

/* Step 4 onward: subscriptions */

/** One line of a subscription, as last synced from Stripe. */
export interface StoredSubscriptionItem {
  id: string
  priceId: string
  lookupKey: string | null
  productId: string
  productName: string
  quantity: number
  unitAmount: number | null
  interval: string | null
}

/**
 * A local copy of a Stripe subscription, rewritten from a fresh fetch on every
 * subscription or invoice event, so its state is never older than the latest event.
 */
export const paySubscriptions = pgTable(
  'pay_subscriptions',
  {
    /** The Stripe subscription ID (sub_…). */
    id: text('id').primaryKey(),
    module: text('module').notNull(),
    clerkUserId: text('clerk_user_id').notNull(),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    /** Stripe's status: trialing, active, past_due, canceled, unpaid, incomplete, … */
    status: text('status').notNull(),
    /** The first item's price lookup key: the plan. */
    priceLookupKey: text('price_lookup_key'),
    items: jsonb('items').$type<StoredSubscriptionItem[]>().notNull(),
    currency: text('currency').notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelAt: timestamp('cancel_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    trialEnd: timestamp('trial_end', { withTimezone: true }),
    /** Set when the subscription lives on a test clock (a time-travel run), not the user's real customer. */
    testClockRunId: uuid('test_clock_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('pay_subscriptions_user_module_idx').on(table.clerkUserId, table.module)],
)

export type PaySubscription = typeof paySubscriptions.$inferSelect

/**
 * A time-travel sandbox: a Stripe test clock with its own customer, so renewals
 * can be fast-forwarded without touching the user's real customer.
 */
export const payTestClockRuns = pgTable(
  'pay_test_clock_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clerkUserId: text('clerk_user_id').notNull(),
    module: text('module').notNull(),
    testClockId: text('test_clock_id').notNull().unique(),
    stripeCustomerId: text('stripe_customer_id').notNull().unique(),
    subscriptionId: text('subscription_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('pay_test_clock_runs_user_module_idx').on(table.clerkUserId, table.module)],
)

export type PayTestClockRun = typeof payTestClockRuns.$inferSelect

/* Step 5: subscription-gated web tools */

/**
 * The features a user's Stripe Customer is entitled to right now, cached from
 * Stripe's Entitlements API. Rewritten whenever Stripe reports a change.
 */
export const payEntitlements = pgTable(
  'pay_entitlements',
  {
    clerkUserId: text('clerk_user_id').notNull(),
    /** The Stripe feature's lookup key, such as `bulk_export`. */
    featureLookupKey: text('feature_lookup_key').notNull(),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.clerkUserId, table.featureLookupKey] })],
)

/** API keys for the tools' API. Only a hash is stored; the key itself is shown once. */
export const payApiKeys = pgTable('pay_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  /** The first characters, so the user can recognise the key later. */
  prefix: text('prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
})

/** Tracking details once a paid order has been handed to a carrier. */
export const payShipments = pgTable('pay_shipments', {
  orderId: uuid('order_id')
    .primaryKey()
    .references(() => payOrders.id, { onDelete: 'cascade' }),
  carrier: text('carrier').notNull(),
  trackingNumber: text('tracking_number').notNull(),
  shippedAt: timestamp('shipped_at', { withTimezone: true }).notNull().defaultNow(),
})
