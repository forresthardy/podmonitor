import { aliasedTable, and, asc, eq } from 'drizzle-orm'
import { getDb, type Database } from '@/db/client'
import { episodes, insightLinks, insights, podcasts } from '@/db/schema'
import type { InsightRelation } from './relation'

/**
 * The knowledge-base read path: the cross-reference callouts a summary carries.
 *
 * This is what turns the archive into something that compounds — reading a new summary
 * tells you, inline, that its third insight contradicts something you captured in March.
 * The rendering itself stays in the UI; what this module owns is the data and the one
 * sentence that is identical wherever it is shown (web, and the weekly digest email).
 */

export interface RelatedInsight {
  insightId: string
  /** The "#N" the callout cites: the insight's position in the summary it came from. */
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

export interface CrossReference {
  /** The insight in *this* summary that triggered the callout. */
  insightId: string
  insightOrdinal: number
  relation: InsightRelation
  /** Cosine similarity that cleared the link threshold. */
  score: number
  related: RelatedInsight
  /** Ready-to-render sentence, e.g. `This echoes insight #2 from "Standard Oil", Nov 2025`. */
  callout: string
}

const RELATION_VERB: Record<InsightRelation, string> = {
  extends: 'extends',
  contradicts: 'contradicts',
  echoes: 'echoes',
}

/** Month + year is the right resolution for "when did I read this" — a day is noise. */
function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * The callout sentence. A missing publish date drops the date clause rather than printing
 * a placeholder: feeds do sometimes omit `pubDate`, and "from X, Invalid Date" is worse
 * than no date at all.
 */
export function formatCallout(
  relation: InsightRelation,
  related: Pick<RelatedInsight, 'ordinal' | 'episodeTitle' | 'publishedAt'>,
): string {
  const when = related.publishedAt ? `, ${formatMonthYear(related.publishedAt)}` : ''
  return `This ${RELATION_VERB[relation]} insight #${related.ordinal} from “${related.episodeTitle}”${when}`
}

/**
 * Every cross-reference attached to one summary, strongest link first per insight.
 *
 * `userId` is required rather than derived from the summary row: the caller always knows
 * who is asking, and making the check a predicate means an id from another user's summary
 * returns nothing instead of leaking a callout.
 */
export async function listSummaryCrossReferences(
  summaryId: string,
  userId: string,
  db: Database = getDb(),
): Promise<CrossReference[]> {
  const related = aliasedTable(insights, 'related_insight')

  const rows = await db
    .select({
      insightId: insights.id,
      insightOrdinal: insights.ordinal,
      relation: insightLinks.relation,
      score: insightLinks.score,
      relatedInsightId: related.id,
      relatedOrdinal: related.ordinal,
      relatedText: related.text,
      relatedContext: related.context,
      relatedTimestampSec: related.timestampSec,
      relatedSummaryId: related.summaryId,
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      podcastTitle: podcasts.title,
      publishedAt: episodes.publishedAt,
    })
    .from(insightLinks)
    .innerJoin(insights, eq(insights.id, insightLinks.insightId))
    .innerJoin(related, eq(related.id, insightLinks.relatedInsightId))
    .innerJoin(episodes, eq(episodes.id, related.episodeId))
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(and(eq(insights.summaryId, summaryId), eq(insights.userId, userId)))
    .orderBy(asc(insights.ordinal))

  return rows
    .map((row) => {
      const relatedInsight: RelatedInsight = {
        insightId: row.relatedInsightId,
        ordinal: row.relatedOrdinal,
        text: row.relatedText,
        context: row.relatedContext,
        timestampSec: row.relatedTimestampSec,
        summaryId: row.relatedSummaryId,
        episodeId: row.episodeId,
        episodeTitle: row.episodeTitle,
        podcastTitle: row.podcastTitle,
        publishedAt: row.publishedAt,
      }

      return {
        insightId: row.insightId,
        insightOrdinal: row.insightOrdinal,
        relation: row.relation,
        score: row.score,
        related: relatedInsight,
        callout: formatCallout(row.relation, relatedInsight),
      }
    })
    .sort((a, b) =>
      a.insightOrdinal === b.insightOrdinal
        ? b.score - a.score
        : a.insightOrdinal - b.insightOrdinal,
    )
}
