import { desc, eq } from 'drizzle-orm'
import { getDb, type Database } from '@/db/client'
import { episodes, podcasts, summaries, type SummaryInsight, type SummaryQuote } from '@/db/schema'
import { listSummaryCrossReferences, type CrossReference } from './cross-references'

/**
 * Read model for the summary view: a stored summary plus the cross-reference callouts the
 * linking job produced for it. The UI renders `crossReferences[].callout` under the insight
 * whose `ordinal` it names — the join and the wording live here so the web view and the
 * weekly digest email cannot drift apart.
 */

export interface SummaryWithCrossReferences {
  id: string
  episodeId: string
  episodeTitle: string
  podcastTitle: string
  publishedAt: Date | null
  tldr: string
  insights: SummaryInsight[]
  quotes: SummaryQuote[]
  topics: string[]
  createdAt: Date
  crossReferences: CrossReference[]
}

/** Newest first; `limit` keeps an ever-growing library from becoming an unbounded query. */
export async function listUserSummaries(
  userId: string,
  options: { limit?: number; db?: Database } = {},
): Promise<SummaryWithCrossReferences[]> {
  const db = options.db ?? getDb()
  const limit = options.limit ?? 20

  const rows = await db
    .select({
      id: summaries.id,
      episodeId: summaries.episodeId,
      episodeTitle: episodes.title,
      podcastTitle: podcasts.title,
      publishedAt: episodes.publishedAt,
      tldr: summaries.tldr,
      insights: summaries.insights,
      quotes: summaries.quotes,
      topics: summaries.topics,
      createdAt: summaries.createdAt,
    })
    .from(summaries)
    .innerJoin(episodes, eq(episodes.id, summaries.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    // The user id comes from the session, never the request: this is the isolation boundary.
    .where(eq(summaries.userId, userId))
    .orderBy(desc(summaries.createdAt))
    .limit(limit)

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      crossReferences: await listSummaryCrossReferences(row.id, userId, db),
    })),
  )
}
