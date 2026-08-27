import { describe, expect, it, vi } from 'vitest'
import {
  acquireTranscript,
  MIN_FEED_TRANSCRIPT_CHARS,
  TranscriptAcquisitionError,
  type AcquisitionDeps,
} from '@/lib/transcripts/acquire'

/**
 * The locked decision under test: publisher transcripts win, ASR is the fallback, and
 * ASR runs only after a publisher transcript has actually failed.
 */

const VTT = `WEBVTT

00:00:00.000 --> 00:00:06.000
<v Ben Gilbert>${'Welcome to Acquired, the show about great companies. '.repeat(6)}

00:00:06.000 --> 00:00:12.000
<v David Rosenthal>${'Today we are telling the story of a business. '.repeat(6)}
`

const AUDIO_URL = 'https://cdn.example.com/episode.mp3'

function deps(overrides: Partial<AcquisitionDeps> = {}): AcquisitionDeps {
  return {
    fetchTranscriptFile: vi.fn(async () => VTT),
    transcribeFromUrl: vi.fn(async () => ({
      model: 'small',
      segments: [{ start: 0, end: 4, text: 'Transcribed by the sidecar.' }],
    })),
    ...overrides,
  }
}

describe('acquireTranscript', () => {
  it('uses the feed transcript and never calls the sidecar', async () => {
    const injected = deps()

    const result = await acquireTranscript(
      {
        audioUrl: AUDIO_URL,
        feedTranscripts: [{ url: 'https://acquired.fm/ep.vtt', mimeType: 'text/vtt' }],
      },
      injected,
    )

    expect(result.source).toBe('feed_tag')
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]?.speaker).toBe('Ben Gilbert')
    expect(result.fullText).toContain('Ben Gilbert: Welcome to Acquired')
    // The whole point of transcript-first: no ASR spend when the publisher provides one.
    expect(injected.transcribeFromUrl).not.toHaveBeenCalled()
  })

  it('records the source on the result so the transcript row can attribute it', async () => {
    const result = await acquireTranscript({ audioUrl: AUDIO_URL, feedTranscripts: [] }, deps())

    expect(result.source).toBe('asr')
  })

  it('falls back to ASR when the transcript file cannot be fetched', async () => {
    const injected = deps({
      fetchTranscriptFile: vi.fn(async () => {
        throw new Error('HTTP 404')
      }),
    })

    const result = await acquireTranscript(
      {
        audioUrl: AUDIO_URL,
        feedTranscripts: [{ url: 'https://example.com/missing.vtt', mimeType: 'text/vtt' }],
      },
      injected,
    )

    expect(result.source).toBe('asr')
    expect(result.attempts).toEqual([
      { source: 'feed_tag', url: 'https://example.com/missing.vtt', ok: false, detail: 'HTTP 404' },
      expect.objectContaining({ source: 'asr', ok: true }),
    ])
  })

  it('rejects a suspiciously short transcript and falls back to ASR', async () => {
    // Publisher "transcript" URLs that actually serve a placeholder page are common; a
    // 20-character transcript for an hour-long episode is not a transcript.
    const injected = deps({ fetchTranscriptFile: vi.fn(async () => 'Coming soon.') })

    const result = await acquireTranscript(
      {
        audioUrl: AUDIO_URL,
        feedTranscripts: [{ url: 'https://example.com/soon.txt', mimeType: 'text/plain' }],
      },
      injected,
    )

    expect(result.source).toBe('asr')
    expect(result.attempts[0]).toMatchObject({
      source: 'feed_tag',
      ok: false,
      detail: expect.stringContaining(`minimum ${MIN_FEED_TRANSCRIPT_CHARS}`),
    })
  })

  it('tries every feed candidate before reaching for ASR', async () => {
    const fetchTranscriptFile = vi
      .fn<(url: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce(VTT)

    const result = await acquireTranscript(
      {
        audioUrl: AUDIO_URL,
        feedTranscripts: [
          { url: 'https://example.com/a.json', mimeType: 'application/json' },
          { url: 'https://example.com/b.vtt', mimeType: 'text/vtt' },
        ],
      },
      deps({ fetchTranscriptFile }),
    )

    expect(result.source).toBe('feed_tag')
    expect(fetchTranscriptFile).toHaveBeenCalledTimes(2)
    // JSON outranks VTT, so the richer format is attempted first.
    expect(fetchTranscriptFile.mock.calls[0]?.[0]).toBe('https://example.com/a.json')
  })

  it('treats an empty ASR result as a failure rather than an empty transcript', async () => {
    const injected = deps({
      transcribeFromUrl: vi.fn(async () => ({ model: 'small', segments: [] })),
    })

    await expect(
      acquireTranscript({ audioUrl: AUDIO_URL, feedTranscripts: [] }, injected),
    ).rejects.toBeInstanceOf(TranscriptAcquisitionError)
  })

  it('fails with every attempt recorded when all sources fail', async () => {
    const injected = deps({
      fetchTranscriptFile: vi.fn(async () => {
        throw new Error('connection reset')
      }),
      transcribeFromUrl: vi.fn(async () => {
        throw new Error('sidecar unreachable')
      }),
    })

    const error = await acquireTranscript(
      {
        audioUrl: AUDIO_URL,
        feedTranscripts: [{ url: 'https://example.com/a.vtt', mimeType: 'text/vtt' }],
      },
      injected,
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TranscriptAcquisitionError)
    const acquisitionError = error as TranscriptAcquisitionError
    expect(acquisitionError.attempts).toHaveLength(2)
    expect(acquisitionError.attempts.every((attempt) => !attempt.ok)).toBe(true)
    // The reason has to name what was tried; "transcription failed" tells an operator nothing.
    expect(acquisitionError.message).toContain('connection reset')
    expect(acquisitionError.message).toContain('sidecar unreachable')
  })

  it('fails immediately when the episode has neither transcripts nor audio', async () => {
    const injected = deps()

    await expect(
      acquireTranscript({ audioUrl: null, feedTranscripts: [] }, injected),
    ).rejects.toThrow(/no transcript source available/)
    expect(injected.fetchTranscriptFile).not.toHaveBeenCalled()
    expect(injected.transcribeFromUrl).not.toHaveBeenCalled()
  })
})
