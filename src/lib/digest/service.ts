import { and, asc, eq, gte, lt } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { episodes, podcasts, summaries, users } from '@/db/schema'
import type { DigestSourceRow } from './assemble'

/** Every account is implicitly subscribed to the weekly digest — there is no opt-out flag yet. */
export async function listSubscribedUserIds(db: Database): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users)
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
