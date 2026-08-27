import type { TranscriptSegment } from '@/db/schema'

export type { TranscriptSegment }

/**
 * One `<podcast:transcript>` element from the feed, as parsed by the ingestion stage.
 * Attributes are carried verbatim: the selector, not the parser, decides what is usable.
 *
 * @see https://podcastindex.org/namespace/1.0#transcript
 */
export interface FeedTranscriptCandidate {
  url: string
  /** Raw `type` attribute, e.g. `text/vtt`. Feeds are inconsistent about casing and parameters. */
  mimeType: string
  /** Raw `language` attribute (BCP-47) when the feed sets one. */
  language?: string
  /** `rel="captions"` marks a caption file, which may be a partial rendering of the episode. */
  rel?: string
}

/** Transcript serializations we can turn into segments. */
export type TranscriptFormat = 'json' | 'vtt' | 'srt' | 'text'

/** A transcript parsed into the shape the `transcripts` row stores. */
export interface ParsedTranscript {
  fullText: string
  /**
   * Timestamped segments. Empty for `text` transcripts, which carry no timing at all —
   * downstream summarization already treats timestamps as optional.
   */
  segments: TranscriptSegment[]
}
