import type { EpisodeStatus, TranscriptSourceName } from '@/db/schema'

/**
 * One row of the episode library: the pipeline's state for one episode as *this* user
 * sees it. Dates are ISO strings so the same payload serves the server-rendered page and
 * `/api/episodes`.
 *
 * `status` is the shared processing state (`episodes.status`) while `summaryId` is
 * per-user: two users can both watch an episode reach `summarized` and only one of them
 * has a summary of it, because summarization runs per user. The library shows the badge
 * from the former and the "read summary" link from the latter.
 */
export interface EpisodeLibraryItem {
  episodeId: string
  title: string
  podcastTitle: string
  publishedAt: string | null
  durationSec: number | null
  status: EpisodeStatus
  /** Populated only in `failed`; the reason the last attempt gave up. */
  failureReason: string | null
  transcriptSource: TranscriptSourceName | null
  /** The signed-in user's summary of this episode, when one exists. */
  summaryId: string | null
  /** How strongly the episode matched this user's interests. */
  matchScore: number
  /** True when the user confirmed a borderline match rather than it auto-queueing. */
  confirmedByUser: boolean
}
