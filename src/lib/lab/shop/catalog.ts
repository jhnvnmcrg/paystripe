/*
 * The physical goods, shared by the seed script and the app.
 * No framework imports: scripts/seed/shop.ts reads this file too.
 * Stripe holds products, prices and shipping rates; stock lives in Postgres (pay_skus).
 */

export interface ShopSku {
  sku: string
  lookupKey: string
  productId: string
  /** The item, shared by every size of the tee. */
  name: string
  variant?: string
  description: string
  /** What the seed creates. The app always displays the live Stripe price. */
  unitAmount: number
  /** Stock the shop starts with, and returns to on "Reset stock". */
  initialStock: number
}

export const shopSkus: ShopSku[] = [
  {
    sku: 'mug',
    lookupKey: 'shop_mug',
    productId: 'lab_shop_mug',
    name: 'Stripe Lab Mug',
    description: 'A 350 ml stoneware mug.',
    unitAmount: 1800,
    initialStock: 12,
  },
  {
    sku: 'stickers',
    lookupKey: 'shop_stickers',
    productId: 'lab_shop_stickers',
    name: 'Sticker Pack',
    description: 'Six vinyl stickers.',
    unitAmount: 600,
    initialStock: 40,
  },
  {
    sku: 'tee-s',
    lookupKey: 'shop_tee_s',
    productId: 'lab_shop_tee_s',
    name: 'Lab Tee',
    variant: 'S',
    description: 'Heavyweight cotton tee.',
    unitAmount: 2800,
    initialStock: 3,
  },
  {
    sku: 'tee-m',
    lookupKey: 'shop_tee_m',
    productId: 'lab_shop_tee_m',
    name: 'Lab Tee',
    variant: 'M',
    description: 'Heavyweight cotton tee.',
    unitAmount: 2800,
    initialStock: 5,
  },
  {
    sku: 'tee-l',
    lookupKey: 'shop_tee_l',
    productId: 'lab_shop_tee_l',
    name: 'Lab Tee',
    variant: 'L',
    description: 'Heavyweight cotton tee.',
    unitAmount: 2800,
    initialStock: 2,
  },
]

export interface ShopShippingRate {
  /** Stored in the rate's metadata, so the app can find it again. */
  key: string
  displayName: string
  amount: number
  minDays: number
  maxDays: number
}

export const shopShippingRates: ShopShippingRate[] = [
  { key: 'standard', displayName: 'Standard', amount: 500, minDays: 5, maxDays: 7 },
  { key: 'express', displayName: 'Express', amount: 1500, minDays: 1, maxDays: 2 },
]

/** Carriers the seller can pick when marking an order shipped. */
export const carriers = ['UPS', 'USPS', 'FedEx', 'DHL', 'LBC'] as const
export type Carrier = (typeof carriers)[number]

/** Countries Checkout will accept a shipping address from. */
export const shippingCountries = ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'JP', 'SG', 'PH'] as const

/** Stock is held this long; it's also the Checkout Session's lifetime. Stripe's minimum is 30. */
export const HOLD_MINUTES = 31

/** The most of one SKU a cart may hold. */
export const MAX_PER_LINE = 5

export function findShopSku(sku: string): ShopSku | undefined {
  return shopSkus.find((item) => item.sku === sku)
}

export function findShopSkuByLookupKey(lookupKey: string): ShopSku | undefined {
  return shopSkus.find((item) => item.lookupKey === lookupKey)
}

/** "Lab Tee (M)" or "Stripe Lab Mug". */
export function skuLabel(item: Pick<ShopSku, 'name' | 'variant'>): string {
  return item.variant ? `${item.name} (${item.variant})` : item.name
}
