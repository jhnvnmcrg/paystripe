import { lookupKeyFor, SAAS_PORTAL_KEY, saasPlans } from '../../src/lib/lab/saas/catalog.ts'
import { ensurePortalConfiguration, ensurePrice } from './helpers.ts'

/**
 * Step 4: one Product per plan with a monthly and a yearly Price, and a Customer
 * Portal configuration that lets customers switch between these plans only.
 */
export async function seedSaas(): Promise<void> {
  const portalProducts = []

  for (const plan of saasPlans) {
    const product = {
      id: plan.productId,
      name: plan.name,
      description: plan.description,
      metadata: { lab_module: 'saas', plan: plan.key },
    }
    const monthly = await ensurePrice({
      lookupKey: lookupKeyFor(plan.key, 'month'),
      nickname: `${plan.name} monthly`,
      unitAmount: plan.monthly,
      recurring: { interval: 'month' },
      product,
    })
    const yearly = await ensurePrice({
      lookupKey: lookupKeyFor(plan.key, 'year'),
      nickname: `${plan.name} yearly`,
      unitAmount: plan.yearly,
      recurring: { interval: 'year' },
      product,
    })
    portalProducts.push({
      product: plan.productId,
      prices: [monthly.id, yearly.id],
      // Only per-seat plans let the customer change the quantity.
      adjustable_quantity: plan.perSeat
        ? { enabled: true, minimum: plan.minSeats, maximum: plan.maxSeats }
        : { enabled: false },
    })
  }

  await ensurePortalConfiguration(SAAS_PORTAL_KEY, {
    business_profile: { headline: 'Stripe Lab SaaS: manage your plan and billing' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price', 'quantity'],
        proration_behavior: 'create_prorations',
        products: portalProducts,
      },
    },
  })
}
