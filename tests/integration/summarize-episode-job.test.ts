import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/db/client'
import { episodes, podcasts, summaries, transcripts, users } from '@/db/schema'
import type { LLMProvider } from '@/lib/llm/types'
import { handleSummarizeEpisode } from '@/queue/handlers/summarize-episode'
import { resetDatabase } from '../helpers/db'

/**
 * The summarization stage against a real database with a stubbed LLM provider. What is
 * under test is persistence, fan-out to multiple users, and the state machine — the
 * summarization logic itself (prompt/parse/validate) is covered in
 * `tests/unit/summarize-transcript.test.ts`.
 */

const VALID_SUMMARY = {
  tldr:
    'The hosts trace how a garage project became an industry giant. ' +
    'They dig into the founders\u2019 early bets on distribution. ' +
    'The episode closes on what the company would do differently today.',
  keyInsights: [
    { text: 'Distribution moats compound faster than product moats.', context: 'x', timestampSec: 1 },
  ],
  notableQuotes: [{ quote: 'One.', speaker: 'x', timestampSec: 1 }],
  topics: ['distribution'],
}

function stubProvider(response: unknown = VALID_SUMMARY): LLMProvider {
  return {
    name: 'stub',
    model: 'stub-model',
    complete: vi.fn(async () => JSON.stringify(response)),
  }
}

async function seedUser(email: string): Promise<typeof users.$inferSelect> {
  const [user] = await getDb()
    .insert(users)
    .values({ email, passwordHash: 'not-a-real-hash' })
    .returning()
  if (!user) throw new Error('failed to seed user')
  return user
}

async function seedEpisodeWithTranscript(): Promise<typeof episodes.$inferSelect> {
  const db = getDb()
  const [podcast] = await db
    .insert(podcasts)
    .values({ feedUrl: `https://feeds.example.com/${crypto.randomUUID()}.xml`, title: 'Acquired' })
    .returning()
  if (!podcast) throw new Error('failed to seed podcast')

  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast.id,
      guid: crypto.randomUUID(),
      title: 'The Standard Oil Episode',
      status: 'transcribing',
    })
    .returning()
  if (!episode) throw new Error('failed to seed episode')

  await db.insert(transcripts).values({
    episodeId: episode.id,
    fullText: 'One. Two.',
    segments: [
      { start: 0, end: 5, text: 'One.' },
      { start: 5, end: 10, text: 'Two.' },
    ],
  })

  return episode
}

async function readEpisode(id: string): Promise<typeof episodes.$inferSelect> {
  const [row] = await getDb().select().from(episodes).where(eq(episodes.id, id)).limit(1)
  if (!row) throw new Error(`episode ${id} disappeared`)
  return row
}

beforeEach(async () => {
  await resetDatabase()
})

