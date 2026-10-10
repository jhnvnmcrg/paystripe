/*
 * Creates the lab's products and prices in your Stripe sandbox.
 *   npm run stripe:seed               seed every module
 *   npm run stripe:seed license-keys  seed one module
 * Safe to run repeatedly.
 */
import { getStripe, isRestrictedKey } from '../src/lib/stripe/client.server.ts'
import { moduleSeeds } from './seed/index.ts'

async function main() {
  // Throws before any request if the key is missing or live.
  const stripe = getStripe()
  if (!isRestrictedKey()) {
    console.warn('Using a full secret key. A restricted key (rk_test_…) is safer.\n')
  }

  // Confirms the key works before seeding anything.
  await stripe.products.list({ limit: 1 })

  const only = process.argv[2]
  const seeds = only ? moduleSeeds.filter((seed) => seed.module === only) : moduleSeeds

  if (seeds.length === 0) {
    console.log(
      only
        ? `No seed found for "${only}".`
        : 'Nothing to seed yet. Each lab step adds its catalog here.',
    )
    return
  }

  for (const seed of seeds) {
    console.log(`\n${seed.module}`)
    await seed.run()
  }
  console.log('\nDone.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
