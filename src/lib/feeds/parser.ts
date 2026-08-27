import { XMLParser } from 'fast-xml-parser'
import { FeedParseError, type ParsedFeed, type ParsedFeedChannel, type ParsedFeedEpisode } from './types'

export { FeedParseError }

/**
 * A raw XML node as fast-xml-parser hands it back: either a bare value, or an object
 * carrying `#text` plus `@_`-prefixed attributes. Real feeds mix both shapes for the same
 * tag depending on whether the publisher wrapped it in CDATA or added an attribute
 * (e.g. Acquired's plain `<guid>` vs. Huberman's `<guid isPermaLink="false"><![CDATA[...]]>`).
 */
type RawNode = string | number | { '#text'?: string | number; [attribute: `@_${string}`]: unknown } | undefined

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // Real feeds vary on whether these repeat: force array shape so downstream code never
  // has to special-case "one vs. many" (a single `<enclosure>` parses to a bare object
  // otherwise, and a single `<podcast:transcript>` the same way).
  isArray: (name, jPath) =>
    jPath === 'rss.channel.item' ||
    jPath.endsWith('.item.enclosure') ||
    jPath.endsWith('.item.podcast:transcript'),
})

/** Unwraps a raw node to its text content, regardless of whether it came via CDATA or a plain text node. */
function textOf(node: RawNode): string | null {
  if (node === undefined || node === null) return null
  if (typeof node === 'string') return node.trim() || null
  if (typeof node === 'number') return String(node)
  const text = node['#text']
  if (text === undefined || text === null) return null
  return String(text).trim() || null
}

function attrOf(node: RawNode, attribute: string): string | null {
  if (node === undefined || node === null || typeof node !== 'object') return null
  const value = node[`@_${attribute}`]
  return value === undefined || value === null ? null : String(value)
}

/**
 * Parses `itunes:duration`. Publishers disagree on format: megaphone.fm feeds (Huberman,
 * Invest Like the Best) and Substack give raw seconds; the iTunes spec also allows
 * `HH:MM:SS` / `MM:SS`, which some feeds still use. Lenient means accepting both.
 */
function parseDurationSec(node: RawNode): number | null {
  const raw = textOf(node)
  if (raw === null) return null
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10)

  const parts = raw.split(':').map((part) => Number.parseInt(part, 10))
  if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function parseDate(node: RawNode): Date | null {
  const raw = textOf(node)
  if (raw === null) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseIntOrNull(node: RawNode): number | null {
  const raw = textOf(node)
  if (raw === null) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Picks the enclosure's URL. `length="0"` is a known megaphone.fm quirk (the real byte size
 * lives behind their tracking redirect) — it is not a parse failure, just an unknown length
 * we don't need at ingestion time.
 */
function enclosureUrl(item: Record<string, unknown>): string | null {
  const enclosures = item.enclosure as RawNode[] | undefined
  const first = enclosures?.[0]
  return attrOf(first, 'url')
}

/**
 * Picks the transcript link. A publisher may list the same transcript in several formats
 * (e.g. `text/plain` and `application/srt`); prefer plain text since that's what the
 * summarization pipeline consumes, falling back to whichever format is listed first.
 */
function transcriptUrl(item: Record<string, unknown>): string | null {
  const transcripts = item['podcast:transcript'] as RawNode[] | undefined
  if (!transcripts || transcripts.length === 0) return null
  const plainText = transcripts.find((entry) => attrOf(entry, 'type') === 'text/plain')
  return attrOf(plainText ?? transcripts[0], 'url')
}

function channelImageUrl(channel: Record<string, unknown>): string | null {
  const rssImage = textOf((channel.image as Record<string, unknown> | undefined)?.url as RawNode)
  if (rssImage) return rssImage
  return attrOf(channel['itunes:image'] as RawNode, 'href')
}

function parseChannel(channel: Record<string, unknown>): ParsedFeedChannel {
  return {
    title: textOf(channel.title as RawNode) ?? 'Untitled podcast',
    imageUrl: channelImageUrl(channel),
  }
}

/** Returns `null` (dropping the item) when there is no GUID: nothing to dedupe on, nothing to store against. */
function parseEpisode(item: Record<string, unknown>): ParsedFeedEpisode | null {
  const guid = textOf(item.guid as RawNode)
  if (guid === null) return null

  return {
    guid,
    title: textOf(item.title as RawNode) ?? 'Untitled episode',
    publishedAt: parseDate(item.pubDate as RawNode),
    audioUrl: enclosureUrl(item),
    durationSec: parseDurationSec(item['itunes:duration'] as RawNode),
    description: textOf(item.description as RawNode) ?? textOf(item['itunes:summary'] as RawNode),
    imageUrl: attrOf(item['itunes:image'] as RawNode, 'href'),
    transcriptUrl: transcriptUrl(item),
    itunesEpisode: parseIntOrNull(item['itunes:episode'] as RawNode),
    itunesSeason: parseIntOrNull(item['itunes:season'] as RawNode),
  }
}

/**
 * Parses an RSS feed leniently. Handles the real-world quirks seen across the four seed
 * shows: Substack's entire feed on one line with no inter-tag whitespace, Transistor's
 * `podcast:` namespace tags (season/episode/transcript/person), megaphone.fm's zero-length
 * enclosures, and CDATA-wrapped titles/descriptions/guids mixed with plain-text ones.
 *
 * A guid-less item is dropped rather than failing the whole feed — one malformed entry
 * should never block ingesting the rest of a publisher's catalog.
 */
export function parseFeed(xml: string): ParsedFeed {
  let document: unknown
  try {
    document = parser.parse(xml)
  } catch (error) {
    throw new FeedParseError(`Feed is not valid XML: ${describeError(error)}`)
  }

  const channel = (document as { rss?: { channel?: Record<string, unknown> } })?.rss?.channel
  if (!channel) {
    throw new FeedParseError('Feed is missing an <rss><channel> root element')
  }

  const items = (channel.item as Record<string, unknown>[] | undefined) ?? []
  const episodes = items
    .map((item) => parseEpisode(item))
    .filter((episode): episode is ParsedFeedEpisode => episode !== null)

  return { channel: parseChannel(channel), episodes }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
