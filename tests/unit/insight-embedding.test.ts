import { describe, expect, it, vi } from 'vitest'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import { cosineSimilarity, hashingEmbedding } from '@/lib/embeddings/hashing'
import { createLocalEmbeddingProvider } from '@/lib/embeddings/local'
import { createOpenAiEmbeddingProvider } from '@/lib/embeddings/openai'
import { EmbeddingProviderError } from '@/lib/embeddings/errors'

/** L2 norm; every provider here must return unit vectors so cosine == dot product. */
function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}

describe('hashingEmbedding', () => {
  it('is deterministic and unit-length at the stored column width', async () => {
    const first = hashingEmbedding('Distribution moats compound faster than product moats.', EMBEDDING_DIMENSIONS)
    const second = hashingEmbedding('Distribution moats compound faster than product moats.', EMBEDDING_DIMENSIONS)

    expect(first).toEqual(second)
    expect(first).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(norm(first)).toBeCloseTo(1, 10)
  })

  it('scores restatements far above unrelated text', () => {
    const original = hashingEmbedding('Distribution moats compound faster than product moats', 256)
    const restated = hashingEmbedding('Distribution moats compound faster than any product moats', 256)
    const unrelated = hashingEmbedding('Morning sunlight regulates the circadian clock', 256)

    expect(cosineSimilarity(original, restated)).toBeGreaterThan(0.85)
    expect(cosineSimilarity(original, unrelated)).toBeLessThan(0.2)
  })

  it('returns a zero vector for text with no usable tokens rather than throwing', () => {
    const vector = hashingEmbedding('!!! ?', 16)
    expect(vector).toEqual(new Array<number>(16).fill(0))
  })
})

describe('cosineSimilarity', () => {
  it('matches hand-computed values on fixture vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 10)
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10)
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 10)
    // 0.6/0.8 right triangle: dot product is 0.6.
    expect(cosineSimilarity([1, 0], [0.6, 0.8])).toBeCloseTo(0.6, 10)
  })

  it('ignores trailing dimensions the shorter vector does not have', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 99])).toBeCloseTo(1, 10)
  })
})

describe('createLocalEmbeddingProvider', () => {
  it('embeds a batch in input order at the declared width', async () => {
    const provider = createLocalEmbeddingProvider(64)
    const vectors = await provider.embed(['pricing strategy', 'ai agents in production'])

    expect(provider.name).toBe('local')
    expect(provider.dimensions).toBe(64)
    expect(vectors).toHaveLength(2)
    expect(vectors[0]).toEqual(hashingEmbedding('pricing strategy', 64))
    expect(vectors[1]).toEqual(hashingEmbedding('ai agents in production', 64))
  })

  it('defaults to the width of the insights.embedding column', async () => {
    const [vector] = await createLocalEmbeddingProvider().embed(['one insight'])
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS)
  })
})

describe('createOpenAiEmbeddingProvider', () => {
  const options = { apiKey: 'test-key', timeoutMs: 1_000, dimensions: 3 }

  it('normalizes vectors and restores input order from the response index', async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 3, 0] },
            { index: 0, embedding: [4, 0, 0] },
          ],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const vectors = await createOpenAiEmbeddingProvider(options).embed(['first', 'second'])

    expect(vectors).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ])
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      model: string
      dimensions: number
      input: string[]
    }
    // The column width is fixed, so the request must always pin `dimensions`.
    expect(body).toMatchObject({ model: 'text-embedding-3-small', dimensions: 3, input: ['first', 'second'] })

    vi.unstubAllGlobals()
  })

  it('raises rather than returning short results when the provider drops an input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }] }), { status: 200 })),
    )

    await expect(createOpenAiEmbeddingProvider(options).embed(['a', 'b'])).rejects.toThrow(
      EmbeddingProviderError,
    )

    vi.unstubAllGlobals()
  })

  it('surfaces a non-2xx response with its status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })))

    await expect(createOpenAiEmbeddingProvider(options).embed(['a'])).rejects.toThrow(/HTTP 429/)

    vi.unstubAllGlobals()
  })

  it('never calls the API for an empty batch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await createOpenAiEmbeddingProvider(options).embed([])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
