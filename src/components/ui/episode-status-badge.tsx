import type { EpisodeStatus } from '@/db/schema'

/**
 * The pipeline state, as a badge.
 *
 * The spec makes `failed` a first-class state, so the mapping is exhaustive and typed:
 * adding a state to the enum breaks the build here rather than rendering a blank badge.
 */

interface StatusMeta {
  label: string
  tone: 'neutral' | 'progress' | 'success' | 'danger'
  /** One line of "what this means for me", shown next to the badge in the library. */
  hint: string
}

export const EPISODE_STATUS_META: Record<EpisodeStatus, StatusMeta> = {
  discovered: {
    label: 'Discovered',
    tone: 'neutral',
    hint: 'Found in the feed, waiting to be picked up',
  },
  transcribing: {
    label: 'Transcribing',
    tone: 'progress',
    hint: 'Fetching or generating the transcript',
  },
  summarized: {
    label: 'Summarized',
    tone: 'success',
    hint: 'Ready to read',
  },
  failed: {
    label: 'Failed',
    tone: 'danger',
    hint: 'A stage gave up after its retries — retry to try again',
  },
}

export function EpisodeStatusBadge({ status }: { status: EpisodeStatus }) {
  const meta = EPISODE_STATUS_META[status]

  return (
    <span className={`badge badge-${meta.tone}`} data-status={status} title={meta.hint}>
      {meta.label}
    </span>
  )
}
