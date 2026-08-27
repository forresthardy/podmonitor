import { LLMRateLimitError } from './errors'

/**
 * Retries a rate-limited call with backoff. This is what makes the free tier usable: Groq
 * (and any provider) throttles bursts, and a single retryable 429 should not fail the
 * whole pg-boss job — only exhausting every attempt should, at which point the job's own
 * retry/backoff policy (`QUEUE_OPTIONS`) takes over on a much longer horizon.
 */
export interface RetryOptions {
  /** Total attempts, including the first. */
  maxAttempts: number
  /** Used when the provider gives no `Retry-After`: exponential, doubling each attempt. */
  baseDelayMs: number
  /** Injectable so tests never actually wait. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep
  let attempt = 0

  for (;;) {
    try {
      return await fn()
    } catch (error) {
      attempt += 1
      if (!(error instanceof LLMRateLimitError) || attempt >= options.maxAttempts) {
        throw error
      }
      const backoffMs = error.retryAfterMs ?? options.baseDelayMs * 2 ** (attempt - 1)
      await sleep(backoffMs)
    }
  }
}
