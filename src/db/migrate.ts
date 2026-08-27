import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { closeDb, getDb } from './client'

const MIGRATIONS_FOLDER = 'drizzle'

/**
 * Applies every pending Drizzle migration.
 *
 * `CREATE EXTENSION vector` runs first and outside the migration files: the extension
 * is an environment prerequisite, and keeping it here means later PRs can regenerate
 * migrations with drizzle-kit without hand-editing generated SQL.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb()
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`)
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}

const isDirectRun =
  process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  runMigrations()
    .then(async () => {
      console.log('[db] migrations applied')
      await closeDb()
    })
    .catch(async (error: unknown) => {
      console.error('[db] migration failed', error)
      await closeDb()
      process.exitCode = 1
    })
}
