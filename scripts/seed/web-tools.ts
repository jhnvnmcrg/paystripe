import { TOOLS_PORTAL_KEY, toolFeatures, toolsPlans } from '../../src/lib/lab/web-tools/catalog.ts'
import { attachFeatures, ensureFeature, ensurePortalConfiguration, ensurePrice } from './helpers.ts'

/**
 * Step 5: three Features, two plan Products with the Features attached, and a
 * Portal configuration for switching between the two plans.
 */
export async function seedWebTools(): Promise<void> {
  const featureIds = new Map<string, string>()
  for (const feature of toolFeatures) {
    const created = await ensureFeature(feature.lookupKey, feature.name)
    featureIds.set(feature.lookupKey, created.id)
  }

  const portalProducts = []
  for (const plan of toolsPlans) {
    const price = await ensurePrice({
      lookupKey: plan.lookupKey,
      nickname: `${plan.name} monthly`,
      unitAmount: plan.monthly,
      recurring: { interval: 'month' },
      product: {
        id: plan.productId,
        name: plan.name,
        description: plan.description,
        metadata: { lab_module: 'web-tools', plan: plan.key },
      },
    })
    await attachFeatures(
      plan.productId,
      plan.features.flatMap((key) => {
        const id = featureIds.get(key)
        return id ? [id] : []
      }),
    )
    portalProducts.push({ product: plan.productId, prices: [price.id] })
  }

  await ensurePortalConfiguration(TOOLS_PORTAL_KEY, {
    business_profile: { headline: 'Stripe Lab tools: change your plan' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: portalProducts,
      },
    },
  })
}
