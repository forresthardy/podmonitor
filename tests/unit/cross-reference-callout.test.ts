import { describe, expect, it } from 'vitest'
import { formatCallout } from '@/lib/knowledge/cross-references'

describe('formatCallout', () => {
  const related = {
    ordinal: 2,
    episodeTitle: 'The Standard Oil Episode',
    publishedAt: new Date('2025-11-04T00:00:00Z'),
  }

  it('names the relation, the insight number, the episode, and the month', () => {
    expect(formatCallout('echoes', related)).toBe(
      'This echoes insight #2 from “The Standard Oil Episode”, Nov 2025',
    )
    expect(formatCallout('extends', related)).toContain('This extends insight #2')
    expect(formatCallout('contradicts', related)).toContain('This contradicts insight #2')
  })

  it('drops the date clause when the feed gave no publish date', () => {
    expect(formatCallout('echoes', { ...related, publishedAt: null })).toBe(
      'This echoes insight #2 from “The Standard Oil Episode”',
    )
  })

  it('reads the month in UTC, not the runner local zone', () => {
    // 23:30 UTC on the 31st is still January everywhere the date is stored.
    expect(
      formatCallout('echoes', { ...related, publishedAt: new Date('2026-01-31T23:30:00Z') }),
    ).toContain('Jan 2026')
  })
})
