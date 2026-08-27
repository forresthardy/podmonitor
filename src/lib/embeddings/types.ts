/**
 * The embedding adapter interface.
 *
 * Mirrors `LLMProvider`: the knowledge-base code never learns which backend produced a
 * vector, so switching from the free local embedding to a hosted API is a config change
 * (`EMBEDDING_PROVIDER`), never a code change.
 */
export interface EmbeddingProvider {
  /** Short identifier for logging, e.g. `local`. */
  readonly name: string
  /** The concrete model in use, e.g. `feature-hash-v1` or `text-embedding-3-small`. */
  readonly model: string
  /** Must equal `EMBEDDING_DIMENSIONS`: the `insights.embedding` column is fixed-width. */
  readonly dimensions: number
  /**
   * Embeds a batch of texts, returning one L2-normalized vector per input in input order.
   * Batching is part of the interface because hosted providers charge and rate-limit per
   * request, and one summary produces a handful of insights at once.
   */
  embed(texts: string[]): Promise<number[][]>
}
