import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/db/client'
import { sessions, users } from '@/db/schema'
import { AuthError } from '@/lib/auth/errors'
import {
  loginUser,
  purgeExpiredSessions,
  registerUser,
  resolveSession,
  revokeAllSessions,
  revokeSession,
} from '@/lib/auth/service'
import { hashSessionToken } from '@/lib/auth/session-token'
import { resetDatabase } from '../helpers/db'

const READER = { email: 'reader@example.com', password: 'a-strong-passphrase' }

beforeEach(async () => {
  await resetDatabase()
})

describe('registerUser', () => {
  it('creates the user, issues a session, and stores only a bcrypt hash', async () => {
    const { user, session } = await registerUser(READER)

    expect(user).toEqual({ id: expect.any(String), email: READER.email })
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const stored = await getDb().select().from(users).where(eq(users.id, user.id))
    expect(stored[0]?.passwordHash).toMatch(/^\$2[aby]\$/)
    expect(stored[0]?.passwordHash).not.toBe(READER.password)
  })

  it('stores the session token hashed, never in the clear', async () => {
    const { session } = await registerUser(READER)
    const rows = await getDb().select().from(sessions)

    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenHash).toBe(hashSessionToken(session.token))
    expect(rows[0]?.tokenHash).not.toBe(session.token)
  })

  it('rejects a duplicate email regardless of case', async () => {
    await registerUser(READER)
    await expect(registerUser({ ...READER, email: 'Reader@Example.com' })).rejects.toMatchObject({
      code: 'email_taken',
    })
  })

  it('rejects a password below the minimum length', async () => {
    await expect(registerUser({ email: READER.email, password: 'short' })).rejects.toBeInstanceOf(
      AuthError,
    )
    expect(await getDb().select().from(users)).toHaveLength(0)
  })
})

describe('loginUser', () => {
  beforeEach(async () => {
    await registerUser(READER)
  })

  it('accepts the correct password and issues a second, distinct session', async () => {
    const { session: first } = await loginUser(READER)
    const { session: second } = await loginUser({ ...READER, email: 'READER@example.com' })

    expect(first.token).not.toBe(second.token)
    expect(await getDb().select().from(sessions)).toHaveLength(3) // one from register, two logins
  })

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = loginUser({ email: READER.email, password: 'not-the-passphrase' })
    const unknownAccount = loginUser({ email: 'nobody@example.com', password: 'a-strong-passphrase' })

    await expect(wrongPassword).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(unknownAccount).rejects.toMatchObject({ code: 'invalid_credentials' })
  })
})

describe('sessions', () => {
  it('resolves a live session to its user', async () => {
    const { user, session } = await registerUser(READER)
    await expect(resolveSession(session.token)).resolves.toEqual(user)
  })

  it('resolves nothing for a missing, unknown, or expired token', async () => {
    const { user, session } = await registerUser(READER)

    await expect(resolveSession(undefined)).resolves.toBeNull()
    await expect(resolveSession('not-a-real-token')).resolves.toBeNull()

    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sessions.userId, user.id))
    await expect(resolveSession(session.token)).resolves.toBeNull()
  })

  it('revokes one session without touching the others', async () => {
    const { session: first } = await registerUser(READER)
    const { session: second } = await loginUser(READER)

    await revokeSession(first.token)

    await expect(resolveSession(first.token)).resolves.toBeNull()
    await expect(resolveSession(second.token)).resolves.not.toBeNull()
  })

  it('revokes every session for a user and purges expired rows', async () => {
    const { user, session } = await registerUser(READER)
    await revokeAllSessions(user.id)
    await expect(resolveSession(session.token)).resolves.toBeNull()

    const { session: fresh } = await loginUser(READER)
    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sessions.userId, user.id))
    await purgeExpiredSessions()

    expect(await getDb().select().from(sessions)).toHaveLength(0)
    await expect(resolveSession(fresh.token)).resolves.toBeNull()
  })
})
