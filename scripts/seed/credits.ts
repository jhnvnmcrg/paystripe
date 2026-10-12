import { creditPacks } from '../../src/lib/lab/credits/catalog.ts'
import { ensurePrice } from './helpers.ts'

/** Step 9: one Product and one-time Price per credit pack. */
export async function seedCredits(): Promise<void> {
  for (const pack of creditPacks) {
    await ensurePrice({
      lookupKey: pack.lookupKey,
      nickname: `${pack.name}, ${pack.credits} credits`,
      unitAmount: pack.price,
      product: {
        id: pack.productId,
        name: pack.name,
        description: `${pack.credits.toLocaleString('en-US')} credits for the Stripe Lab tools.`,
        metadata: { lab_module: 'credits', credits: String(pack.credits) },
      },
    })
  }
}
