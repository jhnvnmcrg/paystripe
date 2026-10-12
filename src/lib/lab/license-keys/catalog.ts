/*
 * The license products, shared by the seed script and the app.
 * No framework imports: scripts/seed/license-keys.ts reads this file too.
 * Prices shown in the app come from Stripe (looked up by `lookupKey`), not from `unitAmount`.
 */

export interface LicenseProduct {
  lookupKey: string
  productId: string
  name: string
  description: string
  /** What the seed creates. The app always displays the live Stripe price. */
  unitAmount: number
  /** How many devices one key can be activated on. */
  maxActivations: number
  perks: string[]
}

export const licenseProducts: LicenseProduct[] = [
  {
    lookupKey: 'license_pro_onetime',
    productId: 'lab_license_pro',
    name: 'Pro Extension',
    description: 'Pro commands for a launcher app. Pay once, keep it forever.',
    unitAmount: 2900,
    maxActivations: 2,
    perks: ['Lifetime license', 'Use on 2 devices', 'Free updates for version 1'],
  },
  {
    lookupKey: 'license_team_onetime',
    productId: 'lab_license_team',
    name: 'Team License',
    description: 'The same extension for a small team, on one shared key.',
    unitAmount: 9900,
    maxActivations: 5,
    perks: ['Lifetime license', 'Use on 5 devices', 'Priority email support'],
  },
]

export function findLicenseProduct(lookupKey: string): LicenseProduct | undefined {
  return licenseProducts.find((product) => product.lookupKey === lookupKey)
}
