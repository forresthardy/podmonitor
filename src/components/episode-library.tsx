'use client'

import Link from 'next/link'
import { formatDuration, formatPublishedDate } from '@/lib/format/time'
import type { EpisodeLibraryItem } from '@/lib/episodes/types'
import { EPISODE_STATUS_META, EpisodeStatusBadge } from './ui/episode-status-badge'
import { useAsyncAction } from './hooks/use-async-action'

/**
 * Every episode queued for this user, with where it is in the pipeline.
 *
 * Presentational: the rows arrive as props and the retry call arrives as `onRetry`, so the
 * component never fetches. That is also what makes the failure path testable — a test
 * hands it a `failed` episode and a fake retry and asserts on what the reader sees.
 *
 * `failed` is treated as a state with an action, not a dead end (spec §pipeline): the
 * reason the stage gave up is shown verbatim, because "Failed" alone tells the reader
 * nothing about whether retrying is worth it.
 */
export function EpisodeLibrary({
  episodes,
  onRetry,
}: {
  episodes: EpisodeLibraryItem[]
  onRetry: (episodeId: string) => Promise<void>
}) {
  const retry = useAsyncAction(onRetry, 'Retry failed, please try again')

  if (episodes.length === 0) {
    return (
      <section className="card stack">
        <h2>Episode library</h2>
        <p className="muted">
          No episodes queued yet. Once a new episode matches your interests it appears here and
          moves through transcription and summarization on its own.
        </p>
        <Link href="/settings">Review your interests</Link>
      </section>
    )
  }

  return (
    <section className="stack">
      <h2>Episode library</h2>
      {retry.error ? <p className="error">{retry.error}</p> : null}
      <ul className="plain stack">
        {episodes.map((episode) => {
          const published = formatPublishedDate(episode.publishedAt)
          const duration = formatDuration(episode.durationSec)
          const retrying = retry.pendingKey === episode.episodeId

          return (
            <li key={episode.episodeId} className="card stack episode-row">
              <div className="row-between">
                <strong>{episode.title}</strong>
                <EpisodeStatusBadge status={episode.status} />
              </div>
              <p className="muted">
                {[episode.podcastTitle, published, duration].filter(Boolean).join(' · ')}
              </p>
              <p className="muted">{EPISODE_STATUS_META[episode.status].hint}</p>

              {episode.status === 'failed' && episode.failureReason ? (
                <p className="error failure-reason">{episode.failureReason}</p>
              ) : null}

              {episode.status === 'failed' ? (
                <div>
                  <button
                    type="button"
                    disabled={retrying}
                    onClick={() => retry.run(episode.episodeId, episode.episodeId)}
                  >
                    {retrying ? 'Retrying...' : 'Retry'}
                  </button>
                </div>
              ) : null}

              {episode.summaryId ? (
                <Link href={`/summaries/${episode.summaryId}`}>Read the summary</Link>
              ) : episode.status === 'summarized' ? (
                <p className="muted">Summarized for other readers — yours is still being written.</p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
