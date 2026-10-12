/*
 * The membership tiers and extras, shared by the seed script and the app.
 * No framework imports: scripts/seed/membership.ts reads this file too.
 *
 * Each tier is its own Product with a monthly and a yearly Price.
 * Pay-what-you-want has a Product but no Price: Checkout makes one per
 * supporter from `price_data`. Tips use one Price whose amount the buyer
 * types on Stripe's page (`custom_unit_amount`).
 *
 * The posts themselves live in posts.server.ts, so locked text never
 * reaches the browser bundle.
 */

export type TierKey = 'supporter' | 'insider' | 'patron'
export type MembershipInterval = 'month' | 'year'

/** Access levels, lowest first. A Backer chose an amount below the cheapest tier. */
export type MemberLevel = 'backer' | TierKey

export const memberLevels: MemberLevel[] = ['backer', 'supporter', 'insider', 'patron']

export const levelNames: Record<MemberLevel, string> = {
  backer: 'Backer',
  supporter: 'Supporter',
  insider: 'Insider',
  patron: 'Patron',
}

/** True when `level` is at least `required`. */
export function reaches(level: MemberLevel | null, required: MemberLevel): boolean {
  return level !== null && memberLevels.indexOf(level) >= memberLevels.indexOf(required)
}

export interface Tier {
  key: TierKey
  productId: string
  name: string
  description: string
  perks: string[]
  /** In cents. Yearly is ten months' worth: two months free. */
  monthly: number
  yearly: number
}

export const tiers: Tier[] = [
  {
    key: 'supporter',
    productId: 'lab_membership_supporter',
    name: 'Supporter',
    description: 'Keep the studio going.',
    perks: ['Behind-the-scenes posts', 'Supporter role in the community', 'Your name on the wall'],
    monthly: 500,
    yearly: 5000,
  },
  {
    key: 'insider',
    productId: 'lab_membership_insider',
    name: 'Insider',
    description: 'For regulars who want more.',
    perks: ['Everything in Supporter', 'Monthly Q&A recordings', 'Insider role'],
    monthly: 1500,
    yearly: 15000,
  },
  {
    key: 'patron',
    productId: 'lab_membership_patron',
    name: 'Patron',
    description: 'For the people who make it possible.',
    perks: ['Everything in Insider', 'Patron roundtable notes', 'Patron role'],
    monthly: 5000,
    yearly: 50000,
  },
]

/** Pay what you want, monthly. Checkout creates the Price from `price_data`. */
export const customSupport = {
  productId: 'lab_membership_custom',
  name: 'Custom support',
  description: 'A monthly amount the supporter chooses.',
  /** Whole dollars, as the form takes them. */
  minimumDollars: 3,
  maximumDollars: 1000,
}

/** One-time tips. The buyer types the amount on Stripe's page. */
export const tipJar = {
  productId: 'lab_membership_tip',
  lookupKey: 'membership_tip',
  name: 'Tip for the studio',
  description: 'A one-time thank you. No subscription.',
  minimum: 100,
  maximum: 50000,
  preset: 500,
}

/** The Portal configuration is found by this metadata key. */
export const MEMBERSHIP_PORTAL_KEY = 'membership'

export function tierLookupKey(tier: TierKey, interval: MembershipInterval): string {
  return `membership_${tier}_${interval === 'month' ? 'monthly' : 'yearly'}`
}

export function findTier(key: string): Tier | undefined {
  return tiers.find((tier) => tier.key === key)
}

export function tierForLookupKey(
  lookupKey: string | null,
): { tier: Tier; interval: MembershipInterval } | null {
  const match = lookupKey?.match(/^membership_(supporter|insider|patron)_(monthly|yearly)$/)
  const tier = match ? findTier(match[1]) : undefined
  return tier && match ? { tier, interval: match[2] === 'monthly' ? 'month' : 'year' } : null
}

/** The level a monthly amount reaches: the most expensive tier it covers, else Backer. */
export function levelForMonthlyAmount(cents: number): MemberLevel {
  const covered = tiers.filter((tier) => cents >= tier.monthly)
  return covered.at(-1)?.key ?? 'backer'
}
