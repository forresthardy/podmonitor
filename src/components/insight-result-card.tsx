import Link from 'next/link'
import { formatPublishedDate } from '@/lib/format/time'
import type { InsightSearchResult } from '@/lib/knowledge/search-view'
import { CrossReferenceCallout } from './cross-reference-callout'
import { TimestampAnchor } from './ui/timestamp-anchor'

/**
 * One insight in the knowledge base, with the provenance needed to trust it: which episode,
 * which show, when it aired, and where in the audio it was said.
 *
 * The link goes to the summary at this insight's anchor, so following a search result never
 * costs the reader a second search inside the page.
 */
export function InsightResultCard({ result }: { result: InsightSearchResult }) {
  const published = formatPublishedDate(result.publishedAt)
  const summaryHref = `/summaries/${result.summaryId}#insight-${result.ordinal}`

  return (
    <article className="card stack insight-result">
      <p className="insight-text">{result.text}</p>
      {result.context ? <p className="muted">{result.context}</p> : null}
      <p className="muted">
        <Link href={summaryHref}>{result.episodeTitle}</Link> · {result.podcastTitle}
        {published ? ` · ${published}` : ''}
        {result.timestampSec === null ? null : (
          <>
            {' · '}
            <TimestampAnchor
              timestampSec={result.timestampSec}
              href={summaryHref}
              label="Said at"
            />
          </>
        )}
      </p>
      {result.crossReferences.map((reference) => (
        <CrossReferenceCallout key={reference.relatedInsightId} reference={reference} />
      ))}
    </article>
  )
}
