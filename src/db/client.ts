import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { databaseUrl } from '@/lib/env'
import * as schema from './schema'

export type Database = NodePgDatabase<typeof schema>

let pool: Pool | undefined
let db: Database | undefined

/** Process-wide connection pool. Created on first use so imports stay side-effect free. */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl(), max: 10 })
    // An idle-client error must never be swallowed: it means the pool lost a backend.
    pool.on('error', (error) => {
      console.error('[db] idle client error', error)
    })
  }
  return pool
}

export function getDb(): Database {
  if (!db) {
    db = drizzle(getPool(), { schema })
  }
  return db
}

/** Closes the pool. Used by scripts and test teardown. */
export async function closeDb(): Promise<void> {
  const current = pool
  pool = undefined
  db = undefined
  if (current) await current.end()
}

export { schema }
