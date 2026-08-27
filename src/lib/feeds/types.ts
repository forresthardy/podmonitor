/** Everything a lenient RSS parse extracts from one podcast feed. */
export interface ParsedFeedChannel {
  title: string
  imageUrl: string | null
}

/** Everything a lenient RSS parse extracts for one `<item>`. */
export interface ParsedFeedEpisode {
  /** Feed-provided GUID. Required: without it we cannot dedupe, so guid-less items are dropped. */
  guid: string
  title: string
  publishedAt: Date | null
  audioUrl: string | null
  durationSec: number | null
  description: string | null
  imageUrl: string | null
  /** `podcast:transcript` link, when the publisher provides one (e.g. Transistor's recent episodes). */
  transcriptUrl: string | null
  itunesEpisode: number | null
  itunesSeason: number | null
}

export interface ParsedFeed {
  channel: ParsedFeedChannel
  episodes: ParsedFeedEpisode[]
}

/** Thrown when a feed cannot be parsed at all (not valid XML, or missing an rss/channel root). */
export class FeedParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedParseError'
  }
}
