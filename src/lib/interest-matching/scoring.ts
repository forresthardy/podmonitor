/**
 * Interest-matching scoring: cheap first, transcript-based only when ambiguous.
 *
 * Provider choice (documented, per spec): embedding-based similarity via a small,
 * deterministic, locally-computed embedding — the "hashing trick" (feature hashing):
 * each token is hashed into one of a fixed number of buckets, bucket counts form the
 * vector, and the vector is L2-normalized so cosine similarity reduces to a dot product.
 * This is a real, standard technique (Weinberger et al., "Feature Hashing for Large Scale
 * Multitask Learning"), not a semantic model — but it is zero-cost, has zero network
 * dependency, and is fully deterministic, which matters for both the project's
 * roughly-zero-marginal-cost goal and for unit-testability. It is intentionally behind
 * the same shape a real embedding provider would have (`embedText`, `cosineSimilarity`),
 * so swapping in a hosted embedding API (OpenAI, Groq, etc.) later is a function-body
 * change, not a call-site rewrite.
 */

const DEFAULT_DIMENSIONS = 256

/** Episode scores at or above this (after weighting) auto-queue for summarization. */
export const AUTO_QUEUE_THRESHOLD = 0.6

/** Episode scores at or above this but below the auto-queue line are borderline. */
export const REVIEW_THRESHOLD = 0.35

export type MatchDecision = 'auto_queued' | 'review' | 'skipped'
export type MatchSignal = 'cheap' | 'transcript'

export interface ScorableInterest {
  id: string
  text: string
  weight: number
}

export interface EpisodeText {
  title: string
  description?: string | null
}

export interface InterestMatchResult {
  /** Clamped to [0, 1]. */
  score: number
  matchedInterestId: string | null
}

export interface ScoringPassResult extends InterestMatchResult {
  decision: MatchDecision
  signal: MatchSignal
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
}

/** FNV-1a: fast, dependency-free, good-enough distribution for a fixed small bucket count. */
function hashToken(token: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic local "embedding": a hashed, L2-normalized bag-of-words vector. */
export function embedText(text: string, dimensions = DEFAULT_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0)
  for (const token of tokenize(text)) {
    const bucket = hashToken(token) % dimensions
    vector[bucket] = (vector[bucket] ?? 0) + 1
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

/** Both inputs are expected L2-normalized, so the dot product is already the cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return dot
}

export function classifyScore(score: number): MatchDecision {
  if (score >= AUTO_QUEUE_THRESHOLD) return 'auto_queued'
  if (score >= REVIEW_THRESHOLD) return 'review'
  return 'skipped'
}

/**
 * Cheap pass: scores an episode's title + description against every active interest and
 * keeps the strongest match. A higher-weighted interest needs a lower raw similarity to
 * clear the same threshold — weight is the user's tuning knob (see review-queue confirm
 * /dismiss, which nudges it).
 */
export function scoreEpisodeText(
  episode: EpisodeText,
  interests: ScorableInterest[],
): InterestMatchResult {
  if (interests.length === 0) return { score: 0, matchedInterestId: null }

  const episodeVector = embedText(`${episode.title} ${episode.description ?? ''}`)

  let best: InterestMatchResult = { score: 0, matchedInterestId: null }
  for (const interest of interests) {
    const similarity = Math.max(0, cosineSimilarity(episodeVector, embedText(interest.text)))
    const weighted = Math.min(1, similarity * interest.weight)
    if (weighted > best.score) best = { score: weighted, matchedInterestId: interest.id }
  }
  return best
}

/**
 * Full scoring pass for one episode: cheap first, transcript-based only when the cheap
 * pass lands in the ambiguous (review) band and a transcript excerpt is available. When
 * no transcript exists yet, an ambiguous cheap score simply stays "review" — that is the
 * borderline case the review queue exists for.
 */
export function scoreEpisode(
  episode: EpisodeText & { transcriptExcerpt?: string | null },
  interests: ScorableInterest[],
): ScoringPassResult {
  const cheap = scoreEpisodeText(episode, interests)
  const cheapDecision = classifyScore(cheap.score)

  if (cheapDecision !== 'review' || !episode.transcriptExcerpt) {
    return { ...cheap, decision: cheapDecision, signal: 'cheap' }
  }

  const transcriptPass = scoreEpisodeText(
    { title: episode.title, description: episode.transcriptExcerpt },
    interests,
  )
  return { ...transcriptPass, decision: classifyScore(transcriptPass.score), signal: 'transcript' }
}
