import { describe, expect, it, vi } from 'vitest'
import { LLMProviderError, LLMRateLimitError } from '@/lib/llm/errors'
import { withRateLimitRetry } from '@/lib/llm/retry'

/**
 * The backoff loop that makes the free tier usable: a rate limit should be absorbed
 * silently up to `maxAttempts`, honoring a provider's own `Retry-After` when given one.
 */

function fakeSleep() {
  const calls: number[] = []
  const sleep = vi.fn(async (ms: number) => {
    calls.push(ms)
  })
  return { sleep, calls }
}

describe('withRateLimitRetry', () => {
  it('returns the result on the first try without sleeping', async () => {
    const { sleep, calls } = fakeSleep()
    const fn = vi.fn(async () => 'ok')

    const result = await withRateLimitRetry(fn, { maxAttempts: 3, baseDelayMs: 100, sleep })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([])
  })

  it('retries after a rate limit and succeeds on the next attempt', async () => {
    const { sleep } = fakeSleep()
    let attempts = 0
    const fn = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new LLMRateLimitError('rate limited', 'test')
      return 'ok'
    })

    const result = await withRateLimitRetry(fn, { maxAttempts: 3, baseDelayMs: 100, sleep })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('honors the provider\'s retryAfterMs instead of the computed backoff', async () => {
    const { sleep, calls } = fakeSleep()
    let attempts = 0
    const fn = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new LLMRateLimitError('rate limited', 'test', 750)
      return 'ok'
    })

    await withRateLimitRetry(fn, { maxAttempts: 3, baseDelayMs: 100, sleep })

    expect(calls).toEqual([750])
  })

  it('falls back to exponential backoff (doubling each attempt) with no retryAfterMs', async () => {
    const { sleep, calls } = fakeSleep()
    let attempts = 0
    const fn = vi.fn(async () => {
      attempts += 1
      if (attempts <= 3) throw new LLMRateLimitError('rate limited', 'test')
      return 'ok'
    })

    await withRateLimitRetry(fn, { maxAttempts: 5, baseDelayMs: 100, sleep })

    expect(calls).toEqual([100, 200, 400])
  })

  it('gives up and rethrows once maxAttempts is exhausted', async () => {
    const { sleep } = fakeSleep()
    const fn = vi.fn(async () => {
      throw new LLMRateLimitError('always limited', 'test')
    })

    await expect(
      withRateLimitRetry(fn, { maxAttempts: 3, baseDelayMs: 10, sleep }),
    ).rejects.toBeInstanceOf(LLMRateLimitError)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-rate-limit error', async () => {
    const { sleep } = fakeSleep()
    const fn = vi.fn(async () => {
      throw new LLMProviderError('server exploded', 'test', 500)
    })

    await expect(
      withRateLimitRetry(fn, { maxAttempts: 3, baseDelayMs: 10, sleep }),
    ).rejects.toBeInstanceOf(LLMProviderError)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
