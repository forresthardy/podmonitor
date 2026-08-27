import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import {
  episodeInterestMatches,
  episodes,
  interests,
  transcripts,
  type EpisodeInterestMatch,
  type Interest,
} from '@/db/schema'
import { AuthError } from '@/lib/auth/errors'
import { scoreEpisode } from './scoring'

/** Bounds a transcript-scoring pass to a prefix, not the whole (potentially hour-long) transcript. */
const TRANSCRIPT_EXCERPT_CHARS = 8_000

/** How much a confirm/dismiss nudges the matched interest's weight, and its bounds. */
const WEIGHT_TUNE_DELTA = 0.15
const MIN_INTEREST_WEIGHT = 0.1
const MAX_INTEREST_WEIGHT = 10

export interface ReviewQueueItem {
  matchId: string
  episodeId: string
  episodeTitle: string
  episodeDescription: string | null
  publishedAt: Date | null
  score: number
  matchedInterestId: string | null
}

/**
 * Scores one newly-discovered episode against every user who has at least one active
 * interest, and records a decision per user. Idempotent by the `(episode_id, user_id)`
 * unique index: an existing row — including one the user already confirmed or dismissed —
 * is left untouched, so replaying this (retry, duplicate job) never clobbers a decision.
 */
export async function matchEpisodeForAllUsers(episodeId: string): Promise<void> {
  const db = getDb()

  const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId))
  if (!episode) return

  const [transcript] = await db
    .select({ fullText: transcripts.fullText })
    .from(transcripts)
    .where(eq(transcripts.episodeId, episodeId))
  const transcriptExcerpt = transcript?.fullText.slice(0, TRANSCRIPT_EXCERPT_CHARS) ?? null

  const activeInterests = await db.select().from(interests).where(eq(interests.active, true))
  const interestsByUser = new Map<string, Interest[]>()
  for (const interest of activeInterests) {
    const forUser = interestsByUser.get(interest.userId)
    if (forUser) forUser.push(interest)
    else interestsByUser.set(interest.userId, [interest])
  }

  for (const [userId, userInterests] of interestsByUser) {
    const result = scoreEpisode(
      { title: episode.title, description: episode.description, transcriptExcerpt },
      userInterests.map((interest) => ({
        id: interest.id,
        text: interest.text,
        weight: interest.weight,
      })),
    )

    await db
      .insert(episodeInterestMatches)
      .values({
        episodeId,
        userId,
        interestId: result.matchedInterestId,
        score: result.score,
        signal: result.signal,
        decision: result.decision,
      })
      .onConflictDoNothing({
        target: [episodeInterestMatches.episodeId, episodeInterestMatches.userId],
      })
  }
}

/** Every borderline match still awaiting a confirm/dismiss, most-promising first. */
export async function listReviewQueue(userId: string): Promise<ReviewQueueItem[]> {
  const rows = await getDb()
    .select({
      matchId: episodeInterestMatches.id,
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      episodeDescription: episodes.description,
      publishedAt: episodes.publishedAt,
      score: episodeInterestMatches.score,
      matchedInterestId: episodeInterestMatches.interestId,
    })
    .from(episodeInterestMatches)
    .innerJoin(episodes, eq(episodes.id, episodeInterestMatches.episodeId))
    .where(
      and(eq(episodeInterestMatches.userId, userId), eq(episodeInterestMatches.decision, 'review')),
    )
    .orderBy(desc(episodeInterestMatches.score))

  return rows
}

/**
 * Loads a match the given user owns and that is still awaiting review. Scoping the
 * `decision = 'review'` filter into the query (rather than checking it after the fact)
 * means a match belonging to another user, or one already resolved, is indistinguishable
 * from "doesn't exist" — the caller never learns which.
 */
async function loadPendingReviewMatch(userId: string, matchId: string): Promise<EpisodeInterestMatch> {
  const [match] = await getDb()
    .select()
    .from(episodeInterestMatches)
    .where(
      and(
        eq(episodeInterestMatches.id, matchId),
        eq(episodeInterestMatches.userId, userId),
        eq(episodeInterestMatches.decision, 'review'),
      ),
    )
  if (!match) throw new AuthError('not_found', 'No pending review item with that id')
  return match
}

/** Nudges the matched interest's weight, clamped to a sane range. A no-op if there was no match. */
async function tuneInterestWeight(interestId: string | null, delta: number): Promise<void> {
  if (!interestId) return
  const db = getDb()

  const [interest] = await db.select().from(interests).where(eq(interests.id, interestId))
  if (!interest) return

  const nextWeight = Math.min(
    MAX_INTEREST_WEIGHT,
    Math.max(MIN_INTEREST_WEIGHT, interest.weight + delta),
  )
  await db.update(interests).set({ weight: nextWeight }).where(eq(interests.id, interestId))
}

/** Confirming queues the episode for summarization (same effect as an auto-queue) and reinforces the match. */
export async function confirmMatch(userId: string, matchId: string): Promise<EpisodeInterestMatch> {
  const match = await loadPendingReviewMatch(userId, matchId)

  const [updated] = await getDb()
    .update(episodeInterestMatches)
    .set({ decision: 'confirmed', reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(episodeInterestMatches.id, match.id))
    .returning()
  if (!updated) throw new Error('confirm update returned no row')

  await tuneInterestWeight(match.interestId, WEIGHT_TUNE_DELTA)
  return updated
}

/** Dismissing drops the episode and discourages the matched interest slightly. */
export async function dismissMatch(userId: string, matchId: string): Promise<EpisodeInterestMatch> {
  const match = await loadPendingReviewMatch(userId, matchId)

  const [updated] = await getDb()
    .update(episodeInterestMatches)
    .set({ decision: 'dismissed', reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(episodeInterestMatches.id, match.id))
    .returning()
  if (!updated) throw new Error('dismiss update returned no row')

  await tuneInterestWeight(match.interestId, -WEIGHT_TUNE_DELTA)
  return updated
}
