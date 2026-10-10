import type { LabModuleSlug } from '../../src/lib/lab/modules.ts'

export interface ModuleSeed {
  module: LabModuleSlug
  run: () => Promise<void>
}

/** Each lab step adds its catalog here, in build order. */
export const moduleSeeds: ModuleSeed[] = []
