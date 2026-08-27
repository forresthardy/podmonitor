/**
 * Deterministic, zero-cost text embedding via the hashing trick (feature hashing:
 * Weinberger et al., "Feature Hashing for Large Scale Multitask Learning"): each token is
 * hashed into one of a fixed number of buckets, bucket counts form the vector, and the
 * vector is L2-normalized so cosine similarity reduces to a dot product.
 *
 * This is the shared implementation behind two callers with different needs:
 * interest matching (256 dimensions, in-process comparison) and the knowledge base
 * (`EMBEDDING_DIMENSIONS`, stored in pgvector). It is lexical, not semantic — see
 * `src/lib/embeddings/provider.ts` for why it is nonetheless the default.
 */

/** Lowercases, strips punctuation, and drops single-character tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
}

/** FNV-1a: fast, dependency-free, good-enough distribution for a fixed bucket count. */
export function hashToken(token: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A hashed, L2-normalized bag-of-words vector. All-stopword input yields a zero vector. */
export function hashingEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0)
  for (const token of tokenize(text)) {
    const bucket = hashToken(token) % dimensions
    vector[bucket] = (vector[bucket] ?? 0) + 1
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

/**
 * Cosine similarity. Vectors from every provider here are L2-normalized, so this is the
 * dot product; normalizing again would cost a pass for no change in the result.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return dot
}
