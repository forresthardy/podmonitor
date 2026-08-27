import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Database } from '@/db/client'
import { episodeInterestMatches, episodes, podcasts, summaries } from '@/db/schema'
import { AuthError } from '@/lib/auth/errors'
import type { EpisodeLibraryItem } from './types'

/**
 * The episode library read model and the retry action behind the failed-state badge.
 *
 * An episode is in a user's library because *that user* has a match row for it — either
 * auto-queued by scoring or confirmed from the review queue. Episodes matched for someone
 * else are not in the query's result set at all, so isolation here is a join predicate
 * rather than a filter applied after the fact.
 */

const DEFAULT_LIBRARY_LIMIT = 50

/** Decisions that put an episode in the library; `review` and `dismissed` stay out of it. */
const LIBRARY_DECISIONS = ['auto_queued', 'confirmed'] as const

export async function listEpisodeLibrary(
  userId: string,
  options: { limit?: number; db?: Database } = {},
): Promise<EpisodeLibraryItem[]> {
  const db = options.db ?? getDb()

  const rows = await db
    .select({
      episodeId: episodes.id,
      title: episodes.title,
      podcastTitle: podcasts.title,
      publishedAt: episodes.publishedAt,
      durationSec: episodes.durationSec,
      status: episodes.status,
      failureReason: episodes.failureReason,
      transcriptSource: episodes.transcriptSource,
      matchScore: episodeInterestMatches.score,
      decision: episodeInterestMatches.decision,
      // Per-user: the same episode can be summarized for one reader and not another.
      summaryId: sql<string | null>`${summaries.id}`,
    })
    .from(episodeInterestMatches)
    .innerJoin(episodes, eq(episodes.id, episodeInterestMatches.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .leftJoin(
      summaries,
      and(eq(summaries.episodeId, episodes.id), eq(summaries.userId, userId)),
    )
    .where(
      and(
        // The user id comes from the session, never the request: this is the isolation boundary.
        eq(episodeInterestMatches.userId, userId),
        inArray(episodeInterestMatches.decision, [...LIBRARY_DECISIONS]),
      ),
    )
    .orderBy(desc(episodes.publishedAt), desc(episodes.createdAt))
    .limit(options.limit ?? DEFAULT_LIBRARY_LIMIT)

  return rows.map((row) => ({
    episodeId: row.episodeId,
    title: row.title,
    podcastTitle: row.podcastTitle,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    durationSec: row.durationSec,
    status: row.status,
    failureReason: row.status === 'failed' ? row.failureReason : null,
    transcriptSource: row.transcriptSource,
    summaryId: row.summaryId,
    matchScore: row.matchScore,
    confirmedByUser: row.decision === 'confirmed',
  }))
}

export interface RetryEnqueuer {
  (episodeId: string): Promise<void>
}

/**
 * Puts a failed episode back at the start of the pipeline.
 *
 * Two deliberate choices. First, the match row is the permission check: a user who was
 * never matched to the episode gets `not_found`, the same answer as an episode that does
 * not exist, so the endpoint cannot be used to probe which episodes are in the system.
 * Second, the state moves back to `discovered` *before* enqueueing — if the enqueue throws,
 * the reader sees an episode that is queued-looking rather than a lost retry, and the
 * failure surfaces to them instead of being swallowed.
 */
export async function retryFailedEpisode(
  userId: string,
  episodeId: string,
  enqueue: RetryEnqueuer,
  db: Database = getDb(),
): Promise<void> {
  const [match] = await db
    .select({ status: episodes.status })
    .from(episodeInterestMatches)
    .innerJoin(episodes, eq(episodes.id, episodeInterestMatches.episodeId))
    .where(
      and(
        eq(episodeInterestMatches.userId, userId),
        eq(episodeInterestMatches.episodeId, episodeId),
        inArray(episodeInterestMatches.decision, [...LIBRARY_DECISIONS]),
      ),
    )
    .limit(1)

  if (!match) throw new AuthError('not_found', 'Episode not found')

  // Retrying a healthy episode would duplicate work already in flight.
  if (match.status !== 'failed') {
    throw new AuthError('invalid_input', 'Only a failed episode can be retried')
  }

  await db
    .update(episodes)
    .set({ status: 'discovered', failureReason: null, updatedAt: new Date() })
    .where(eq(episodes.id, episodeId))

  await enqueue(episodeId)
}
