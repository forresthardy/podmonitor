import { formatPublishedDate, timestampAnchorId } from '@/lib/format/time'
import type { SummaryView } from '@/lib/knowledge/summary-view'
import { CrossReferenceCallout } from './cross-reference-callout'
import { TimestampAnchor } from './ui/timestamp-anchor'

/**
 * The reading view: the whole point of the product, in one screen.
 *
 * Order is deliberate and matches the spec's v1 summary format — TL;DR first (the "should
 * I care" answer), then numbered key insights each with its surrounding argument and any
 * cross-references, then notable quotes attributed to a speaker at a timestamp. Purely
 * presentational: it receives a `SummaryView` and renders it, so the same component serves
 * the server-rendered page and any test that hands it a fixture.
 */
export function SummaryReader({ summary }: { summary: SummaryView }) {
  const published = formatPublishedDate(summary.publishedAt)

  return (
    <article className="stack summary-reader">
      <header className="stack">
        <p className="muted">
          {summary.podcastTitle}
          {published ? ` · ${published}` : ''}
        </p>
        <h1>{summary.episodeTitle}</h1>
        {summary.topics.length > 0 ? (
          <ul className="plain topic-row">
            {summary.topics.map((topic) => (
              <li key={topic} className="badge badge-neutral">
                {topic}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <section className="card stack">
        <h2>TL;DR</h2>
        <p>{summary.tldr}</p>
      </section>

      <section className="stack">
        <h2>Key insights</h2>
        {summary.insights.length === 0 ? (
          <p className="muted">
            This summary has no key insights — the model returned only a TL;DR for this
            episode.
          </p>
        ) : (
          <ol className="insight-list stack">
            {summary.insights.map((insight) => (
              <li key={insight.ordinal} id={`insight-${insight.ordinal}`} className="card stack">
                <p className="insight-text">
                  <span className="insight-ordinal">#{insight.ordinal}</span> {insight.text}
                </p>
                {insight.context ? <p className="muted">{insight.context}</p> : null}
                {insight.timestampSec === null ? null : (
                  <p className="muted">
                    Around{' '}
                    <TimestampAnchor
                      timestampSec={insight.timestampSec}
                      href={`#insight-${insight.ordinal}`}
                      label={`Insight ${insight.ordinal} at`}
                    />
                  </p>
                )}
                {insight.crossReferences.map((reference) => (
                  <CrossReferenceCallout key={reference.relatedInsightId} reference={reference} />
                ))}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="stack">
        <h2>Notable quotes</h2>
        {summary.quotes.length === 0 ? (
          <p className="muted">
            No quotes cleared the timestamp check for this episode — quotes are only kept when
            the transcript supports them.
          </p>
        ) : (
          <ul className="plain stack">
            {summary.quotes.map((quote) => {
              const anchorId = `quote-${timestampAnchorId(quote.timestampSec)}`
              return (
                <li key={`${quote.speaker}-${quote.timestampSec}`}>
                  <figure id={anchorId} className="card quote">
                    <blockquote>“{quote.quote}”</blockquote>
                    <figcaption className="muted">
                      {quote.speaker} ·{' '}
                      <TimestampAnchor
                        timestampSec={quote.timestampSec}
                        href={`#${anchorId}`}
                        label={`${quote.speaker} at`}
                      />
                    </figcaption>
                  </figure>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </article>
  )
}
