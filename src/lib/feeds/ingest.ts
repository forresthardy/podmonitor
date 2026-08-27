import { getDb } from '@/db/client'
import { episodes, podcasts } from '@/db/schema'
import { parseFeed } from './parser'

export interface IngestSummary {
  podcastId: string
  feedUrl: string
  /** Episodes present in this parse of the feed, regardless of whether they were new. */
  episodesSeen: number
  /** Episodes newly inserted this run — 0 on a repeat poll of an unchanged feed. */
  episodesInserted: number
  /** Ids of the episodes newly inserted this run — the interest-match job fans out over these. */
  insertedEpisodeIds: string[]
}

/**
 * Upserts a podcast and its episodes from already-fetched feed XML.
 *
 * Deliberately takes the XML as a parameter rather than fetching it itself: that keeps this
 * function pure of network IO, so parser + dedup behavior is testable directly against
 * recorded fixtures. `pollFeed` below is the thin IO wrapper used by the real poll job.
 *
 * Idempotent by construction:
 * - Podcasts are keyed on `feed_url` (unique): a repeat poll updates title/image/last_polled_at
 *   in place rather than creating a second row.
 * - Episodes are keyed on `guid` (unique): a repeat poll inserts only genuinely new episodes.
 *   `onConflictDoNothing` intentionally leaves an existing episode row untouched rather than
 *   overwriting it — by the time a GUID reappears in the feed, the row may have moved past
 *   `discovered` in the lifecycle (transcribing, summarized, ...), and a blind upsert would
 *   stomp that progress back to feed-supplied values.
 */
export async function ingestFeedXml(feedUrl: string, xml: string): Promise<IngestSummary> {
  const parsed = parseFeed(xml)
  const db = getDb()
  const polledAt = new Date()

  const [podcast] = await db
    .insert(podcasts)
    .values({
      feedUrl,
      title: parsed.channel.title,
      imageUrl: parsed.channel.imageUrl,
      lastPolledAt: polledAt,
    })
    .onConflictDoUpdate({
      target: podcasts.feedUrl,
      set: { title: parsed.channel.title, imageUrl: parsed.channel.imageUrl, lastPolledAt: polledAt },
    })
    .returning()

  // `onConflictDoUpdate().returning()` always yields exactly the one row just upserted;
  // this guards the type only, it is not an expected runtime path.
  if (!podcast) {
    throw new Error(`Upserting podcast for ${feedUrl} returned no row`)
  }

  if (parsed.episodes.length === 0) {
    return {
      podcastId: podcast.id,
      feedUrl,
      episodesSeen: 0,
      episodesInserted: 0,
      insertedEpisodeIds: [],
    }
  }

  const inserted = await db
    .insert(episodes)
    .values(
      parsed.episodes.map((episode) => ({
        podcastId: podcast.id,
        guid: episode.guid,
        title: episode.title,
        publishedAt: episode.publishedAt,
        audioUrl: episode.audioUrl,
        durationSec: episode.durationSec,
        description: episode.description,
        imageUrl: episode.imageUrl,
        transcriptUrl: episode.transcriptUrl,
        itunesEpisode: episode.itunesEpisode,
        itunesSeason: episode.itunesSeason,
      })),
    )
    .onConflictDoNothing({ target: episodes.guid })
    .returning({ id: episodes.id })

  return {
    podcastId: podcast.id,
    feedUrl,
    episodesSeen: parsed.episodes.length,
    episodesInserted: inserted.length,
    insertedEpisodeIds: inserted.map((row) => row.id),
  }
}

/** Default timeout for a feed fetch: slow enough for a cold CDN, not so long a hung feed blocks the whole poll run. */
const FEED_FETCH_TIMEOUT_MS = 15_000

/** Fetches feed XML over HTTP. The one piece of this module not covered by fixture-based tests. */
export async function fetchFeedXml(feedUrl: string): Promise<string> {
  const response = await fetch(feedUrl, {
    signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    headers: {
      // Some publishers 403 requests with no UA at all.
      'user-agent': 'Podmonitor/1.0 (+https://github.com/forresthardy/podmonitor)',
      accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  })
  if (!response.ok) {
    throw new Error(`Feed fetch failed for ${feedUrl}: HTTP ${response.status}`)
  }
  return response.text()
}

/** Fetches and ingests one feed. */
export async function pollFeed(feedUrl: string): Promise<IngestSummary> {
  const xml = await fetchFeedXml(feedUrl)
  return ingestFeedXml(feedUrl, xml)
}

export interface PollFeedFailure {
  feedUrl: string
  error: string
}

export interface PollAllResult {
  succeeded: IngestSummary[]
  failed: PollFeedFailure[]
}

/**
 * Polls every known podcast. One publisher's feed being unreachable (timeout, 5xx, malformed
 * XML) must never stop the rest of the batch from ingesting, so failures are collected rather
 * than thrown.
 */
export async function pollAllPodcasts(feedUrls: string[]): Promise<PollAllResult> {
  const succeeded: IngestSummary[] = []
  const failed: PollFeedFailure[] = []

  for (const feedUrl of feedUrls) {
    try {
      succeeded.push(await pollFeed(feedUrl))
    } catch (error) {
      failed.push({ feedUrl, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { succeeded, failed }
}
