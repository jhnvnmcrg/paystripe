import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.local', '.env'] })

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local.')
}

/*
 * Migrations for the Stripe Lab tables only. Kept apart from drizzle.config.ts
 * because the starter's `todos` table in the database doesn't match src/db/schema.ts.
 */
export default defineConfig({
  out: './drizzle/pay',
  schema: './src/db/pay-schema.ts',
  dialect: 'postgresql',
  tablesFilter: ['pay_*'],
  migrations: {
    table: 'pay_migrations',
    schema: 'public',
  },
  dbCredentials: { url },
})
