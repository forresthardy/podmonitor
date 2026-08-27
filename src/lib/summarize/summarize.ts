import type { TranscriptSegment } from '@/db/schema'
import { llmMaxAttempts, llmRetryBaseDelayMs } from '@/lib/env'
import type { LLMProvider } from '@/lib/llm/types'
import { withRateLimitRetry } from '@/lib/llm/retry'
import { buildSummarizationPrompt } from './prompt'
import { parseEpisodeSummary } from './parse'
import { assertQuotesAreGrounded } from './validate-quotes'
import type { EpisodeSummary } from './schema'

export interface SummarizeTranscriptInput {
  episodeTitle: string
  podcastTitle?: string
  transcriptSegments: readonly TranscriptSegment[]
}

export interface SummarizeTranscriptDeps {
  provider: LLMProvider
  maxAttempts?: number
  baseDelayMs?: number
  /** Injectable so retry-with-backoff tests never actually sleep. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Transcript in, validated `EpisodeSummary` out.
 *
 * Three checks gate the result before it's trusted: the provider call itself (retried on
 * rate limits), the response's JSON/zod shape, and — the one thing zod cannot verify — that
 * every quoted timestamp is grounded in a real transcript segment, not a hallucinated one.
 */
export async function summarizeTranscript(
  input: SummarizeTranscriptInput,
  deps: SummarizeTranscriptDeps,
): Promise<EpisodeSummary> {
  const messages = buildSummarizationPrompt(input)

  const raw = await withRateLimitRetry(
    () =>
      deps.provider.complete({
        messages,
        temperature: 0.2,
        maxTokens: 2000,
      }),
    {
      maxAttempts: deps.maxAttempts ?? llmMaxAttempts(),
      baseDelayMs: deps.baseDelayMs ?? llmRetryBaseDelayMs(),
      sleep: deps.sleep,
    },
  )

  const summary = parseEpisodeSummary(raw)
  assertQuotesAreGrounded(summary.notableQuotes, input.transcriptSegments)
  return summary
}
