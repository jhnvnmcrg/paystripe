import type { LabModuleSlug } from '../../src/lib/lab/modules.ts'
import { seedDownloads } from './downloads.ts'
import { seedFreemium } from './freemium.ts'
import { seedLicenseKeys } from './license-keys.ts'
import { seedSaas } from './saas.ts'
import { seedShop } from './shop.ts'
import { seedWebTools } from './web-tools.ts'

export interface ModuleSeed {
  module: LabModuleSlug
  run: () => Promise<void>
}

/** Each lab step adds its catalog here, in build order. */
export const moduleSeeds: ModuleSeed[] = [
  { module: 'license-keys', run: seedLicenseKeys },
  { module: 'downloads', run: seedDownloads },
  { module: 'shop', run: seedShop },
  { module: 'saas', run: seedSaas },
  { module: 'web-tools', run: seedWebTools },
  { module: 'freemium', run: seedFreemium },
]
