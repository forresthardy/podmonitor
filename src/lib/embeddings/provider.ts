import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import {
  embeddingModelOverride,
  embeddingProviderName,
  embeddingRequestTimeoutMs,
  requireEnv,
} from '@/lib/env'
import { createLocalEmbeddingProvider } from './local'
import { createOpenAiEmbeddingProvider } from './openai'
import type { EmbeddingProvider } from './types'

/**
 * Builds the active embedding backend from environment config — the one place that reads
 * `EMBEDDING_PROVIDER`.
 *
 * Default: `local`. The platform's cost decision is "roughly zero marginal cost", and a
 * hosted embedding API is the one component of the knowledge base that would charge per
 * insight forever. `local` is deterministic and free; `openai`
 * (`text-embedding-3-small`, ~$0.02 per million tokens at the time of writing) is the
 * semantic upgrade path and is a config change, not a migration — both emit vectors of
 * `EMBEDDING_DIMENSIONS` width.
 *
 * Changing providers changes what similarity scores *mean*, so re-embed existing insights
 * and re-tune `INSIGHT_LINK_THRESHOLD` when you switch.
 */
export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const name = embeddingProviderName()

  switch (name) {
    case 'local':
      return createLocalEmbeddingProvider(EMBEDDING_DIMENSIONS)
    case 'openai':
      return createOpenAiEmbeddingProvider({
        apiKey: requireEnv('OPENAI_API_KEY'),
        model: embeddingModelOverride(),
        timeoutMs: embeddingRequestTimeoutMs(),
        dimensions: EMBEDDING_DIMENSIONS,
      })
  }
}
