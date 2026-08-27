import { createHash, randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32

/**
 * Mints an opaque session token. 256 bits of CSPRNG entropy: the token itself carries
 * no claims, so there is nothing to forge and nothing to verify beyond a table lookup.
 */
export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * Hashes a session token for storage.
 *
 * SHA-256 rather than bcrypt on purpose: the token is high-entropy random, so guessing
 * is infeasible and a slow KDF would only add latency to every request. Hashing still
 * means a leaked `sessions` table yields no usable cookies.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sessionExpiryFrom(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)
}
