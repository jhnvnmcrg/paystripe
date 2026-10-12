/*
 * The gated tools, shared by the seed script and the app.
 * No framework imports: scripts/seed/web-tools.ts reads this file too.
 *
 * A Stripe Feature is a thing a plan unlocks. Features are attached to Products;
 * a customer subscribed to a Product is entitled to its Features.
 */

export type ToolFeatureKey = 'bg_remover' | 'bulk_export' | 'api_access'

export interface ToolFeature {
  lookupKey: ToolFeatureKey
  name: string
  description: string
}

export const toolFeatures: ToolFeature[] = [
  {
    lookupKey: 'bg_remover',
    name: 'Background remover',
    description: 'Cut the background out of a product photo.',
  },
  {
    lookupKey: 'bulk_export',
    name: 'Bulk CSV export',
    description: 'Download every project as one CSV file.',
  },
  {
    lookupKey: 'api_access',
    name: 'API access',
    description: 'Call the tools from your own code with an API key.',
  },
]

export type ToolsPlanKey = 'basic' | 'pro'

export interface ToolsPlan {
  key: ToolsPlanKey
  productId: string
  lookupKey: string
  name: string
  description: string
  /** What the seed creates. The app shows the live Stripe price. */
  monthly: number
  features: ToolFeatureKey[]
}

export const toolsPlans: ToolsPlan[] = [
  {
    key: 'basic',
    productId: 'lab_tools_basic',
    lookupKey: 'tools_basic_monthly',
    name: 'Tools Basic',
    description: 'The background remover, as often as you like.',
    monthly: 1200,
    features: ['bg_remover'],
  },
  {
    key: 'pro',
    productId: 'lab_tools_pro',
    lookupKey: 'tools_pro_monthly',
    name: 'Tools Pro',
    description: 'Every tool, plus bulk export and the API.',
    monthly: 3900,
    features: ['bg_remover', 'bulk_export', 'api_access'],
  },
]

export const TOOLS_PORTAL_KEY = 'web-tools'

export function findToolFeature(lookupKey: string): ToolFeature | undefined {
  return toolFeatures.find((feature) => feature.lookupKey === lookupKey)
}

export function findToolsPlan(key: string): ToolsPlan | undefined {
  return toolsPlans.find((plan) => plan.key === key)
}

export function toolsPlanForLookupKey(lookupKey: string | null): ToolsPlan | undefined {
  return toolsPlans.find((plan) => plan.lookupKey === lookupKey)
}

/** The cheapest plan that includes a feature, for "Included in …" hints. */
export function cheapestPlanWith(feature: ToolFeatureKey): ToolsPlan | undefined {
  return toolsPlans.find((plan) => plan.features.includes(feature))
}

/** The sample photo for the background remover: a mug on a coloured backdrop. */
const mug = `<g><rect x="70" y="60" width="90" height="100" rx="10" fill="#f7f8fa" stroke="#0f1222" stroke-width="4"/><path d="M160 85 h18 a18 18 0 0 1 0 36 h-18" fill="none" stroke="#0f1222" stroke-width="6"/><rect x="70" y="80" width="90" height="10" fill="#5b4cf0"/></g>`

export const sampleImage = {
  before: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f97316"/></linearGradient></defs><rect width="240" height="200" fill="url(#bg)"/><ellipse cx="118" cy="168" rx="70" ry="10" fill="#00000033"/>${mug}</svg>`,
  after: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">${mug}</svg>`,
}
