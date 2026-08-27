import { describe, expect, it } from 'vitest'
import { episodeSummarySchema } from '@/lib/summarize/schema'

/**
 * The zod boundary between an LLM's free-form output and a stored row. Every case here
 * mirrors a way a model could plausibly go wrong: too few/too many sentences, a missing
 * field, or a value of the wrong shape.
 */

function validSummary(): Record<string, unknown> {
  return {
    tldr:
      'The hosts trace how a garage project became an industry giant. ' +
      'They dig into the founders\' early bets on distribution. ' +
      'The episode closes on what the company would do differently today.',
    keyInsights: [
      { text: 'Distribution moats compound faster than product moats.', context: 'Discussed re: the 1998 expansion.', timestampSec: 120 },
      { text: 'Early hires shaped the culture more than the founders intended.', context: 'A tangent about hiring #4.', timestampSec: null },
    ],
    notableQuotes: [{ quote: 'We didn\'t know we were building a moat.', speaker: 'Founder', timestampSec: 45.5 }],
    topics: ['distribution', 'company history'],
  }
}

describe('episodeSummarySchema', () => {
  it('accepts a well-formed summary', () => {
    const result = episodeSummarySchema.safeParse(validSummary())
    expect(result.success).toBe(true)
  })

  it('accepts an empty notableQuotes array — not every episode has a quotable moment', () => {
    const summary = { ...validSummary(), notableQuotes: [] }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(true)
  })

  it('rejects a tldr with only two sentences', () => {
    const summary = { ...validSummary(), tldr: 'One sentence. Two sentences.' }
    const result = episodeSummarySchema.safeParse(summary)
    expect(result.success).toBe(false)
  })

  it('rejects a tldr with six sentences', () => {
    const summary = {
      ...validSummary(),
      tldr: 'One. Two. Three. Four. Five. Six.',
    }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('rejects an empty tldr', () => {
    const summary = { ...validSummary(), tldr: '' }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('rejects keyInsights with zero entries', () => {
    const summary = { ...validSummary(), keyInsights: [] }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('rejects an insight missing its context field', () => {
    const summary = {
      ...validSummary(),
      keyInsights: [{ text: 'Something happened.', timestampSec: 10 }],
    }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('rejects a negative insight timestamp', () => {
    const summary = {
      ...validSummary(),
      keyInsights: [{ text: 'x', context: 'y', timestampSec: -5 }],
    }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('rejects a quote with a string timestamp instead of a number', () => {
    const summary = {
      ...validSummary(),
      notableQuotes: [{ quote: 'x', speaker: 'y', timestampSec: '45' }],
    }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('rejects a quote missing its speaker', () => {
    const summary = {
      ...validSummary(),
      notableQuotes: [{ quote: 'x', timestampSec: 10 }],
    }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('rejects an empty topics array', () => {
    const summary = { ...validSummary(), topics: [] }
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })

  it('rejects a summary missing the topics field entirely', () => {
    const summary = validSummary()
    delete summary.topics
    expect(episodeSummarySchema.safeParse(summary).success).toBe(false)
  })
})