describe('handleSummarizeEpisode', () => {
  it('stores a summary per target user and moves the episode to summarized', async () => {
    const episode = await seedEpisodeWithTranscript()
    const userA = await seedUser('a@example.com')
    const userB = await seedUser('b@example.com')
    const enqueueLinkInsights = vi.fn(async () => undefined)

    const result = await handleSummarizeEpisode(
      { episodeId: episode.id, userIds: [userA.id, userB.id] },
      { isFinalAttempt: false, provider: stubProvider(), enqueueLinkInsights },
    )

    expect(result.outcome).toBe('summarized')
    expect(result.summarizedUserIds).toHaveLength(2)

    const stored = await getDb().select().from(summaries).where(eq(summaries.episodeId, episode.id))
    expect(stored).toHaveLength(2)
    expect(stored.map((row) => row.userId).sort()).toEqual([userA.id, userB.id].sort())
    expect(stored[0]?.model).toBe('stub:stub-model')
    // The stored quote timestamps must survive the jsonb round-trip intact.
    expect(stored[0]?.quotes).toEqual(VALID_SUMMARY.notableQuotes)

    expect((await readEpisode(episode.id)).status).toBe('summarized')
    expect(enqueueLinkInsights).toHaveBeenCalledTimes(2)
  })

  it('summarizes for every user when no userIds are given', async () => {
    const episode = await seedEpisodeWithTranscript()
    await seedUser('a@example.com')
    await seedUser('b@example.com')

    const result = await handleSummarizeEpisode(
      { episodeId: episode.id },
      { isFinalAttempt: false, provider: stubProvider(), enqueueLinkInsights: vi.fn(async () => undefined) },
    )

    expect(result.summarizedUserIds).toHaveLength(2)
  })

  it('is idempotent: a re-delivered job does not re-summarize a user who already has one', async () => {
    const episode = await seedEpisodeWithTranscript()
    const user = await seedUser('a@example.com')
    const provider = stubProvider()

    await handleSummarizeEpisode(
      { episodeId: episode.id, userIds: [user.id] },
      { isFinalAttempt: false, provider, enqueueLinkInsights: vi.fn(async () => undefined) },
    )
    const second = await handleSummarizeEpisode(
      { episodeId: episode.id, userIds: [user.id] },
      { isFinalAttempt: false, provider, enqueueLinkInsights: vi.fn(async () => undefined) },
    )

    expect(second).toEqual({ outcome: 'already_present', episodeId: episode.id, summarizedUserIds: [] })
    // The expensive half of the pipeline must not run twice.
    expect(provider.complete).toHaveBeenCalledTimes(1)
    expect(await getDb().select().from(summaries)).toHaveLength(1)
  })

  it('summarizes only the users still missing a row on a partial re-delivery', async () => {
    const episode = await seedEpisodeWithTranscript()
    const userA = await seedUser('a@example.com')
    const userB = await seedUser('b@example.com')
    const provider = stubProvider()

    await handleSummarizeEpisode(
      { episodeId: episode.id, userIds: [userA.id] },
      { isFinalAttempt: false, provider, enqueueLinkInsights: vi.fn(async () => undefined) },
    )
    const second = await handleSummarizeEpisode(
      { episodeId: episode.id, userIds: [userA.id, userB.id] },
      { isFinalAttempt: false, provider, enqueueLinkInsights: vi.fn(async () => undefined) },
    )

    expect(second.summarizedUserIds).toEqual([userB.id])
    expect(provider.complete).toHaveBeenCalledTimes(2)
  })

  it('rethrows without marking the episode failed while retries remain', async () => {
    const episode = await seedEpisodeWithTranscript()
    const user = await seedUser('a@example.com')
    const provider: LLMProvider = {
      name: 'stub',
      model: 'stub-model',
      complete: vi.fn(async () => {
        throw new Error('provider unreachable')
      }),
    }

    await expect(
      handleSummarizeEpisode(
        { episodeId: episode.id, userIds: [user.id] },
        { isFinalAttempt: false, provider, enqueueLinkInsights: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow(/provider unreachable/)

    const updated = await readEpisode(episode.id)
    expect(updated.status).toBe('transcribing')
    expect(updated.failureReason).toBeNull()
    expect(await getDb().select().from(summaries)).toHaveLength(0)
  })

  it('marks the episode failed with the reason on the final attempt', async () => {
    const episode = await seedEpisodeWithTranscript()
    const user = await seedUser('a@example.com')
    const provider = stubProvider({ ...VALID_SUMMARY, tldr: 'Too short.' })

    await expect(
      handleSummarizeEpisode(
        { episodeId: episode.id, userIds: [user.id] },
        { isFinalAttempt: true, provider, enqueueLinkInsights: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow()

    const updated = await readEpisode(episode.id)
    expect(updated.status).toBe('failed')
    expect(updated.failureReason).toContain('schema validation')
  })

  it('fails when a quote timestamp does not exist in the transcript', async () => {
    const episode = await seedEpisodeWithTranscript()
    const user = await seedUser('a@example.com')
    const provider = stubProvider({
      ...VALID_SUMMARY,
      notableQuotes: [{ quote: 'invented', speaker: 'x', timestampSec: 99999 }],
    })

    await expect(
      handleSummarizeEpisode(
        { episodeId: episode.id, userIds: [user.id] },
        { isFinalAttempt: true, provider, enqueueLinkInsights: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow(/timestampSec/)

    expect((await readEpisode(episode.id)).status).toBe('failed')
  })

  it('treats a deleted episode as done rather than retrying forever', async () => {
    const result = await handleSummarizeEpisode(
      { episodeId: crypto.randomUUID() },
      { isFinalAttempt: false, provider: stubProvider(), enqueueLinkInsights: vi.fn(async () => undefined) },
    )

    expect(result.outcome).toBe('episode_missing')
  })

  it('throws when the transcript has not landed yet, so pg-boss retries', async () => {
    const db = getDb()
    const [podcast] = await db
      .insert(podcasts)
      .values({ feedUrl: `https://feeds.example.com/${crypto.randomUUID()}.xml`, title: 'Acquired' })
      .returning()
    if (!podcast) throw new Error('failed to seed podcast')
    const [episode] = await db
      .insert(episodes)
      .values({ podcastId: podcast.id, guid: crypto.randomUUID(), title: 'No Transcript Yet' })
      .returning()
    if (!episode) throw new Error('failed to seed episode')

    await expect(
      handleSummarizeEpisode(
        { episodeId: episode.id },
        { isFinalAttempt: false, provider: stubProvider(), enqueueLinkInsights: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow(/transcript not yet available/)
  })

  it('rejects a malformed payload', async () => {
    await expect(
      handleSummarizeEpisode(
        { episodeId: 'not-a-uuid' },
        { isFinalAttempt: false, provider: stubProvider(), enqueueLinkInsights: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow()
  })
})
