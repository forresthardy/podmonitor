/**
 * Interest-matching scoring: cheap first, transcript-based only when ambiguous.
 *
 * Similarity is computed with the shared feature-hashing embedding in
 * `src/lib/embeddings/hashing.ts` (the "hashing trick", Weinberger et al.): deterministic,
 * zero-cost, zero network dependency — which is what both the project's ~$0 goal and these
 * unit tests need. It is lexical rather than semantic, and the knowledge base's provider
 * factory (`src/lib/embeddings/provider.ts`) is where a hosted embedding API gets swapped
 * in when semantics start to matter.

 */
import { cosineSimilarity, hashingEmbedding } from '@/lib/embeddings/hashing'

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

/**
 * Delegates to the shared feature-hashing embedding (`src/lib/embeddings/hashing.ts`),
 * which the knowledge base also uses at its own width. Same technique, one implementation.
 */
export function embedText(text: string, dimensions = DEFAULT_DIMENSIONS): number[] {
  return hashingEmbedding(text, dimensions)
}

export { cosineSimilarity }

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
