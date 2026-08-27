import { cosineSimilarity } from '@/lib/embeddings/hashing'

/**
 * The thresholding half of cross-referencing, kept as pure functions.
 *
 * pgvector does the nearest-neighbour search (it has the index), but *which* neighbours
 * become links is a product decision — a threshold and a cap — and belongs somewhere that
 * can be tested with fixture vectors instead of a database.
 */

export interface ScoredCandidate {
  insightId: string
  /** Cosine similarity in [-1, 1]; normalized vectors in practice keep this in [0, 1]. */
  similarity: number
}

export interface LinkSelectionOptions {
  /** Inclusive: a candidate exactly at the threshold links. */
  threshold: number
  /** Upper bound on links kept for one insight, applied after thresholding. */
  maxLinks: number
}

export interface EmbeddedCandidate {
  insightId: string
  embedding: number[]
}

/** Scores one insight vector against candidate vectors, strongest first. */
export function scoreCandidates(
  embedding: number[],
  candidates: readonly EmbeddedCandidate[],
): ScoredCandidate[] {
  return candidates
    .map((candidate) => ({
      insightId: candidate.insightId,
      similarity: cosineSimilarity(embedding, candidate.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
}

/**
 * Keeps the candidates worth linking: at or above `threshold`, strongest first, at most
 * `maxLinks`. A non-positive `maxLinks` links nothing — a caller that disabled linking
 * gets no links rather than an accidental unbounded list.
 */
export function selectLinkCandidates(
  candidates: readonly ScoredCandidate[],
  options: LinkSelectionOptions,
): ScoredCandidate[] {
  if (options.maxLinks <= 0) return []

  return [...candidates]
    .filter((candidate) => candidate.similarity >= options.threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, options.maxLinks)
}
