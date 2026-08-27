import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TranscriptSegment } from '@/db/schema'
import type { LLMProvider } from '@/lib/llm/types'
import { QuoteTimestampError } from '@/lib/summarize/validate-quotes'
import { SummaryParseError } from '@/lib/summarize/parse'
import { summarizeTranscript } from '@/lib/summarize/summarize'

/**
 * End-to-end over a real (fixture) transcript: prompt building, a stubbed provider
 * response, zod validation, and quote-timestamp grounding all have to agree for this to
 * pass — the closest thing to an integration test that doesn't need a live LLM.
 */

const FIXTURE_PATH = join(
  __dirname,
  '..',
  'fixtures',
  'transcripts',
  'standard-oil-episode.json',
)
const TRANSCRIPT_SEGMENTS: TranscriptSegment[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))

function stubProvider(response: string): LLMProvider {
  return {
    name: 'stub',
    model: 'stub-model',
    complete: vi.fn(async () => response),
  }
}

const VALID_RESPONSE = JSON.stringify({
  tldr:
    'The episode traces how John Rockefeller built Standard Oil into a refining monopoly. ' +
    'The hosts argue the real moat was control of pipelines and railroads, not oil itself. ' +
    'It closes on the 1911 antitrust breakup that ironically made the pieces worth more ' +
    'than the whole.',
  keyInsights: [
    {
      text: 'Distribution and logistics were the real moat, not oil discovery.',
      context: 'Discussed when explaining why Rockefeller focused on pipelines and railroads.',
      timestampSec: 61.0,
    },
    {
      text: 'Breaking up a monopoly can increase total shareholder value.',
      context: 'The 1911 breakup made the sum of the parts worth more than Standard Oil whole.',
      timestampSec: 114.7,
    },
  ],
  notableQuotes: [
    {
      quote: 'We didn\u2019t need to drill a single well to control the industry.',
      speaker: 'David Rosenthal',
      timestampSec: 45.9,
    },
  ],
  topics: ['Standard Oil', 'monopoly', 'distribution moats', 'antitrust'],
})

describe('summarizeTranscript (fixture transcript)', () => {
  it('produces a validated, quote-grounded EpisodeSummary from a real transcript', async () => {
    const provider = stubProvider(VALID_RESPONSE)

    const summary = await summarizeTranscript(
      { episodeTitle: 'Standard Oil', podcastTitle: 'Acquired', transcriptSegments: TRANSCRIPT_SEGMENTS },
      { provider },
    )

    expect(summary.tldr).toContain('Rockefeller')
    expect(summary.keyInsights.length).toBeGreaterThan(0)
    expect(summary.notableQuotes).toEqual([
      {
        quote: 'We didn\u2019t need to drill a single well to control the industry.',
        speaker: 'David Rosenthal',
        timestampSec: 45.9,
      },
    ])
    expect(summary.topics).toContain('Standard Oil')

    // The prompt actually carried the transcript content into the provider call.
    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: expect.stringContaining('Rockefeller') }),
        ]),
      }),
    )
  })

  it('rejects a response whose quote timestamp does not exist in the transcript', async () => {
    const badResponse = JSON.parse(VALID_RESPONSE)
    badResponse.notableQuotes = [
      { quote: 'a line that was never said', speaker: 'Ben Gilbert', timestampSec: 9999 },
    ]
    const provider = stubProvider(JSON.stringify(badResponse))

    await expect(
      summarizeTranscript(
        { episodeTitle: 'Standard Oil', transcriptSegments: TRANSCRIPT_SEGMENTS },
        { provider },
      ),
    ).rejects.toBeInstanceOf(QuoteTimestampError)
  })

  it('rejects a response that fails schema validation (tldr too short)', async () => {
    const badResponse = JSON.parse(VALID_RESPONSE)
    badResponse.tldr = 'Too short.'
    const provider = stubProvider(JSON.stringify(badResponse))

    await expect(
      summarizeTranscript(
        { episodeTitle: 'Standard Oil', transcriptSegments: TRANSCRIPT_SEGMENTS },
        { provider },
      ),
    ).rejects.toBeInstanceOf(SummaryParseError)
  })

  it('rejects a non-JSON response', async () => {
    const provider = stubProvider('Sure, here is a summary of the episode: ...')

    await expect(
      summarizeTranscript(
        { episodeTitle: 'Standard Oil', transcriptSegments: TRANSCRIPT_SEGMENTS },
        { provider },
      ),
    ).rejects.toBeInstanceOf(SummaryParseError)
  })
})
