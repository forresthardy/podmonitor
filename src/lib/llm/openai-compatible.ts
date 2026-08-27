import { LLMProviderError, LLMRateLimitError } from './errors'
import type { LLMCompletionRequest, LLMProvider } from './types'

/**
 * Groq and OpenAI both speak the same `/chat/completions` wire format (Groq is an
 * OpenAI-compatible endpoint), so one implementation backs both adapters. `groq.ts` and
 * `openai.ts` only supply the provider name, base URL, and default model.
 */

export interface OpenAiCompatibleOptions {
  /** e.g. `groq`, `openai` — used in error messages and the `summaries.model` column. */
  name: string
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
}

/** Parses a numeric `Retry-After` header (seconds) into milliseconds. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number.parseFloat(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

/** Pulls a provider's JSON `error.message`, falling back to the raw body. */
function errorDetail(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    const message = (parsed as { error?: { message?: unknown } })?.error?.message
    if (typeof message === 'string') return message
  } catch {
    // Not JSON; the raw body is the best detail available.
  }
  return body
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): LLMProvider {
  return {
    name: options.name,
    model: options.model,
    async complete(request: LLMCompletionRequest): Promise<string> {
      // A relative path (no leading slash) preserves the base's own path segment —
      // Groq's compatible endpoint lives under `/openai/v1`, not the bare origin.
      const endpoint = new URL('chat/completions', `${options.baseUrl.replace(/\/+$/, '')}/`)
      const signal = AbortSignal.timeout(options.timeoutMs)

      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: request.messages,
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens,
            response_format: { type: 'json_object' },
          }),
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new LLMProviderError(
          `${options.name} request failed: ${detail}`,
          options.name,
        )
      }

      if (response.status === 429) {
        const body = await response.text().catch(() => '')
        throw new LLMRateLimitError(
          `${options.name} rate limit hit: ${errorDetail(body) || '(no detail)'}`,
          options.name,
          retryAfterMs(response),
        )
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new LLMProviderError(
          `${options.name} returned HTTP ${response.status}: ${errorDetail(body) || '(no detail)'}`,
          options.name,
          response.status,
        )
      }

      const payload: unknown = await response.json().catch(() => undefined)
      const content = (
        payload as { choices?: Array<{ message?: { content?: unknown } }> }
      )?.choices?.[0]?.message?.content

      if (typeof content !== 'string' || content.trim() === '') {
        throw new LLMProviderError(
          `${options.name} returned no completion content`,
          options.name,
        )
      }

      return content
    },
  }
}
