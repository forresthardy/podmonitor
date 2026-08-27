import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/db/client'
import { episodes, podcasts } from '@/db/schema'
import { ingestFeedXml } from '@/lib/feeds/ingest'
import { resetDatabase } from '../helpers/db'

const FIXTURES_DIR = join(__dirname, '../fixtures/feeds')

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8')
}

/** Narrows a possibly-missing row to defined, failing the test with a clear message if it's absent. */
function assertDefined<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined()
  return value as T
}

const FEEDS = [
  { name: 'acquired.xml', feedUrl: 'https://feeds.transistor.fm/acquired', episodeCount: 8 },
  { name: 'huberman-lab.xml', feedUrl: 'https://feeds.megaphone.fm/hubermanlab', episodeCount: 6 },
  {
    name: 'invest-like-the-best.xml',
    feedUrl: 'https://feeds.megaphone.fm/CLS2859450455',
    episodeCount: 6,
  },
  {
    name: 'lennys-podcast.xml',
    feedUrl: 'https://api.substack.com/feed/podcast/10845.rss',
    episodeCount: 6,
  },
]

beforeEach(async () => {
  await resetDatabase()
})

describe('ingestFeedXml', () => {
  it.each(FEEDS)('ingests $name into podcasts + episodes', async ({ feedUrl, episodeCount }) => {
    const xml = loadFixture(FEEDS.find((f) => f.feedUrl === feedUrl)!.name)

    const summary = await ingestFeedXml(feedUrl, xml)

    expect(summary.episodesSeen).toBe(episodeCount)
    expect(summary.episodesInserted).toBe(episodeCount)

    const db = getDb()
    const podcast = assertDefined(
      (await db.select().from(podcasts).where(eq(podcasts.feedUrl, feedUrl)))[0],
      `expected a podcast row for ${feedUrl}`,
    )
    expect(podcast.lastPolledAt).not.toBeNull()

    const rows = await db.select().from(episodes).where(eq(episodes.podcastId, podcast.id))
    expect(rows).toHaveLength(episodeCount)
    // Every discovered episode starts at the front of the lifecycle state machine.
    expect(rows.every((row) => row.status === 'discovered')).toBe(true)
    expect(rows.every((row) => row.transcriptSource === null)).toBe(true)
  })

  it('captures enclosure URL, itunes metadata, duration, and transcript links per episode', async () => {
    await ingestFeedXml('https://feeds.transistor.fm/acquired', loadFixture('acquired.xml'))

    const db = getDb()
    const vanguard = assertDefined(
      (await db.select().from(episodes).where(eq(episodes.title, 'Vanguard')))[0],
      'expected the Vanguard episode to be ingested',
    )

    expect(vanguard).toMatchObject({
      audioUrl: expect.stringMatching(/^https:\/\/pscrb\.fm\/rss\/p\/media\.transistor\.fm\//),
      transcriptUrl: 'https://share.transistor.fm/s/ee9d0817/transcript.txt',
    })
    expect(vanguard.durationSec).toBeGreaterThan(0)
    expect(vanguard.description).toBeTruthy()
  })

  it('never re-ingests a duplicate GUID (idempotent poll)', async () => {
    const xml = loadFixture('huberman-lab.xml')
    const feedUrl = 'https://feeds.megaphone.fm/hubermanlab'

    const first = await ingestFeedXml(feedUrl, xml)
    expect(first.episodesInserted).toBe(6)

    // Simulate the next poll tick seeing the same feed content again.
    const second = await ingestFeedXml(feedUrl, xml)
    expect(second.episodesSeen).toBe(6)
    expect(second.episodesInserted).toBe(0)

    const db = getDb()
    const podcast = assertDefined(
      (await db.select().from(podcasts).where(eq(podcasts.feedUrl, feedUrl)))[0],
      `expected a podcast row for ${feedUrl}`,
    )
    const rows = await db.select().from(episodes).where(eq(episodes.podcastId, podcast.id))
    expect(rows).toHaveLength(6)

    // A single podcast row too -- re-polling must not create a second podcast for the same feed.
    const allPodcastsForFeed = await db.select().from(podcasts).where(eq(podcasts.feedUrl, feedUrl))
    expect(allPodcastsForFeed).toHaveLength(1)
  })

  it('preserves in-flight lifecycle state on a repeat poll instead of overwriting it', async () => {
    const feedUrl = 'https://feeds.transistor.fm/acquired'
    await ingestFeedXml(feedUrl, loadFixture('acquired.xml'))

    const db = getDb()
    const vanguard = assertDefined(
      (await db.select().from(episodes).where(eq(episodes.title, 'Vanguard')))[0],
      'expected the Vanguard episode to be ingested',
    )
    await db
      .update(episodes)
      .set({ status: 'summarized', transcriptSource: 'feed_tag' })
      .where(eq(episodes.id, vanguard.id))

    // Re-poll the identical feed content.
    await ingestFeedXml(feedUrl, loadFixture('acquired.xml'))

    const afterRepoll = assertDefined(
      (await db.select().from(episodes).where(eq(episodes.id, vanguard.id)))[0],
      'expected the Vanguard episode to still exist after a repeat poll',
    )
    expect(afterRepoll.status).toBe('summarized')
    expect(afterRepoll.transcriptSource).toBe('feed_tag')
  })
})
