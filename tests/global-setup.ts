import { Client } from 'pg'
import { TEST_DATABASE_URL } from './env'

async function ensureTestDatabase(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL)
  const databaseName = url.pathname.replace(/^\//, '')
  if (!databaseName) throw new Error('TEST_DATABASE_URL must include a database name')

  const adminUrl = new URL(TEST_DATABASE_URL)
  adminUrl.pathname = '/postgres'

  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    const existing = await admin.query('select 1 from pg_database where datname = $1', [
      databaseName,
    ])
    if (existing.rowCount === 0) {
      // Identifier cannot be parameterized; the name comes from our own env, not user input.
      await admin.query(`create database "${databaseName.replace(/"/g, '""')}"`)
    }
  } finally {
    await admin.end()
  }
}

/** Creates the test database if needed and brings it to the current migration state. */
export default async function setup(): Promise<void> {
  await ensureTestDatabase()
  const { runMigrations } = await import('../src/db/migrate')
  const { closeDb } = await import('../src/db/client')
  await runMigrations()
  await closeDb()
}
