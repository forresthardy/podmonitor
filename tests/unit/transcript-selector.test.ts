import { describe, expect, it } from 'vitest'
import {
  planTranscriptAcquisition,
  resolveTranscriptFormat,
  type TranscriptAttempt,
} from '@/lib/transcripts/selector'
import type { FeedTranscriptCandidate } from '@/lib/transcripts/types'

const AUDIO_URL = 'https://cdn.example.com/episode-42.mp3'

function candidate(overrides: Partial<FeedTranscriptCandidate> = {}): FeedTranscriptCandidate {
  return { url: 'https://cdn.example.com/t.vtt', mimeType: 'text/vtt', ...overrides }
}

/** The plan is only meaningful as an ordered list of sources. */
function sources(attempts: readonly TranscriptAttempt[]): string[] {
  return attempts.map((attempt) =>
    attempt.source === 'feed_tag' ? `feed_tag:${attempt.candidate.url}` : 'asr',
  )
}

describe('planTranscriptAcquisition', () => {
  it('prefers a feed transcript over ASR (the locked transcript-first decision)', () => {
    const { attempts } = planTranscriptAcquisition({
      audioUrl: AUDIO_URL,
      feedTranscripts: [candidate()],
    })

    expect(attempts[0]).toMatchObject({ source: 'feed_tag', format: 'vtt' })
    // ASR stays in the plan as the fallback for a feed transcript that fails to fetch.
    expect(attempts.at(-1)).toEqual({ source: 'asr', audioUrl: AUDIO_URL })
  })

  it('falls back to ASR alone when the feed offers no transcript (Huberman, Invest Like the Best)', () => {
    const { attempts } = planTranscriptAcquisition({ audioUrl: AUDIO_URL, feedTranscripts: [] })

    expect(attempts).toEqual([{ source: 'asr', audioUrl: AUDIO_URL }])
  })

  it('models the Acquired case: speaker-labeled JSON wins over the caption file', () => {
    const { attempts } = planTranscriptAcquisition({
      audioUrl: AUDIO_URL,
      feedTranscripts: [
        candidate({ url: 'https://cdn.example.com/a.srt', mimeType: 'application/x-subrip' }),
        candidate({ url: 'https://cdn.example.com/a.json', mimeType: 'application/json' }),
        candidate({ url: 'https://cdn.example.com/a.vtt', mimeType: 'text/vtt' }),
      ],
    })

    expect(sources(attempts)).toEqual([
      'feed_tag:https://cdn.example.com/a.json',
      'feed_tag:https://cdn.example.com/a.vtt',
      'feed_tag:https://cdn.example.com/a.srt',
      'asr',
    ])
  })

  it('ranks the preferred language ahead of format quality', () => {
    const { attempts } = planTranscriptAcquisition({
      audioUrl: AUDIO_URL,
      feedTranscripts: [
        candidate({ url: 'https://cdn.example.com/de.json', mimeType: 'application/json', language: 'de' }),
        candidate({ url: 'https://cdn.example.com/en.srt', mimeType: 'application/x-subrip', language: 'en-US' }),
      ],
    })

    expect(sources(attempts)).toEqual([
      'feed_tag:https://cdn.example.com/en.srt',
      'feed_tag:https://cdn.example.com/de.json',
      'asr',
    ])
  })

  it('treats an unlabeled language as better than a known mismatch', () => {
    const { attempts } = planTranscriptAcquisition({
      audioUrl: AUDIO_URL,
      feedTranscripts: [
        candidate({ url: 'https://cdn.example.com/fr.vtt', language: 'fr' }),
        candidate({ url: 'https://cdn.example.com/unknown.vtt' }),
      ],
    })

    expect(sources(attempts)).toEqual([
      'feed_tag:https://cdn.example.com/unknown.vtt',
      'feed_tag:https://cdn.example.com/fr.vtt',
      'asr',
    ])
  })

  it('keeps feed order when language and format tie', () => {
    const { attempts } = planTranscriptAcquisition({
      feedTranscripts: [
        candidate({ url: 'https://cdn.example.com/first.vtt' }),
        candidate({ url: 'https://cdn.example.com/second.vtt' }),
      ],
    })

    expect(sources(attempts)).toEqual([
      'feed_tag:https://cdn.example.com/first.vtt',
      'feed_tag:https://cdn.example.com/second.vtt',
    ])
  })

  it('rejects unusable candidates with a stated reason instead of dropping them', () => {
    const { attempts, rejected } = planTranscriptAcquisition({
      audioUrl: AUDIO_URL,
      feedTranscripts: [
        candidate({ url: 'ftp://cdn.example.com/t.vtt' }),
        candidate({ url: 'https://cdn.example.com/audio.mp3', mimeType: 'audio/mpeg' }),
        candidate({ url: 'https://cdn.example.com/dupe.vtt' }),
        candidate({ url: 'https://cdn.example.com/dupe.vtt' }),
      ],
    })

    expect(sources(attempts)).toEqual(['feed_tag:https://cdn.example.com/dupe.vtt', 'asr'])
    expect(rejected.map((entry) => entry.reason)).toEqual([
      'url is not an http(s) URL',
      'unsupported transcript type: audio/mpeg',
      'duplicate url',
    ])
  })

  it('produces no attempts when there is neither a usable transcript nor audio', () => {
    const { attempts } = planTranscriptAcquisition({ audioUrl: null, feedTranscripts: [] })

    expect(attempts).toEqual([])
  })

  it('ignores a non-http audio URL', () => {
    const { attempts } = planTranscriptAcquisition({ audioUrl: 'file:///tmp/local.mp3' })

    expect(attempts).toEqual([])
  })
})

describe('resolveTranscriptFormat', () => {
  it.each([
    ['text/vtt', 'vtt'],
    ['Text/VTT; charset=utf-8', 'vtt'],
    ['application/json', 'json'],
    ['application/x-subrip', 'srt'],
    ['text/plain', 'text'],
    ['text/html', 'text'],
  ])('maps declared type %s to %s', (mimeType, expected) => {
    expect(resolveTranscriptFormat(candidate({ mimeType }))).toBe(expected)
  })

  it('falls back to the URL extension when the feed declares a useless type', () => {
    expect(
      resolveTranscriptFormat(
        candidate({ url: 'https://cdn.example.com/t.srt', mimeType: 'application/octet-stream' }),
      ),
    ).toBe('srt')
  })

  it('ignores query strings when reading the extension', () => {
    expect(
      resolveTranscriptFormat(
        candidate({ url: 'https://cdn.example.com/t.vtt?token=abc', mimeType: '' }),
      ),
    ).toBe('vtt')
  })

  it('returns undefined for a type and extension it cannot place', () => {
    expect(
      resolveTranscriptFormat(candidate({ url: 'https://cdn.example.com/t.bin', mimeType: '' })),
    ).toBeUndefined()
  })
})
