/*
 * The SaaS plans, shared by the seed script and the app.
 * No framework imports: scripts/seed/saas.ts reads this file too.
 * One Product per plan; monthly and yearly are two Prices of the same Product.
 */

export type SaasPlanKey = 'starter' | 'pro' | 'team'
export type BillingInterval = 'month' | 'year'

export interface SaasPlan {
  key: SaasPlanKey
  productId: string
  name: string
  description: string
  features: string[]
  /** Per month and per year, in cents (per seat for Team). */
  monthly: number
  yearly: number
  perSeat: boolean
  trialDays?: number
  minSeats?: number
  maxSeats?: number
}

export const saasPlans: SaasPlan[] = [
  {
    key: 'starter',
    productId: 'lab_saas_starter',
    name: 'Starter',
    description: 'For one person trying things out.',
    features: ['3 projects', 'Basic reports', 'Email support'],
    monthly: 900,
    yearly: 9000,
    perSeat: false,
  },
  {
    key: 'pro',
    productId: 'lab_saas_pro',
    name: 'Pro',
    description: 'For people who use it every day.',
    features: ['Unlimited projects', 'Advanced reports', 'Priority support'],
    monthly: 2900,
    yearly: 29000,
    perSeat: false,
    trialDays: 14,
  },
  {
    key: 'team',
    productId: 'lab_saas_team',
    name: 'Team',
    description: 'For teams, billed per seat.',
    features: ['Everything in Pro', 'Shared workspaces', 'Admin controls'],
    monthly: 1200,
    yearly: 12000,
    perSeat: true,
    minSeats: 2,
    maxSeats: 50,
  },
]

/** The Portal configuration is found by this metadata key (configurations can't have fixed IDs). */
export const SAAS_PORTAL_KEY = 'saas'

export function lookupKeyFor(plan: SaasPlanKey, interval: BillingInterval): string {
  return `saas_${plan}_${interval === 'month' ? 'monthly' : 'yearly'}`
}

export function findSaasPlan(key: string): SaasPlan | undefined {
  return saasPlans.find((plan) => plan.key === key)
}

/** The plan and interval behind a price lookup key such as `saas_pro_yearly`. */
export function planForLookupKey(
  lookupKey: string | null,
): { plan: SaasPlan; interval: BillingInterval } | null {
  const match = lookupKey?.match(/^saas_(starter|pro|team)_(monthly|yearly)$/)
  const plan = match ? findSaasPlan(match[1]) : undefined
  return plan && match ? { plan, interval: match[2] === 'monthly' ? 'month' : 'year' } : null
}
