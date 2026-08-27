import { and, eq, gt, lt } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { sessions, users } from '@/db/schema'
import { sessionTtlDays } from '@/lib/env'
import { parseCredentials } from './credentials'
import { AuthError } from './errors'
import { hashPassword, verifyPassword } from './password'
import { createSessionToken, hashSessionToken, sessionExpiryFrom } from './session-token'

/** The only user shape that ever leaves the auth layer — no password hash, ever. */
export interface AuthenticatedUser {
  id: string
  email: string
}

export interface IssuedSession {
  token: string
  expiresAt: Date
}

export interface AuthResult {
  user: AuthenticatedUser
  session: IssuedSession
}

const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  )
}

async function issueSession(userId: string): Promise<IssuedSession> {
  const token = createSessionToken()
  const expiresAt = sessionExpiryFrom(new Date(), sessionTtlDays())
  await getDb().insert(sessions).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  })
  return { token, expiresAt }
}

export async function registerUser(input: unknown): Promise<AuthResult> {
  const { email, password } = parseCredentials(input)
  const passwordHash = await hashPassword(password)

  try {
    const inserted = await getDb()
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id, email: users.email })
    const user = inserted[0]
    if (!user) throw new Error('user insert returned no row')
    return { user, session: await issueSession(user.id) }
  } catch (error) {
    // The unique index on users.email is the single source of truth for "already taken":
    // a pre-check would race two concurrent registrations.
    if (isUniqueViolation(error)) {
      throw new AuthError('email_taken', 'An account with that email already exists')
    }
    throw error
  }
}

export async function loginUser(input: unknown): Promise<AuthResult> {
  const { email, password } = parseCredentials(input)

  const found = await getDb()
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  const record = found[0]
  if (!record) {
    // Hash anyway so a missing account and a wrong password take comparable time,
    // and report the same error either way: no account enumeration.
    await hashPassword(password)
    throw new AuthError('invalid_credentials', 'Email or password is incorrect')
  }

  const passwordMatches = await verifyPassword(password, record.passwordHash)
  if (!passwordMatches) {
    throw new AuthError('invalid_credentials', 'Email or password is incorrect')
  }

  return {
    user: { id: record.id, email: record.email },
    session: await issueSession(record.id),
  }
}

/** Resolves a raw cookie token to its user, or null when absent, unknown, or expired. */
export async function resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null

  const rows = await getDb()
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date())),
    )
    .limit(1)

  return rows[0] ?? null
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)))
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId))
}

/** Housekeeping for the queue to call: expired rows have no value after their TTL. */
export async function purgeExpiredSessions(now: Date = new Date()): Promise<void> {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, now))
}
