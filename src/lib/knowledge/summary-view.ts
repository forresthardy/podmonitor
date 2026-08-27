import { formatCallout, type CrossReference } from './cross-references'
import type { InsightRelation } from './relation'
import type { SummaryWithCrossReferences } from './summary-service'

/**
 * The serializable read model the UI renders.
 *
 * Two things force this layer to exist rather than handing rows straight to components:
 *
 * 1. Dates. A server component can pass a `Date` to a client component only by
 *    serializing it anyway, and the same payload also travels over `/api/summaries`.
 *    ISO strings mean the reading view renders identically from either source.
 * 2. Shape. The store keeps insights (a jsonb array) and their cross-reference links
 *    (a join) apart; the reader shows a callout *under the insight it belongs to*.
 *    Grouping is a pure transformation, so it belongs here where it can be tested,
 *    not inline in a component body.
 */

export interface CrossReferenceView {
  relation: InsightRelation
  score: number
  /** Ready-to-render sentence, identical in the web view and the weekly digest email. */
  callout: string
  relatedInsightId: string
  relatedSummaryId: string
  relatedOrdinal: number
  relatedEpisodeTitle: string
  relatedText: string
}

export interface SummaryInsightView {
  /** 1-based position — the "#N" a callout elsewhere in the knowledge base cites. */
  ordinal: number
  text: string
  context: string
  timestampSec: number | null
  crossReferences: CrossReferenceView[]
}

export interface SummaryQuoteView {
  quote: string
  speaker: string
  timestampSec: number
}

export interface SummaryView {
  id: string
  episodeId: string
  episodeTitle: string
  podcastTitle: string
  publishedAt: string | null
  tldr: string
  insights: SummaryInsightView[]
  quotes: SummaryQuoteView[]
  topics: string[]
  createdAt: string
}

export function toCrossReferenceView(reference: CrossReference): CrossReferenceView {
  return {
    relation: reference.relation,
    score: reference.score,
    callout: reference.callout,
    relatedInsightId: reference.related.insightId,
    relatedSummaryId: reference.related.summaryId,
    relatedOrdinal: reference.related.ordinal,
    relatedEpisodeTitle: reference.related.episodeTitle,
    relatedText: reference.related.text,
  }
}

/**
 * Builds the callout sentence for a link surfaced outside a summary (knowledge-base
 * search results), where the caller has the link and the older insight but no summary
 * context. Delegates the wording to `formatCallout` so there is exactly one phrasing.
 */
export function crossReferenceViewFrom(input: {
  relation: InsightRelation
  score: number
  relatedInsightId: string
  relatedSummaryId: string
  relatedOrdinal: number
  relatedEpisodeTitle: string
  relatedText: string
  relatedPublishedAt: Date | null
}): CrossReferenceView {
  return {
    relation: input.relation,
    score: input.score,
    callout: formatCallout(input.relation, {
      ordinal: input.relatedOrdinal,
      episodeTitle: input.relatedEpisodeTitle,
      publishedAt: input.relatedPublishedAt,
    }),
    relatedInsightId: input.relatedInsightId,
    relatedSummaryId: input.relatedSummaryId,
    relatedOrdinal: input.relatedOrdinal,
    relatedEpisodeTitle: input.relatedEpisodeTitle,
    relatedText: input.relatedText,
  }
}

/**
 * Flattens a stored summary and its links into the reading view's shape.
 *
 * Insight ordinals are the array position + 1, matching how the linking job assigned
 * `insights.ordinal` when it exploded the same jsonb array into rows — that agreement is
 * what lets a callout say "#2" and mean the second insight the reader sees. A callout
 * whose ordinal has no matching insight (a summary rewritten after linking) is dropped
 * rather than rendered under an arbitrary insight.
 */
export function toSummaryView(summary: SummaryWithCrossReferences): SummaryView {
  const byOrdinal = new Map<number, CrossReferenceView[]>()
  for (const reference of summary.crossReferences) {
    const existing = byOrdinal.get(reference.insightOrdinal)
    const view = toCrossReferenceView(reference)
    if (existing) existing.push(view)
    else byOrdinal.set(reference.insightOrdinal, [view])
  }

  return {
    id: summary.id,
    episodeId: summary.episodeId,
    episodeTitle: summary.episodeTitle,
    podcastTitle: summary.podcastTitle,
    publishedAt: summary.publishedAt?.toISOString() ?? null,
    tldr: summary.tldr,
    insights: summary.insights.map((insight, index) => ({
      ordinal: index + 1,
      text: insight.text,
      context: insight.context,
      timestampSec: insight.timestampSec,
      crossReferences: byOrdinal.get(index + 1) ?? [],
    })),
    quotes: summary.quotes.map((quote) => ({
      quote: quote.quote,
      speaker: quote.speaker,
      timestampSec: quote.timestampSec,
    })),
    topics: summary.topics,
    createdAt: summary.createdAt.toISOString(),
  }
}
