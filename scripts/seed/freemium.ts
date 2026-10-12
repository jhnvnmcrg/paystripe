import { addons, plusPlan } from '../../src/lib/lab/freemium/catalog.ts'
import { ensurePrice } from './helpers.ts'

/** Step 6: the Plus plan and three add-on Products, each with a monthly Price. Free needs nothing. */
export async function seedFreemium(): Promise<void> {
  await ensurePrice({
    lookupKey: plusPlan.lookupKey,
    nickname: `${plusPlan.name} monthly`,
    unitAmount: plusPlan.monthly,
    recurring: { interval: 'month' },
    product: {
      id: plusPlan.productId,
      name: plusPlan.name,
      description: plusPlan.description,
      metadata: { lab_module: 'freemium', role: 'plan' },
    },
  })

  for (const addon of addons) {
    await ensurePrice({
      lookupKey: addon.lookupKey,
      nickname: `${addon.name} monthly`,
      unitAmount: addon.monthly,
      recurring: { interval: 'month' },
      product: {
        id: addon.productId,
        name: addon.name,
        description: addon.description,
        metadata: { lab_module: 'freemium', role: 'addon', addon: addon.key },
      },
    })
  }
}
