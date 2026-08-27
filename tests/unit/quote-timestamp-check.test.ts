import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '@/db/schema'
import {
  assertQuotesAreGrounded,
  findUngroundedQuotes,
  QuoteTimestampError,
} from '@/lib/summarize/validate-quotes'

/**
 * Every quote's timestamp must exist in the transcript — the check that stops a model
 * from citing a real-sounding quote at a timestamp it invented.
 */

const SEGMENTS: TranscriptSegment[] = [
  { start: 0, end: 10, text: 'first segment' },
  { start: 10, end: 20.5, text: 'second segment' },
  { start: 20.5, end: 35, text: 'third segment' },
]

describe('findUngroundedQuotes', () => {
  it('finds nothing wrong when every quote falls inside a segment', () => {
    const quotes = [
      { quote: 'a', speaker: 'x', timestampSec: 5 },
      { quote: 'b', speaker: 'x', timestampSec: 20.5 }, // exact segment boundary
      { quote: 'c', speaker: 'x', timestampSec: 34.9 },
    ]
    expect(findUngroundedQuotes(quotes, SEGMENTS)).toEqual([])
  })

  it('flags a quote whose timestamp falls in a gap between segments', () => {
    const quotes = [{ quote: 'time travel', speaker: 'x', timestampSec: 9999 }]
    expect(findUngroundedQuotes(quotes, SEGMENTS)).toEqual([
      { quote: 'time travel', timestampSec: 9999 },
    ])
  })

  it('flags only the offending quote among several', () => {
    const quotes = [
      { quote: 'grounded', speaker: 'x', timestampSec: 5 },
      { quote: 'invented', speaker: 'x', timestampSec: 500 },
    ]
    expect(findUngroundedQuotes(quotes, SEGMENTS)).toEqual([
      { quote: 'invented', timestampSec: 500 },
    ])
  })

  it('returns an empty array with no segments and no quotes', () => {
    expect(findUngroundedQuotes([], [])).toEqual([])
  })
})

describe('assertQuotesAreGrounded', () => {
  it('does not throw when every quote is grounded', () => {
    expect(() =>
      assertQuotesAreGrounded([{ quote: 'a', speaker: 'x', timestampSec: 5 }], SEGMENTS),
    ).not.toThrow()
  })

  it('throws QuoteTimestampError naming the offending quote', () => {
    expect(() =>
      assertQuotesAreGrounded(
        [{ quote: 'made up quote', speaker: 'x', timestampSec: 41 }],
        SEGMENTS,
      ),
    ).toThrow(QuoteTimestampError)

    try {
      assertQuotesAreGrounded([{ quote: 'made up quote', speaker: 'x', timestampSec: 41 }], SEGMENTS)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(QuoteTimestampError)
      expect((error as QuoteTimestampError).issues).toEqual([
        { quote: 'made up quote', timestampSec: 41 },
      ])
      expect((error as Error).message).toContain('made up quote')
    }
  })
})
