import type { FileRouteTypes } from '#/routeTree.gen'

export type LabModuleStatus = 'ready' | 'next' | 'planned'

export type LabModuleSlug =
  | 'license-keys'
  | 'downloads'
  | 'shop'
  | 'saas'
  | 'web-tools'
  | 'freemium'
  | 'membership'
  | 'usage'
  | 'credits'
  | 'marketplace'

export interface LabModule {
  step: number
  slug: LabModuleSlug
  name: string
  moneyFlow: string
  examples: string
  status: LabModuleStatus
  /** Set once the module's page exists. */
  to?: FileRouteTypes['to']
}

export function isLabModuleSlug(value: string): value is LabModuleSlug {
  return labModules.some((module) => module.slug === value)
}

/** The selling types in build order. Update `status` and `to` as each one ships. */
export const labModules: LabModule[] = [
  {
    step: 1,
    slug: 'license-keys',
    name: 'One-time purchases and license keys',
    moneyFlow: 'Charged once. The webhook issues a license key.',
    examples: 'Tailwind UI, Raycast Pro, ebooks',
    status: 'ready',
    to: '/stripe/license-keys',
  },
  {
    step: 2,
    slug: 'downloads',
    name: 'Digital downloads',
    moneyFlow: 'A cart is paid once. Buyers get expiring download links.',
    examples: 'UI kits, design templates, PDF guides',
    status: 'ready',
    to: '/stripe/downloads',
  },
  {
    step: 3,
    slug: 'shop',
    name: 'Physical goods with inventory',
    moneyFlow: 'Stock is held during checkout, then the order ships.',
    examples: 'Merch stores, small product shops',
    status: 'ready',
    to: '/stripe/shop',
  },
  {
    step: 4,
    slug: 'saas',
    name: 'SaaS subscriptions',
    moneyFlow: 'Billed monthly or yearly until the customer cancels.',
    examples: 'Netflix, Canva, Notion, Figma',
    status: 'ready',
    to: '/stripe/saas',
  },
  {
    step: 5,
    slug: 'web-tools',
    name: 'Subscription-gated web tools',
    moneyFlow: 'The plan a customer pays for unlocks specific features.',
    examples: 'Background removers, SEO trackers, analytics dashboards',
    status: 'ready',
    to: '/stripe/web-tools',
  },
  {
    step: 6,
    slug: 'freemium',
    name: 'Freemium with paid add-ons',
    moneyFlow: 'Free to start. Upgrades and add-ons bill on one subscription.',
    examples: 'GitHub, ChatGPT Plus, Spotify',
    status: 'ready',
    to: '/stripe/freemium',
  },
  {
    step: 7,
    slug: 'membership',
    name: 'Memberships and patronage',
    moneyFlow: 'Supporters pick a tier or name their own monthly amount.',
    examples: 'Patreon, GitHub Sponsors, Circle',
    status: 'next',
  },
  {
    step: 8,
    slug: 'usage',
    name: 'Usage-based billing',
    moneyFlow: 'Usage is metered and billed at the end of each month.',
    examples: 'OpenAI, Twilio, AWS, Vercel',
    status: 'planned',
  },
  {
    step: 9,
    slug: 'credits',
    name: 'Prepaid credits',
    moneyFlow: 'Credits are bought upfront and spent with each action.',
    examples: 'AI image generators, SMS senders, background jobs',
    status: 'planned',
  },
  {
    step: 10,
    slug: 'marketplace',
    name: 'Marketplace with split payments',
    moneyFlow: 'Buyers pay the platform. Sellers are paid out, minus a fee.',
    examples: 'Gumroad, Udemy, Envato',
    status: 'planned',
  },
]
