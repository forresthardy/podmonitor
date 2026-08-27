import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/db/client'
import { episodes, podcasts, transcripts } from '@/db/schema'
import type { AcquisitionDeps } from '@/lib/transcripts/acquire'
import { handleAcquireTranscript } from '@/queue/handlers/acquire-transcript'
import { resetDatabase } from '../helpers/db'

/**
 * The acquisition stage against a real database with a mocked sidecar. What is under test
 * is persistence and the state machine: segments land as jsonb, the source is recorded on
 * the episode, and a failure only becomes `failed` once retries are exhausted.
 */

const AUDIO_URL = 'https://cdn.example.com/episode-42.mp3'

const FEED_VTT = `WEBVTT

00:00:00.000 --> 00:00:08.000
<v Ben Gilbert>${'This is the story of a company that changed an industry. '.repeat(5)}

00:00:08.000 --> 00:00:16.000
<v David Rosenthal>${'And it starts, as these stories often do, in a garage. '.repeat(5)}
`

function sidecarDeps(overrides: Partial<AcquisitionDeps> = {}): AcquisitionDeps {
  return {
    fetchTranscriptFile: vi.fn(async () => {
      throw new Error('no feed transcript configured for this test')
    }),
    transcribeFromUrl: vi.fn(async () => ({
      model: 'small',
      segments: [
        { start: 0, end: 5.5, text: 'Transcribed segment one.' },
        { start: 5.5, end: 11, text: 'Transcribed segment two.' },
      ],
    })),
    ...overrides,
  }
}

async function seedEpisode(
  overrides: Partial<typeof episodes.$inferInsert> = {},
): Promise<typeof episodes.$inferSelect> {
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
      audioUrl: AUDIO_URL,
      ...overrides,
    })
    .returning()
  if (!episode) throw new Error('failed to seed episode')
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

