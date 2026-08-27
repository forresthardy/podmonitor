import type { TranscriptSegment } from '@/db/schema'
import type { SummaryQuote } from './schema'

/**
 * A quote is real evidence, not the model's paraphrase, only if its timestamp actually
 * falls inside a transcript segment's span. This is the one check zod cannot do — schema
 * validation confirms shape, this confirms grounding against the source transcript.
 */

export interface QuoteTimestampIssue {
  quote: string
  timestampSec: number
}

export function findUngroundedQuotes(
  quotes: readonly SummaryQuote[],
  segments: readonly TranscriptSegment[],
): QuoteTimestampIssue[] {
  return quotes
    .filter(
      (quote) =>
        !segments.some(
          (segment) => quote.timestampSec >= segment.start && quote.timestampSec <= segment.end,
        ),
    )
    .map((quote) => ({ quote: quote.quote, timestampSec: quote.timestampSec }))
}

export class QuoteTimestampError extends Error {
  readonly issues: QuoteTimestampIssue[]

  constructor(issues: QuoteTimestampIssue[]) {
    super(
      `${issues.length} quote(s) have a timestampSec that does not fall within any ` +
        `transcript segment: ${issues.map((issue) => `"${issue.quote}" @ ${issue.timestampSec}s`).join('; ')}`,
    )
    this.name = 'QuoteTimestampError'
    this.issues = issues
  }
}

export function assertQuotesAreGrounded(
  quotes: readonly SummaryQuote[],
  segments: readonly TranscriptSegment[],
): void {
  const issues = findUngroundedQuotes(quotes, segments)
  if (issues.length > 0) throw new QuoteTimestampError(issues)
}
