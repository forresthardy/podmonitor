import { describe, expect, it } from 'vitest'
import type { DigestSourceRow } from '@/lib/digest/assemble'
import { assembleDigest, MAX_INSIGHTS_PER_EPISODE } from '@/lib/digest/assemble'

function row(overrides: Partial<DigestSourceRow> = {}): DigestSourceRow {
  return {
    episodeId: crypto.randomUUID(),
    episodeTitle: 'An Episode',
    podcastTitle: 'A Podcast',
    publishedAt: new Date('2026-08-20T00:00:00.000Z'),
    summaryTldr: 'A short TL;DR.',
    summaryInsights: [
      { text: 'Insight one.', context: 'x', timestampSec: 1 },
      { text: 'Insight two.', context: 'x', timestampSec: 2 },
    ],
    ...overrides,
  }
}

describe('assembleDigest', () => {
  it('is pure: it does no I/O and only transforms the given rows', () => {
    const rows = [row()]
    const content = assembleDigest('user-1', '2026-08-24', rows)

    expect(content.userId).toBe('user-1')
    expect(content.weekOf).toBe('2026-08-24')
    expect(content.episodes).toHaveLength(1)
    // The input is untouched — assembleDigest must not mutate its argument.
    expect(rows).toHaveLength(1)
  })

  it('orders episodes newest-published-first', () => {
    const oldest = row({ episodeTitle: 'Oldest', publishedAt: new Date('2026-08-10T00:00:00Z') })
    const newest = row({ episodeTitle: 'Newest', publishedAt: new Date('2026-08-22T00:00:00Z') })
    const middle = row({ episodeTitle: 'Middle', publishedAt: new Date('2026-08-15T00:00:00Z') })

    const content = assembleDigest('user-1', '2026-08-24', [oldest, newest, middle])

    expect(content.episodes.map((episode) => episode.episodeTitle)).toEqual([
      'Newest',
      'Middle',
      'Oldest',
    ])
  })

  it('sorts an episode with no publish date to the back', () => {
    const undated = row({ episodeTitle: 'Undated', publishedAt: null })
    const dated = row({ episodeTitle: 'Dated', publishedAt: new Date('2026-08-01T00:00:00Z') })

    const content = assembleDigest('user-1', '2026-08-24', [undated, dated])

    expect(content.episodes.map((episode) => episode.episodeTitle)).toEqual(['Dated', 'Undated'])
  })

  it('caps insights per episode at MAX_INSIGHTS_PER_EPISODE, keeping the first N', () => {
    const insights = Array.from({ length: MAX_INSIGHTS_PER_EPISODE + 5 }, (_, index) => ({
      text: `Insight ${index}`,
      context: 'x',
      timestampSec: index,
    }))

    const content = assembleDigest('user-1', '2026-08-24', [row({ summaryInsights: insights })])

    expect(content.episodes[0]?.topInsights).toHaveLength(MAX_INSIGHTS_PER_EPISODE)
    expect(content.episodes[0]?.topInsights.map((insight) => insight.text)).toEqual(
      insights.slice(0, MAX_INSIGHTS_PER_EPISODE).map((insight) => insight.text),
    )
  })

  it('carries through an episode with zero insights rather than dropping it', () => {
    const content = assembleDigest('user-1', '2026-08-24', [row({ summaryInsights: [] })])

    expect(content.episodes).toHaveLength(1)
    expect(content.episodes[0]?.topInsights).toEqual([])
  })

  it('returns an empty episode list for an empty input', () => {
    const content = assembleDigest('user-1', '2026-08-24', [])

    expect(content.episodes).toEqual([])
  })

  it('carries the tldr and podcast/episode titles through unchanged', () => {
    const source = row({
      episodeTitle: 'The Standard Oil Episode',
      podcastTitle: 'Acquired',
      summaryTldr: 'Rockefeller built a refining monopoly.',
    })

    const content = assembleDigest('user-1', '2026-08-24', [source])

    expect(content.episodes[0]).toMatchObject({
      episodeId: source.episodeId,
      episodeTitle: 'The Standard Oil Episode',
      podcastTitle: 'Acquired',
      tldr: 'Rockefeller built a refining monopoly.',
    })
  })
})
