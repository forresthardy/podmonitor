import Link from 'next/link'
import type { CrossReferenceView } from '@/lib/knowledge/summary-view'

/**
 * The compounding behavior, made visible: a new insight saying it echoes, extends or
 * contradicts something already in the knowledge base — and linking straight to it.
 *
 * The sentence itself comes from the data (`formatCallout`, shared with the digest email);
 * this component owns only how it is presented and where it points. The link targets the
 * older summary at the older insight's anchor, so "see insight #2" lands on insight #2
 * rather than the top of a page the reader then has to scan.
 */
export function CrossReferenceCallout({ reference }: { reference: CrossReferenceView }) {
  return (
    <aside className={`callout callout-${reference.relation}`} data-relation={reference.relation}>
      <p className="callout-sentence">
        {reference.callout}{' '}
        <Link href={`/summaries/${reference.relatedSummaryId}#insight-${reference.relatedOrdinal}`}>
          Open it
        </Link>
      </p>
      <p className="muted callout-quote">“{reference.relatedText}”</p>
    </aside>
  )
}
