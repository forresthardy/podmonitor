/** Base error for any provider failure — network, non-2xx, or an unparseable response. */
export class LLMProviderError extends Error {
  readonly provider: string
  readonly status?: number

  constructor(message: string, provider: string, status?: number) {
    super(message)
    this.name = 'LLMProviderError'
    this.provider = provider
    if (status !== undefined) this.status = status
  }
}

/**
 * A 429 (or provider-specific rate-limit signal). Carries `retryAfterMs` when the
 * provider tells us how long to wait — honoring that beats guessing a backoff.
 */
export class LLMRateLimitError extends LLMProviderError {
  readonly retryAfterMs?: number

  constructor(message: string, provider: string, retryAfterMs?: number) {
    super(message, provider, 429)
    this.name = 'LLMRateLimitError'
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}
