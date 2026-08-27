import { and, asc, eq, gte, lt } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { episodes, podcasts, summaries, users } from '@/db/schema'
import type { DigestSourceRow } from './assemble'

/**
 * Accounts the weekly digest should go to.
 *
 * Filtered here rather than at send time so the opt-out in settings actually stops work:
 * a user who turned the digest off is never assembled for, never rendered, never queued.
 */
export async function listSubscribedUserIds(db: Database): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.weeklyDigestOptIn, true))
  return rows.map((row) => row.id)
}

/**
 * Every (episode, summary) pair created for `userId` inside `[window.start, window.end)`,
 * oldest first (the digest itself re-sorts newest-first for display).
 */
export async function loadDigestSourceRows(
  db: Database,
  userId: string,
  window: { start: Date; end: Date },
): Promise<DigestSourceRow[]> {
  return db
    .select({
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      podcastTitle: podcasts.title,
      publishedAt: episodes.publishedAt,
      summaryTldr: summaries.tldr,
      summaryInsights: summaries.insights,
    })
    .from(summaries)
    .innerJoin(episodes, eq(episodes.id, summaries.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(
      and(
        eq(summaries.userId, userId),
        gte(summaries.createdAt, window.start),
        lt(summaries.createdAt, window.end),
      ),
    )
    .orderBy(asc(episodes.publishedAt))
}
