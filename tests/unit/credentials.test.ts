import { describe, expect, it } from 'vitest'
import { normalizeEmail, parseCredentials } from '@/lib/auth/credentials'
import { AuthError } from '@/lib/auth/errors'

describe('credential parsing', () => {
  it('normalizes the email', () => {
    const parsed = parseCredentials({ email: '  Reader@Example.COM ', password: 'a-good-password' })
    expect(parsed.email).toBe('reader@example.com')
    expect(normalizeEmail(' READER@Example.com ')).toBe('reader@example.com')
  })

  it.each([
    ['not-an-email', 'a-good-password'],
    ['reader@example.com', 'short'],
    ['', 'a-good-password'],
  ])('rejects invalid input (%s / %s)', (email, password) => {
    expect(() => parseCredentials({ email, password })).toThrowError(AuthError)
  })

  it('rejects a non-object payload', () => {
    expect(() => parseCredentials(null)).toThrowError(AuthError)
  })
})
