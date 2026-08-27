import { eq } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { episodeInterestMatches, episodes, interests, transcripts, type Interest } from '@/db/schema'
import { scoreEpisode } from './scoring'

/** Bounds a transcript-scoring pass to a prefix, not the whole (potentially hour-long) transcript. */
const TRANSCRIPT_EXCERPT_CHARS = 8_000

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
