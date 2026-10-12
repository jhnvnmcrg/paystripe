import type Stripe from 'stripe'
import { getStripe } from '../../src/lib/stripe/client.server.ts'

/*
 * Idempotent catalog helpers. Products get fixed IDs and prices get lookup keys,
 * so running the seed twice changes nothing and app code never pastes price IDs.
 */

export interface ProductSpec {
  /** A fixed, readable ID such as `lab_license_pro`. */
  id: string
  name: string
  description?: string
  metadata?: Record<string, string>
}

export interface PriceSpec {
  lookupKey: string
  product: ProductSpec
  nickname?: string
  currency?: string
  unitAmount?: number
  recurring?: Stripe.PriceCreateParams.Recurring
  /** Anything else Stripe accepts on price creation (tiers, custom_unit_amount, ...). */
  extra?: Omit<Stripe.PriceCreateParams, 'product' | 'currency' | 'lookup_key'>
}

function isMissingResource(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && error.code === 'resource_missing'
  )
}

/** Creates the product, or brings an existing one back in line with the spec. */
export async function ensureProduct(spec: ProductSpec): Promise<Stripe.Product> {
  const stripe = getStripe()
  try {
    const existing = await stripe.products.retrieve(spec.id)
    const drifted =
      !existing.active ||
      existing.name !== spec.name ||
      (existing.description ?? undefined) !== spec.description
    if (!drifted) {
      return existing
    }
    console.log(`  updated product ${spec.id}`)
    return stripe.products.update(spec.id, {
      name: spec.name,
      description: spec.description ?? '',
      metadata: spec.metadata,
      active: true,
    })
  } catch (error) {
    if (!isMissingResource(error)) {
      throw error
    }
    console.log(`  created product ${spec.id}`)
    return stripe.products.create({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      metadata: spec.metadata,
    })
  }
}

function priceMatches(price: Stripe.Price, spec: PriceSpec, productId: string): boolean {
  const productOf = typeof price.product === 'string' ? price.product : price.product.id
  return (
    productOf === productId &&
    price.active &&
    price.currency === (spec.currency ?? 'usd') &&
    price.unit_amount === (spec.unitAmount ?? null) &&
    price.recurring?.interval === spec.recurring?.interval &&
    (price.recurring?.interval_count ?? 1) === (spec.recurring?.interval_count ?? 1)
  )
}

/** Creates a coupon with a fixed ID. Coupons can't be edited, so an existing one is left as is. */
export async function ensureCoupon(
  params: Stripe.CouponCreateParams & { id: string },
): Promise<Stripe.Coupon> {
  const stripe = getStripe()
  try {
    const existing = await stripe.coupons.retrieve(params.id)
    console.log(`  unchanged coupon ${params.id}`)
    return existing
  } catch (error) {
    if (!isMissingResource(error)) {
      throw error
    }
    console.log(`  created coupon ${params.id}`)
    return stripe.coupons.create(params)
  }
}

/** Creates the customer-facing code for a coupon, unless an active one already exists. */
export async function ensurePromotionCode(
  code: string,
  couponId: string,
): Promise<Stripe.PromotionCode> {
  const stripe = getStripe()
  const {
    data: [existing],
  } = await stripe.promotionCodes.list({ code, active: true, limit: 1 })
  if (existing) {
    console.log(`  unchanged promotion code ${code}`)
    return existing
  }
  console.log(`  created promotion code ${code}`)
  return stripe.promotionCodes.create({
    code,
    promotion: { type: 'coupon', coupon: couponId },
  })
}

/**
 * Shipping rates can't take a fixed ID, so they're found by `metadata.lab_key`.
 * Rates can't be edited either: a changed amount archives the old rate and creates a new one.
 */
export async function ensureShippingRate(spec: {
  key: string
  displayName: string
  amount: number
  minDays: number
  maxDays: number
}): Promise<Stripe.ShippingRate> {
  const stripe = getStripe()
  const { data } = await stripe.shippingRates.list({ active: true, limit: 100 })
  const existing = data.find((rate) => rate.metadata?.lab_key === spec.key)

  if (existing && existing.fixed_amount?.amount === spec.amount && existing.display_name === spec.displayName) {
    console.log(`  unchanged shipping rate ${spec.key}`)
    return existing
  }
  if (existing) {
    await stripe.shippingRates.update(existing.id, { active: false })
  }

  console.log(`  ${existing ? 'replaced' : 'created'} shipping rate ${spec.key}`)
  return stripe.shippingRates.create({
    display_name: spec.displayName,
    type: 'fixed_amount',
    fixed_amount: { amount: spec.amount, currency: 'usd' },
    delivery_estimate: {
      minimum: { unit: 'business_day', value: spec.minDays },
      maximum: { unit: 'business_day', value: spec.maxDays },
    },
    metadata: { lab_key: spec.key },
  })
}

/**
 * Finds the price by lookup key, or creates it. Prices can't be edited, so a
 * changed spec creates a new price, moves the lookup key over and archives the old one.
 */
export async function ensurePrice(spec: PriceSpec): Promise<Stripe.Price> {
  const stripe = getStripe()
  const product = await ensureProduct(spec.product)

  const {
    data: [existing],
  } = await stripe.prices.list({ lookup_keys: [spec.lookupKey], limit: 1 })

  if (existing && priceMatches(existing, spec, product.id)) {
    console.log(`  unchanged price ${spec.lookupKey}`)
    return existing
  }

  const price = await stripe.prices.create({
    ...spec.extra,
    product: product.id,
    currency: spec.currency ?? 'usd',
    lookup_key: spec.lookupKey,
    nickname: spec.nickname,
    unit_amount: spec.unitAmount,
    recurring: spec.recurring,
    transfer_lookup_key: Boolean(existing),
  })

  if (existing) {
    await stripe.prices.update(existing.id, { active: false })
    console.log(`  replaced price ${spec.lookupKey} (old one archived)`)
  } else {
    console.log(`  created price ${spec.lookupKey}`)
  }
  return price
}
