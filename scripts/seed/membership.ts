import {
  customSupport,
  MEMBERSHIP_PORTAL_KEY,
  tierLookupKey,
  tiers,
  tipJar,
} from '../../src/lib/lab/membership/catalog.ts'
import { ensurePortalConfiguration, ensurePrice, ensureProduct } from './helpers.ts'

/**
 * Step 7: one Product per tier (monthly and yearly Prices), a Product for
 * pay-what-you-want with no Price of its own, a tip Price with a
 * customer-chosen amount, and a Portal configuration for switching tiers.
 */
export async function seedMembership(): Promise<void> {
  const portalProducts = []

  for (const tier of tiers) {
    const product = {
      id: tier.productId,
      name: `${tier.name} membership`,
      description: tier.description,
      metadata: { lab_module: 'membership', tier: tier.key },
    }
    const monthly = await ensurePrice({
      lookupKey: tierLookupKey(tier.key, 'month'),
      nickname: `${tier.name} monthly`,
      unitAmount: tier.monthly,
      recurring: { interval: 'month' },
      product,
    })
    const yearly = await ensurePrice({
      lookupKey: tierLookupKey(tier.key, 'year'),
      nickname: `${tier.name} yearly`,
      unitAmount: tier.yearly,
      recurring: { interval: 'year' },
      product,
    })
    portalProducts.push({ product: tier.productId, prices: [monthly.id, yearly.id] })
  }

  // Checkout attaches a new Price to this Product for each pay-what-you-want amount.
  await ensureProduct({
    id: customSupport.productId,
    name: customSupport.name,
    description: customSupport.description,
    metadata: { lab_module: 'membership', tier: 'custom' },
  })

  await ensurePrice({
    lookupKey: tipJar.lookupKey,
    nickname: 'Tip, buyer sets the amount',
    product: {
      id: tipJar.productId,
      name: tipJar.name,
      description: tipJar.description,
      metadata: { lab_module: 'membership' },
    },
    extra: {
      custom_unit_amount: {
        enabled: true,
        minimum: tipJar.minimum,
        maximum: tipJar.maximum,
        preset: tipJar.preset,
      },
    },
  })

  await ensurePortalConfiguration(MEMBERSHIP_PORTAL_KEY, {
    business_profile: { headline: 'Stripe Lab Studio: manage your membership' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'name'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        // Moving up charges the difference now and unlocks the tier at once.
        proration_behavior: 'always_invoice',
        // Moving down waits for the renewal, so members keep what they paid for.
        schedule_at_period_end: {
          conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }],
        },
        products: portalProducts,
      },
    },
  })
}
