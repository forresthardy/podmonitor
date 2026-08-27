/**
 * Environment access. Values are read lazily so that importing a module does not
 * require a configured environment (Next builds and unit tests import freely).
 */

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received: ${raw}`)
  }
  return parsed
}

export function databaseUrl(): string {
  return requireEnv('DATABASE_URL')
}

/** bcrypt work factor. Low values are only meant for test runs. */
export function bcryptCost(): number {
  return intEnv('BCRYPT_COST', 12)
}

export function sessionTtlDays(): number {
  return intEnv('SESSION_TTL_DAYS', 30)
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}
