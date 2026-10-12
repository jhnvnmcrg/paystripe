/*
 * Credit packs and what credits buy, shared by the seed script and the app.
 * No framework imports: scripts/seed/credits.ts reads this file too.
 *
 * Stripe only knows the packs as one-time Prices. How many credits a pack
 * grants lives here, keyed by the Price's lookup key, and is never read from
 * anything the browser sends.
 */

export type PackKey = 'starter' | 'pro' | 'studio'

export interface CreditPack {
  key: PackKey
  productId: string
  lookupKey: string
  name: string
  credits: number
  /** In cents. */
  price: number
}

export const creditPacks: CreditPack[] = [
  { key: 'starter', productId: 'lab_credits_starter', lookupKey: 'credits_starter_pack', name: 'Starter pack', credits: 500, price: 500 },
  { key: 'pro', productId: 'lab_credits_pro', lookupKey: 'credits_pro_pack', name: 'Pro pack', credits: 2500, price: 2000 },
  { key: 'studio', productId: 'lab_credits_studio', lookupKey: 'credits_studio_pack', name: 'Studio pack', credits: 10000, price: 7000 },
]

export type ActionKey = 'image' | 'sms' | 'job'

export interface CreditAction {
  key: ActionKey
  name: string
  cost: number
  /** What the toy action reports back. */
  result: string
}

export const creditActions: CreditAction[] = [
  { key: 'image', name: 'Generate an AI image', cost: 10, result: 'Image generated (a placeholder, 1024×1024).' },
  { key: 'job', name: 'Run a background job', cost: 5, result: 'Job finished in 1.2 seconds.' },
  { key: 'sms', name: 'Send an SMS', cost: 1, result: 'SMS queued for delivery.' },
]

export const DEFAULT_RECHARGE_THRESHOLD = 100

export function findPack(key: string | null | undefined): CreditPack | undefined {
  return creditPacks.find((pack) => pack.key === key)
}

export function packForLookupKey(lookupKey: string | null): CreditPack | undefined {
  return creditPacks.find((pack) => pack.lookupKey === lookupKey)
}

export function findAction(key: string): CreditAction | undefined {
  return creditActions.find((action) => action.key === key)
}
