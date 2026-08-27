import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/auth/password'

describe('password hashing', () => {
  it('never stores the plaintext', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(hash).not.toContain('correct-horse-battery')
    expect(hash.startsWith('$2')).toBe(true)
  })

  it('salts each hash independently', async () => {
    const [first, second] = await Promise.all([
      hashPassword('correct-horse-battery'),
      hashPassword('correct-horse-battery'),
    ])
    expect(first).not.toEqual(second)
  })

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery')
    await expect(verifyPassword('correct-horse-battery', hash)).resolves.toBe(true)
    await expect(verifyPassword('correct-horse-batteru', hash)).resolves.toBe(false)
  })
})
