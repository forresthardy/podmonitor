import type { SummaryInsight } from '@/db/schema'

/** Keeps the email skimmable — a full summary is one click away in the app. */
export const MAX_INSIGHTS_PER_EPISODE = 3

/** One (episode, summary) row for a user's digest week, as loaded from the database. */
export interface DigestSourceRow {
  episodeId: string
  episodeTitle: string
  podcastTitle: string
  publishedAt: Date | null
  summaryTldr: string
  summaryInsights: SummaryInsight[]
}

export interface DigestEpisodeEntry {
  episodeId: string
  episodeTitle: string
  podcastTitle: string
  tldr: string
  topInsights: SummaryInsight[]
}

export interface DigestContent {
  userId: string
  /** `YYYY-MM-DD`, the Monday this digest is for. */
  weekOf: string
  episodes: DigestEpisodeEntry[]
}

/**
 * Pure transform from the week's raw (episode, summary) rows into the digest's shape —
 * no I/O, so this is exercised directly by the digest assembly unit test.
 *
 * Newest-published-episode-first (most recent is most likely to still be top of mind);
 * each episode's insights are capped at `MAX_INSIGHTS_PER_EPISODE` rather than reproducing
 * the full summary, per the spec's "TL;DRs + top insights" shape.
 */
export function assembleDigest(
  userId: string,
  weekOf: string,
  rows: DigestSourceRow[],
): DigestContent {
  const sorted = [...rows].sort((a, b) => {
    const aTime = a.publishedAt?.getTime() ?? 0
    const bTime = b.publishedAt?.getTime() ?? 0
    return bTime - aTime
  })

  return {
    userId,
    weekOf,
    episodes: sorted.map((row) => ({
      episodeId: row.episodeId,
      episodeTitle: row.episodeTitle,
      podcastTitle: row.podcastTitle,
      tldr: row.summaryTldr,
      topInsights: row.summaryInsights.slice(0, MAX_INSIGHTS_PER_EPISODE),
    })),
  }
}
