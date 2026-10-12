/*
 * The freemium plan and its add-ons, shared by the seed script and the app.
 * No framework imports: scripts/seed/freemium.ts reads this file too.
 *
 * Free isn't a Stripe product at all. Plus is, and each add-on is its own
 * Product, so they show up as separate lines on the same subscription.
 */

export const FREE_PROJECT_LIMIT = 3
export const PLUS_PROJECT_LIMIT = 100

export const plusPlan = {
  productId: 'lab_freemium_plus',
  lookupKey: 'freemium_plus_monthly',
  name: 'Plus',
  description: 'Unlimited projects, and add-ons when you need them.',
  monthly: 1000,
}

export type AddonKey = 'seats' | 'analytics' | 'support'

export interface Addon {
  key: AddonKey
  productId: string
  lookupKey: string
  name: string
  description: string
  monthly: number
  /** Seats are bought by quantity; the others are on or off. */
  perUnit: boolean
  maxQuantity: number
}

export const addons: Addon[] = [
  {
    key: 'seats',
    productId: 'lab_freemium_seats',
    lookupKey: 'freemium_seats_monthly',
    name: 'Extra seats',
    description: 'Invite teammates, billed per seat.',
    monthly: 400,
    perUnit: true,
    maxQuantity: 20,
  },
  {
    key: 'analytics',
    productId: 'lab_freemium_analytics',
    lookupKey: 'freemium_analytics_monthly',
    name: 'Advanced analytics',
    description: 'Charts of activity across every project.',
    monthly: 500,
    perUnit: false,
    maxQuantity: 1,
  },
  {
    key: 'support',
    productId: 'lab_freemium_support',
    lookupKey: 'freemium_support_monthly',
    name: 'Priority support',
    description: 'Answers within four hours.',
    monthly: 800,
    perUnit: false,
    maxQuantity: 1,
  },
]

export function findAddon(key: string): Addon | undefined {
  return addons.find((addon) => addon.key === key)
}

export function addonForLookupKey(lookupKey: string | null): Addon | undefined {
  return addons.find((addon) => addon.lookupKey === lookupKey)
}
