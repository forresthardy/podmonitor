import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import { hashingEmbedding } from './hashing'
import type { EmbeddingProvider } from './types'

/**
 * The default embedding backend: feature hashing computed in-process.
 *
 * Zero cost, zero network dependency, and fully deterministic — which is what makes the
 * linking tests reproducible and keeps the platform's ~$0 marginal-cost goal intact. The
 * tradeoff is real and worth stating: this is a *lexical* embedding, so it links insights
 * that share vocabulary, not insights that share meaning in different words. When that
 * limitation starts costing real links, set `EMBEDDING_PROVIDER=openai` — the vectors are
 * the same width and the rest of the pipeline does not change.
 */
export function createLocalEmbeddingProvider(
  dimensions: number = EMBEDDING_DIMENSIONS,
): EmbeddingProvider {
  return {
    name: 'local',
    model: 'feature-hash-v1',
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => hashingEmbedding(text, dimensions))
    },
  }
}
