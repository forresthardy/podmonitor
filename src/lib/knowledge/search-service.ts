import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { getDb, type Database } from '@/db/client'
import { episodes, insightLinks, insights, podcasts } from '@/db/schema'
import { createEmbeddingProviderFromEnv } from '@/lib/embeddings/provider'
import type { EmbeddingProvider } from '@/lib/embeddings/types'
import type { InsightSearchResult } from './search-view'
import { crossReferenceViewFrom, type CrossReferenceView } from './summary-view'

/**
 * Knowledge-base search and browse.
 *
 * The insight is the unit, not the episode: a year in, the question is "what do I know
 * about pricing power", and the answer should arrive as the sentence itself with a way back
 * to where it was said. Search is kNN over the same embeddings the linking job writes, so a
 * query matches meaning rather than shared words.
 *
 * `user_id = $userId` is a predicate on every query here, including the cross-reference
 * lookup: one reader's archive is never a source of another reader's results.
 */

const DEFAULT_SEARCH_LIMIT = 20
const DEFAULT_BROWSE_LIMIT = 20

interface InsightRow {
  insightId: string
  ordinal: number
  text: string
  context: string | null
  timestampSec: number | null
  summaryId: string
  episodeId: string
  episodeTitle: string
  podcastTitle: string
  publishedAt: Date | null
}

/**
 * The one row shape both browse and search hydrate through, so the two paths cannot render
 * differently. `where` arrives whole rather than being chained on by the caller: Drizzle
 * allows only one `.where` per builder, and an accidental second call would silently drop
 * the user predicate that makes this query safe.
 */
function selectInsightRows(db: Database, where: SQL | undefined) {
  return db
    .select({
      insightId: insights.id,
      ordinal: insights.ordinal,
      text: insights.text,
      context: insights.context,
      timestampSec: insights.timestampSec,
      summaryId: insights.summaryId,
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      podcastTitle: podcasts.title,
      publishedAt: episodes.publishedAt,
    })
    .from(insights)
    .innerJoin(episodes, eq(episodes.id, insights.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(where)
}

/**
 * The cross-reference callouts for a set of insights, keyed by insight id.
 *
 * Loaded in one query for the whole result page rather than per row: a 20-result page was
 * otherwise 20 round trips, and the join is the same one either way.
 */
async function loadCalloutsByInsight(
  db: Database,
  userId: string,
  insightIds: string[],
): Promise<Map<string, CrossReferenceView[]>> {
  const byInsight = new Map<string, CrossReferenceView[]>()
  if (insightIds.length === 0) return byInsight

  const rows = await db
    .select({
      insightId: insightLinks.insightId,
      relation: insightLinks.relation,
      score: insightLinks.score,
      relatedInsightId: insights.id,
      relatedSummaryId: insights.summaryId,
      relatedOrdinal: insights.ordinal,
      relatedText: insights.text,
      relatedEpisodeTitle: episodes.title,
      relatedPublishedAt: episodes.publishedAt,
    })
    .from(insightLinks)
    .innerJoin(insights, eq(insights.id, insightLinks.relatedInsightId))
    .innerJoin(episodes, eq(episodes.id, insights.episodeId))
    // The related insight is the one being read out, so its owner is the one to check.
    .where(and(inArray(insightLinks.insightId, insightIds), eq(insights.userId, userId)))
    .orderBy(desc(insightLinks.score))

  for (const row of rows) {
    const view = crossReferenceViewFrom({
      relation: row.relation,
      score: row.score,
      relatedInsightId: row.relatedInsightId,
      relatedSummaryId: row.relatedSummaryId,
      relatedOrdinal: row.relatedOrdinal,
      relatedEpisodeTitle: row.relatedEpisodeTitle,
      relatedText: row.relatedText,
      relatedPublishedAt: row.relatedPublishedAt,
    })
    const existing = byInsight.get(row.insightId)
    if (existing) existing.push(view)
    else byInsight.set(row.insightId, [view])
  }

  return byInsight
}

async function toResults(
  db: Database,
  userId: string,
  rows: InsightRow[],
): Promise<InsightSearchResult[]> {
  const callouts = await loadCalloutsByInsight(
    db,
    userId,
    rows.map((row) => row.insightId),
  )

  return rows.map((row) => ({
    insightId: row.insightId,
    ordinal: row.ordinal,
    text: row.text,
    context: row.context,
    timestampSec: row.timestampSec,
    summaryId: row.summaryId,
    episodeId: row.episodeId,
    episodeTitle: row.episodeTitle,
    podcastTitle: row.podcastTitle,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    crossReferences: callouts.get(row.insightId) ?? [],
  }))
}

/** The browse feed: the reader's most recent insights, newest first. */
export async function browseInsights(
  userId: string,
  options: { limit?: number; db?: Database } = {},
): Promise<InsightSearchResult[]> {
  const db = options.db ?? getDb()
  const rows = await selectInsightRows(db, eq(insights.userId, userId))
    .orderBy(desc(insights.createdAt), desc(insights.ordinal))
    .limit(options.limit ?? DEFAULT_BROWSE_LIMIT)

  return toResults(db, userId, rows)
}

export async function searchInsights(
  userId: string,
  query: string,
  options: { limit?: number; db?: Database; embeddings?: EmbeddingProvider } = {},
): Promise<InsightSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const db = options.db ?? getDb()
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT
  const provider = options.embeddings ?? createEmbeddingProviderFromEnv()

  const [queryEmbedding] = await provider.embed([trimmed])
  if (!queryEmbedding) throw new Error('embedding provider returned no vector for the query')

  const literal = `[${queryEmbedding.join(',')}]`

  // Ordering happens in SQL because pgvector's index does; ranked ids then hydrate through
  // the same row shape browse uses, so the two paths cannot render differently.
  const ranked = await db.execute<{ id: string }>(sql`
    select id::text as id
    from insights
    where user_id = ${userId}
      and embedding is not null
    order by embedding <=> ${literal}::vector
    limit ${limit}
  `)

  const rankedIds = ranked.rows.map((row) => row.id)
  if (rankedIds.length === 0) return []

  const rows = await selectInsightRows(
    db,
    and(eq(insights.userId, userId), inArray(insights.id, rankedIds)),
  )

  const position = new Map(rankedIds.map((id, index) => [id, index]))
  const ordered = [...rows].sort(
    (a, b) => (position.get(a.insightId) ?? 0) - (position.get(b.insightId) ?? 0),
  )

  return toResults(db, userId, ordered)
}
