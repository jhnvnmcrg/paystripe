import { shopShippingRates, shopSkus, skuLabel } from '../../src/lib/lab/shop/catalog.ts'
import { ensurePrice, ensureShippingRate } from './helpers.ts'

/**
 * Step 3: one Product per SKU (so each size shows its own name on the receipt),
 * each with a one-time Price, plus two shipping rates.
 * Stock isn't a Stripe concept: the app creates pay_skus rows on first load.
 */
export async function seedShop(): Promise<void> {
  for (const item of shopSkus) {
    await ensurePrice({
      lookupKey: item.lookupKey,
      nickname: `${skuLabel(item)} (one-time)`,
      unitAmount: item.unitAmount,
      product: {
        id: item.productId,
        name: skuLabel(item),
        description: item.description,
        metadata: { lab_module: 'shop', sku: item.sku },
      },
    })
  }

  for (const rate of shopShippingRates) {
    await ensureShippingRate(rate)
  }
}
