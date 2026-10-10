import { drizzle } from 'drizzle-orm/node-postgres'

import * as paySchema from './pay-schema.ts'
import * as schema from './schema.ts'

export const db = drizzle(process.env.DATABASE_URL!, {
  schema: { ...schema, ...paySchema },
})

/** The transaction handle passed to `db.transaction` callbacks. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
