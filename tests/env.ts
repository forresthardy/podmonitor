import 'dotenv/config'

/**
 * Test bootstrap: the suite talks to a dedicated database and hashes with a cheap bcrypt
 * cost. Imported by both the global setup and every test process, before any app module.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://podmonitor:podmonitor@localhost:5432/podmonitor_test'

process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.BCRYPT_COST = process.env.BCRYPT_COST ?? '4'
