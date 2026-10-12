import { licenseProducts } from '../../src/lib/lab/license-keys/catalog.ts'
import { ensurePrice } from './helpers.ts'

/** Step 1: one Product per license, each with one one-time Price. */
export async function seedLicenseKeys(): Promise<void> {
  for (const product of licenseProducts) {
    await ensurePrice({
      lookupKey: product.lookupKey,
      nickname: `${product.name} (one-time)`,
      unitAmount: product.unitAmount,
      product: {
        id: product.productId,
        name: product.name,
        description: product.description,
        metadata: { lab_module: 'license-keys' },
      },
    })
  }
}