describe('handleAcquireTranscript', () => {
  it('stores an ASR transcript with segments and records the source on the episode', async () => {
    const episode = await seedEpisode()
    const enqueueSummarize = vi.fn(async () => undefined)

    const result = await handleAcquireTranscript(
      { episodeId: episode.id },
      { isFinalAttempt: false, deps: sidecarDeps(), enqueueSummarize },
    )

    expect(result).toEqual({
      outcome: 'acquired',
      episodeId: episode.id,
      source: 'asr',
      segmentCount: 2,
    })

    const [stored] = await getDb()
      .select()
      .from(transcripts)
      .where(eq(transcripts.episodeId, episode.id))

    expect(stored?.fullText).toBe('Transcribed segment one.\nTranscribed segment two.')
    // Segments must survive the jsonb round-trip with their timings intact — they are
    // what lets a summary quote link back to a moment in the audio.
    expect(stored?.segments).toEqual([
      { start: 0, end: 5.5, text: 'Transcribed segment one.' },
      { start: 5.5, end: 11, text: 'Transcribed segment two.' },
    ])

    const updated = await readEpisode(episode.id)
    expect(updated.transcriptSource).toBe('asr')
    expect(updated.status).toBe('transcribing')
    expect(updated.failureReason).toBeNull()
    expect(enqueueSummarize).toHaveBeenCalledWith(episode.id)
  })

  it('prefers the feed transcript and records feed_tag as the source', async () => {
    const episode = await seedEpisode()
    const deps = sidecarDeps({ fetchTranscriptFile: vi.fn(async () => FEED_VTT) })

    const result = await handleAcquireTranscript(
      {
        episodeId: episode.id,
        feedTranscripts: [{ url: 'https://acquired.fm/ep42.vtt', mimeType: 'text/vtt' }],
      },
      { isFinalAttempt: false, deps, enqueueSummarize: vi.fn(async () => undefined) },
    )

    expect(result.source).toBe('feed_tag')
    expect((await readEpisode(episode.id)).transcriptSource).toBe('feed_tag')
    // Speaker labels are the reason publisher transcripts win when they exist.
    const [stored] = await getDb()
      .select()
      .from(transcripts)
      .where(eq(transcripts.episodeId, episode.id))
    expect(stored?.segments[0]?.speaker).toBe('Ben Gilbert')
    expect(deps.transcribeFromUrl).not.toHaveBeenCalled()
  })

  it('moves the episode to transcribing before doing any work', async () => {
    const episode = await seedEpisode({ status: 'discovered' })
    let statusDuringWork: string | undefined

    await handleAcquireTranscript(
      { episodeId: episode.id },
      {
        isFinalAttempt: false,
        deps: sidecarDeps({
          transcribeFromUrl: vi.fn(async () => {
            statusDuringWork = (await readEpisode(episode.id)).status
            return { model: 'small', segments: [{ start: 0, end: 1, text: 'One.' }] }
          }),
        }),
        enqueueSummarize: vi.fn(async () => undefined),
      },
    )

    expect(statusDuringWork).toBe('transcribing')
  })

  it('clears a previous failure when a retry succeeds', async () => {
    const episode = await seedEpisode({ status: 'failed', failureReason: 'sidecar was down' })

    await handleAcquireTranscript(
      { episodeId: episode.id },
      { isFinalAttempt: false, deps: sidecarDeps(), enqueueSummarize: vi.fn(async () => undefined) },
    )

    const updated = await readEpisode(episode.id)
    expect(updated.status).toBe('transcribing')
    expect(updated.failureReason).toBeNull()
  })

  it('rethrows without marking the episode failed while retries remain', async () => {
    const episode = await seedEpisode()
    const deps = sidecarDeps({
      transcribeFromUrl: vi.fn(async () => {
        throw new Error('sidecar connection refused')
      }),
    })

    await expect(
      handleAcquireTranscript(
        { episodeId: episode.id },
        { isFinalAttempt: false, deps, enqueueSummarize: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow(/sidecar connection refused/)

    const updated = await readEpisode(episode.id)
    // Still in flight: pg-boss will deliver this job again.
    expect(updated.status).toBe('transcribing')
    expect(updated.failureReason).toBeNull()
    expect(await getDb().select().from(transcripts)).toHaveLength(0)
  })

  it('marks the episode failed with the reason on the final attempt', async () => {
    const episode = await seedEpisode()
    const deps = sidecarDeps({
      fetchTranscriptFile: vi.fn(async () => {
        throw new Error('HTTP 403 from publisher')
      }),
      transcribeFromUrl: vi.fn(async () => {
        throw new Error('sidecar connection refused')
      }),
    })

    await expect(
      handleAcquireTranscript(
        {
          episodeId: episode.id,
          feedTranscripts: [{ url: 'https://acquired.fm/ep42.vtt', mimeType: 'text/vtt' }],
        },
        { isFinalAttempt: true, deps, enqueueSummarize: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow()

    const updated = await readEpisode(episode.id)
    expect(updated.status).toBe('failed')
    // The stored reason names both attempts, so an operator does not have to read logs.
    expect(updated.failureReason).toContain('HTTP 403 from publisher')
    expect(updated.failureReason).toContain('sidecar connection refused')
  })

  it('fails an episode with neither a transcript nor audio', async () => {
    const episode = await seedEpisode({ audioUrl: null })

    await expect(
      handleAcquireTranscript(
        { episodeId: episode.id },
        {
          isFinalAttempt: true,
          deps: sidecarDeps(),
          enqueueSummarize: vi.fn(async () => undefined),
        },
      ),
    ).rejects.toThrow(/no transcript source available/)

    expect((await readEpisode(episode.id)).status).toBe('failed')
  })

  it('is idempotent: a re-delivered job re-enqueues instead of re-transcribing', async () => {
    const episode = await seedEpisode()
    const enqueueSummarize = vi.fn(async () => undefined)
    const deps = sidecarDeps()

    await handleAcquireTranscript(
      { episodeId: episode.id },
      { isFinalAttempt: false, deps, enqueueSummarize },
    )
    const second = await handleAcquireTranscript(
      { episodeId: episode.id },
      { isFinalAttempt: false, deps, enqueueSummarize },
    )

    expect(second).toEqual({ outcome: 'already_present', episodeId: episode.id })
    // The expensive half of the pipeline must not run twice.
    expect(deps.transcribeFromUrl).toHaveBeenCalledTimes(1)
    expect(await getDb().select().from(transcripts)).toHaveLength(1)
    // Handing off again matters: the first delivery may have died before enqueueing.
    expect(enqueueSummarize).toHaveBeenCalledTimes(2)
  })

  it('treats a deleted episode as done rather than retrying forever', async () => {
    const result = await handleAcquireTranscript(
      { episodeId: crypto.randomUUID() },
      { isFinalAttempt: false, deps: sidecarDeps(), enqueueSummarize: vi.fn(async () => undefined) },
    )

    expect(result.outcome).toBe('episode_missing')
  })

  it('rejects a malformed payload', async () => {
    await expect(
      handleAcquireTranscript(
        { episodeId: 'not-a-uuid' },
        {
          isFinalAttempt: false,
          deps: sidecarDeps(),
          enqueueSummarize: vi.fn(async () => undefined),
        },
      ),
    ).rejects.toThrow()
  })
})
