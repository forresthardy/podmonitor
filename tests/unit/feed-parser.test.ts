import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FeedParseError, parseFeed } from '@/lib/feeds/parser'

const FIXTURES_DIR = join(__dirname, '../fixtures/feeds')

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8')
}

/** Narrows a possibly-missing value to defined, failing the test with a clear message if it's absent. */
function assertDefined<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined()
  return value as T
}

describe('parseFeed', () => {
  it('parses Acquired (Transistor: podcast: namespace, speaker-labeled transcripts)', () => {
    const feed = parseFeed(loadFixture('acquired.xml'))

    expect(feed.channel.title).toBe('Acquired')
    expect(feed.episodes).toHaveLength(8)

    // The trimmed fixture keeps the feed's natural order: two transcript-bearing episodes
    // (Vanguard, Ferrari) sit among six that have none, exactly as the live feed lists them.
    const vanguard = feed.episodes.find((episode) => episode.title === 'Vanguard')
    expect(vanguard).toMatchObject({
      guid: '465f9bb3-6d71-49ed-a233-de82bc41b034',
      transcriptUrl: 'https://share.transistor.fm/s/ee9d0817/transcript.txt',
    })
    expect(vanguard?.audioUrl).toMatch(/^https:\/\/pscrb\.fm\/rss\/p\/media\.transistor\.fm\//)
    expect(vanguard?.durationSec).toBeGreaterThan(0)
    expect(vanguard?.publishedAt).toBeInstanceOf(Date)

    const disney = feed.episodes.find((episode) => episode.title === 'Disney: The Renaissance and the Empire')
    expect(disney?.transcriptUrl).toBeNull()
  })

  it('parses Huberman Lab (megaphone.fm redirect enclosures, no transcripts)', () => {
    const feed = parseFeed(loadFixture('huberman-lab.xml'))

    expect(feed.channel.title).toBe('Huberman Lab')
    expect(feed.episodes.length).toBeGreaterThan(0)

    for (const episode of feed.episodes) {
      // megaphone.fm's enclosure length is a known "0" placeholder (real size lives behind
      // the tracking redirect) -- the URL must still parse even though length doesn't.
      expect(episode.audioUrl).toMatch(/^https:\/\/traffic\.megaphone\.fm\//)
      expect(episode.transcriptUrl).toBeNull()
      expect(episode.durationSec).toBeGreaterThan(0)
      expect(episode.guid).toBeTruthy()
    }
  })

  it('parses Invest Like the Best (megaphone.fm, itunes:episode numbering)', () => {
    const feed = parseFeed(loadFixture('invest-like-the-best.xml'))

    expect(feed.channel.title).toBe("Invest Like the Best with Patrick O'Shaughnessy")
    expect(feed.episodes.length).toBeGreaterThan(0)

    const withEpisodeNumber = feed.episodes.filter((episode) => episode.itunesEpisode !== null)
    expect(withEpisodeNumber.length).toBeGreaterThan(0)
    for (const episode of withEpisodeNumber) {
      expect(Number.isInteger(episode.itunesEpisode)).toBe(true)
    }
  })

  it('parses Lenny\'s Podcast (Substack single-line XML, CDATA-heavy fields)', () => {
    const raw = loadFixture('lennys-podcast.xml')
    // Confirms the fixture actually exercises the quirk under test: Substack emits the whole
    // channel as one unindented line with no whitespace between tags (unlike a pretty-printed
    // feed). One line break does occur, but only inside a text field's own content, which is
    // the realistic case this fixture was recorded from -- so assert on tag-adjacency, not on
    // a literal single-line file.
    expect(raw).not.toMatch(/>\s*\n\s*</)

    const feed = parseFeed(raw)

    expect(feed.channel.title).toBe("Lenny's Podcast: Product | Career | Growth")
    expect(feed.episodes.length).toBeGreaterThan(0)

    const first = assertDefined(feed.episodes[0], 'expected at least one parsed episode')
    expect(first.guid).toBe('substack:post:211488420')
    expect(first.title).toContain('enterprise deals')
    expect(first.audioUrl).toMatch(/^https:\/\/pscrb\.fm\/rss\/p\/api\.substack\.com\//)
    expect(first.durationSec).toBeGreaterThan(0)
  })

  it('drops items with no guid instead of failing the whole feed', () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel><title>Test</title>
        <item><title>No guid here</title><enclosure url="https://example.com/a.mp3" length="1" type="audio/mpeg"/></item>
        <item><guid>keep-me</guid><title>Keep me</title></item>
      </channel></rss>`

    const feed = parseFeed(xml)
    expect(feed.episodes).toHaveLength(1)
    expect(assertDefined(feed.episodes[0], 'expected the guid-bearing item to survive').guid).toBe('keep-me')
  })

  it('accepts itunes:duration as HH:MM:SS as well as raw seconds', () => {
    const xml = `<?xml version="1.0"?>
      <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Test</title>
        <item><guid>a</guid><title>A</title><itunes:duration>01:02:03</itunes:duration></item>
        <item><guid>b</guid><title>B</title><itunes:duration>90</itunes:duration></item>
      </channel></rss>`

    const feed = parseFeed(xml)
    expect(feed.episodes.find((e) => e.guid === 'a')?.durationSec).toBe(3723)
    expect(feed.episodes.find((e) => e.guid === 'b')?.durationSec).toBe(90)
  })

  it('throws FeedParseError for a document with no rss/channel root', () => {
    expect(() => parseFeed('<html><body>not a feed</body></html>')).toThrow(FeedParseError)
  })

  // fast-xml-parser auto-closes unterminated tags rather than throwing -- that's exactly the
  // leniency this parser relies on for real-world feed quirks, so an unterminated-but-present
  // <rss><channel> recovers to an empty feed instead of crashing the whole poll.
  it('recovers an unterminated feed to an empty channel instead of throwing', () => {
    const feed = parseFeed('<rss><channel><title>unterminated')
    expect(feed.channel.title).toBe('Untitled podcast')
    expect(feed.episodes).toHaveLength(0)
  })
})
