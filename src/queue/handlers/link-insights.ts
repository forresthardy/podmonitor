import type PgBoss from 'pg-boss'
import { z } from 'zod'
import type { Database } from '@/db/client'
import type { EmbeddingProvider } from '@/lib/embeddings/types'
import { linkSummaryInsights, type LinkSummaryResult } from '@/lib/knowledge/link-service'
import type { LLMProvider } from '@/lib/llm/types'
import { QUEUES } from '../queues'

/**
 * The cross-referencing stage: runs right after a summary is stored (enqueued by
 * `summarize-episode`) and turns that summary's insights into linked knowledge-base rows.
 *
 * Deliberately *not* part of the summarization job: it is a second set of provider calls
 * with its own rate limits and its own failure modes, and a linking hiccup must never cost
 * a summary that was already produced.
 */
export const linkInsightsPayloadSchema = z.object({
  episodeId: z.string().uuid(),
  summaryId: z.string().uuid(),
})

export type LinkInsightsPayload = z.infer<typeof linkInsightsPayloadSchema>

export interface LinkInsightsContext {
  db?: Database
  embeddingProvider?: EmbeddingProvider
  llmProvider?: LLMProvider
}

/**
 * Links one summary's insights against the user's existing knowledge base.
 *
 * @throws on any provider or database fault, so pg-boss retries. The episode's status is
 * deliberately left at `summarized`: the summary is stored and readable, and showing a
 * readable episode as `failed` because an enrichment pass failed would misreport it. The
 * failure surfaces through the job's own retry/failure record instead.
 */
export async function handleLinkInsights(
  rawPayload: unknown,
  context: LinkInsightsContext = {},
): Promise<LinkSummaryResult> {
  const payload = linkInsightsPayloadSchema.parse(rawPayload)

  return linkSummaryInsights(payload.summaryId, {
    ...(context.db ? { db: context.db } : {}),
    ...(context.embeddingProvider ? { embeddingProvider: context.embeddingProvider } : {}),
    ...(context.llmProvider ? { llmProvider: context.llmProvider } : {}),
  })
}

/**
 * Registers the `link-insights` pg-boss worker.
 *
 * `batchSize: 1` for the same reason as summarization: relation classification shares the
 * one free-tier LLM rate limit, so these jobs must not run concurrently.
 */
export async function registerLinkInsightsWorker(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.linkInsights, { includeMetadata: true, batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      const result = await handleLinkInsights(job.data)
      console.log(
        `[link-insights] job ${job.id}: ${result.outcome} ` +
          `(${result.insightsCreated} insight(s), ${result.linksCreated} link(s))`,
      )
    }
  })
}
