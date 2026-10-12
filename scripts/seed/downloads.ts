import { digitalAssets, launchPromotion } from '../../src/lib/lab/downloads/catalog.ts'
import { ensureCoupon, ensurePrice, ensurePromotionCode } from './helpers.ts'

/** Step 2: one Product per asset with a one-time Price, plus the LAUNCH20 code. */
export async function seedDownloads(): Promise<void> {
  for (const asset of digitalAssets) {
    await ensurePrice({
      lookupKey: asset.lookupKey,
      nickname: `${asset.name} (one-time)`,
      unitAmount: asset.unitAmount,
      product: {
        id: asset.productId,
        name: asset.name,
        description: asset.description,
        metadata: { lab_module: 'downloads' },
      },
    })
  }

  // The coupon is the discount; the promotion code is what the buyer types.
  await ensureCoupon({
    id: launchPromotion.couponId,
    name: `Launch ${launchPromotion.percentOff}% off`,
    percent_off: launchPromotion.percentOff,
    duration: 'once',
    // Only the download products, so the code can't be used on other lab modules.
    applies_to: { products: digitalAssets.map((asset) => asset.productId) },
  })
  await ensurePromotionCode(launchPromotion.code, launchPromotion.couponId)
}
