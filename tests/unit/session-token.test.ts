import { describe, expect, it } from 'vitest'
import {
  createSessionToken,
  hashSessionToken,
  sessionExpiryFrom,
} from '@/lib/auth/session-token'

describe('session tokens', () => {
  it('mints unique, URL-safe, high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => createSessionToken()))
    expect(tokens.size).toBe(100)
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })

  it('hashes deterministically and never reveals the token', () => {
    const token = createSessionToken()
    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
    expect(hashSessionToken(token)).not.toContain(token)
    expect(hashSessionToken(token)).toHaveLength(64)
  })

  it('computes the expiry from the TTL in days', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(sessionExpiryFrom(now, 30).toISOString()).toBe('2026-01-31T00:00:00.000Z')
  })
})
