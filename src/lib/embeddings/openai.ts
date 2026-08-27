import { EmbeddingProviderError } from './errors'
import type { EmbeddingProvider } from './types'

/**
 * OpenAI's `/v1/embeddings` adapter. `text-embedding-3-small` is the default because it
 * natively returns 1536 dimensions — the width `insights.embedding` was declared with —
 * so switching providers needs no migration. Larger models can be pointed at the same
 * width via the API's `dimensions` parameter, which is why it is always sent.
 */

const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export interface OpenAiEmbeddingOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  timeoutMs: number
  dimensions: number
}

interface EmbeddingResponseItem {
  index: number
  embedding: number[]
}

/** Vectors are stored and compared as cosine similarity; normalize once, at the edge. */
function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

function parseVectors(payload: unknown, expected: number, provider: string): number[][] {
  const data = (payload as { data?: EmbeddingResponseItem[] })?.data
  if (!Array.isArray(data) || data.length !== expected) {
    throw new EmbeddingProviderError(
      `${provider} returned ${Array.isArray(data) ? data.length : 0} embeddings for ${expected} inputs`,
      provider,
    )
  }

  // The API documents index ordering but does not guarantee response order; sorting by
  // index is what makes "one vector per input, in input order" true rather than assumed.
  return [...data]
    .sort((a, b) => a.index - b.index)
    .map((item) => {
      if (!Array.isArray(item.embedding)) {
        throw new EmbeddingProviderError(`${provider} returned a non-array embedding`, provider)
      }
      return normalize(item.embedding)
    })
}

export function createOpenAiEmbeddingProvider(
  options: OpenAiEmbeddingOptions,
): EmbeddingProvider {
  const model = options.model ?? DEFAULT_MODEL
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL

  return {
    name: 'openai',
    model,
    dimensions: options.dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return []

      const endpoint = new URL('embeddings', `${baseUrl.replace(/\/+$/, '')}/`)

      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(options.timeoutMs),
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({ model, input: texts, dimensions: options.dimensions }),
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new EmbeddingProviderError(`openai embedding request failed: ${detail}`, 'openai')
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new EmbeddingProviderError(
          `openai embeddings returned HTTP ${response.status}: ${body || '(no detail)'}`,
          'openai',
          response.status,
        )
      }

      const payload: unknown = await response.json().catch(() => undefined)
      return parseVectors(payload, texts.length, 'openai')
    },
  }
}
