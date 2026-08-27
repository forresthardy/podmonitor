import type { CrossReferenceView } from './summary-view'

/**
 * One insight as the knowledge base shows it — in search results or in the browse feed.
 *
 * The insight, not the summary, is the unit here: a year from now the question is "what do
 * I know about pricing power", not "which episode was that". Each result carries enough
 * provenance to jump back to the summary at the right timestamp, plus the cross-reference
 * callouts linking it to older insights.
 */
export interface InsightSearchResult {
  insightId: string
  /** 1-based position in its summary — the "#N" callouts elsewhere cite. */
  ordinal: number
  text: string
  context: string | null
  timestampSec: number | null
  summaryId: string
  episodeId: string
  episodeTitle: string
  podcastTitle: string
  publishedAt: string | null
  crossReferences: CrossReferenceView[]
}

export interface InsightSearchResponse {
  /** Echoed back so a stale response can be recognized as stale by the caller. */
  query: string
  results: InsightSearchResult[]
}
