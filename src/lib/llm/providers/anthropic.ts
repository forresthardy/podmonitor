import { LLMProviderError, LLMRateLimitError } from '../errors'
import type { LLMCompletionRequest, LLMProvider } from '../types'

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
export const ANTHROPIC_API_VERSION = '2023-06-01'

/** Small and cheap; the summarization prompt doesn't need a frontier model. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-haiku-20241022'

export interface AnthropicProviderOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  timeoutMs?: number
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number.parseFloat(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

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

/**
 * Anthropic's Messages API is not OpenAI-compatible: the system prompt is a top-level
 * field rather than a `system` message, and the response is a content-block array rather
 * than a `choices[0].message.content` string.
 */
export function createAnthropicProvider(options: AnthropicProviderOptions): LLMProvider {
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL
  const baseUrl = options.baseUrl ?? ANTHROPIC_BASE_URL
  const timeoutMs = options.timeoutMs ?? 60_000

  return {
    name: 'anthropic',
    model,
    async complete(request: LLMCompletionRequest): Promise<string> {
      const endpoint = new URL('v1/messages', `${baseUrl.replace(/\/+$/, '')}/`)
      const signal = AbortSignal.timeout(timeoutMs)

      const systemPrompt = request.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n')
      const userMessages = request.messages
        .filter((message) => message.role === 'user')
        .map((message) => ({ role: 'user' as const, content: message.content }))

      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify({
            model,
            system: systemPrompt || undefined,
            messages: userMessages,
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens ?? 2048,
          }),
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new LLMProviderError(`anthropic request failed: ${detail}`, 'anthropic')
      }

      if (response.status === 429) {
        const body = await response.text().catch(() => '')
        throw new LLMRateLimitError(
          `anthropic rate limit hit: ${errorDetail(body) || '(no detail)'}`,
          'anthropic',
          retryAfterMs(response),
        )
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new LLMProviderError(
          `anthropic returned HTTP ${response.status}: ${errorDetail(body) || '(no detail)'}`,
          'anthropic',
          response.status,
        )
      }

      const payload: unknown = await response.json().catch(() => undefined)
      const blocks = (payload as { content?: Array<{ type?: string; text?: unknown }> })
        ?.content
      const text = blocks
        ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('')

      if (!text || text.trim() === '') {
        throw new LLMProviderError('anthropic returned no text content', 'anthropic')
      }

      return text
    },
  }
}
