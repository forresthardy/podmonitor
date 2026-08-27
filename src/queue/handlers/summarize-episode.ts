import { and, eq, inArray } from 'drizzle-orm'
import type PgBoss from 'pg-boss'
import { z } from 'zod'
import { getDb, type Database } from '@/db/client'
import { episodes, summaries, transcripts, users } from '@/db/schema'
import { createLLMProviderFromEnv } from '@/lib/llm/provider'
import type { LLMProvider } from '@/lib/llm/types'
import { QuoteTimestampError } from '@/lib/summarize/validate-quotes'
import { SummaryParseError } from '@/lib/summarize/parse'
import { summarizeTranscript } from '@/lib/summarize/summarize'
import { QUEUES } from '../queues'

/**
 * The summarization stage.
 *
 * Owns the episode's `transcribing` → `summarized` transition. Summaries are per-user
 * (each user's digest is built from their own row), but the LLM call itself is made once
 * per episode and fanned out to every target user — there is exactly one correct summary
 * of an episode, and a second identical LLM call per user would only multiply rate-limit
 * pressure and cost for no benefit.
 */
export const summarizeEpisodePayloadSchema = z.object({
  episodeId: z.string().uuid(),
  /** Explicit targets (e.g. one new signup) or omitted to summarize for every user. */
  userIds: z.array(z.string().uuid()).optional(),
})

export type SummarizeEpisodePayload = z.infer<typeof summarizeEpisodePayloadSchema>

export type SummarizeEpisodeOutcome =
  | 'summarized'
  | 'already_present'
  | 'episode_missing'
  | 'no_target_users'

export interface SummarizeEpisodeResult {
  outcome: SummarizeEpisodeOutcome
  episodeId: string
  summarizedUserIds?: string[]
}

export interface SummarizeEpisodeContext {
  /** True on the last pg-boss attempt: only then is the episode marked failed. */
  isFinalAttempt: boolean
  db?: Database
  provider?: LLMProvider
  /** Injected so the integration test does not need a running pg-boss. */
  enqueueLinkInsights?: (episodeId: string, summaryId: string) => Promise<void>
}

/** Postgres text columns are unbounded, but an unbounded reason in the UI is not useful. */
const MAX_FAILURE_REASON_CHARS = 2000

async function defaultEnqueueLinkInsights(episodeId: string, summaryId: string): Promise<void> {
  // Imported lazily so importing this module does not construct a pg-boss connection —
  // the integration test imports the handler without a queue running.
  const { getBoss } = await import('../boss')
  const boss = await getBoss()
  await boss.send(QUEUES.linkInsights, { episodeId, summaryId })
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function describeError(error: unknown): string {
  if (error instanceof QuoteTimestampError || error instanceof SummaryParseError) {
    return error.message
  }
  return `unexpected summarization failure: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * Summarizes one episode and stores a `summaries` row per target user.
 *
 * @throws when summarization fails, so pg-boss retries. On the final attempt the episode
 * is marked `failed` with the reason before rethrowing, mirroring `acquire-transcript`.
 */
export async function handleSummarizeEpisode(
  rawPayload: unknown,
  context: SummarizeEpisodeContext,
): Promise<SummarizeEpisodeResult> {
  const payload = summarizeEpisodePayloadSchema.parse(rawPayload)
  const db = context.db ?? getDb()
  const enqueueLinkInsights = context.enqueueLinkInsights ?? defaultEnqueueLinkInsights

  const [episode] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, payload.episodeId))
    .limit(1)

  if (!episode) {
    // A deleted episode is not a retryable fault: returning lets the job succeed empty.
    return { outcome: 'episode_missing', episodeId: payload.episodeId }
  }

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.episodeId, episode.id))
    .limit(1)

  if (!transcript) {
    // Out-of-order delivery: the transcript hasn't landed yet. Retryable, not a hard
    // failure — acquire-transcript enqueues this job right after storing the transcript,
    // so this should only happen on a genuinely out-of-order redelivery.
    throw new Error(`transcript not yet available for episode ${episode.id}`)
  }

  const targetUserIds =
    payload.userIds ?? (await db.select({ id: users.id }).from(users)).map((row) => row.id)

  if (targetUserIds.length === 0) {
    return { outcome: 'no_target_users', episodeId: episode.id }
  }

  const existingRows = await db
    .select({ userId: summaries.userId })
    .from(summaries)
    .where(and(eq(summaries.episodeId, episode.id), inArray(summaries.userId, targetUserIds)))
  const existingUserIds = new Set(existingRows.map((row) => row.userId))
  const missingUserIds = targetUserIds.filter((userId) => !existingUserIds.has(userId))

  if (missingUserIds.length === 0) {
    // Re-delivery after every target user already has a summary: nothing left to do.
    return { outcome: 'already_present', episodeId: episode.id, summarizedUserIds: [] }
  }

  const provider = context.provider ?? createLLMProviderFromEnv()

  try {
    const summary = await summarizeTranscript(
      { episodeTitle: episode.title, transcriptSegments: transcript.segments },
      { provider },
    )
    const model = `${provider.name}:${provider.model}`

    const insertedRows = await db.transaction(async (tx) => {
      const rows: { id: string; userId: string }[] = []
      for (const userId of missingUserIds) {
        const [row] = await tx
          .insert(summaries)
          .values({
            episodeId: episode.id,
            userId,
            tldr: summary.tldr,
            insights: summary.keyInsights,
            quotes: summary.notableQuotes,
            topics: summary.topics,
            model,
          })
          // A concurrent delivery may have inserted it first; the unique index is the arbiter.
          .onConflictDoNothing({ target: [summaries.episodeId, summaries.userId] })
          .returning({ id: summaries.id, userId: summaries.userId })
        if (row) rows.push(row)
      }

      await tx
        .update(episodes)
        .set({ status: 'summarized', failureReason: null, updatedAt: new Date() })
        .where(eq(episodes.id, episode.id))

      return rows
    })

    for (const row of insertedRows) {
      await enqueueLinkInsights(episode.id, row.id)
    }

    return {
      outcome: 'summarized',
      episodeId: episode.id,
      summarizedUserIds: insertedRows.map((row) => row.userId),
    }
  } catch (error) {
    const reason = describeError(error)

    if (context.isFinalAttempt) {
      await db
        .update(episodes)
        .set({
          status: 'failed',
          failureReason: truncate(reason, MAX_FAILURE_REASON_CHARS),
          updatedAt: new Date(),
        })
        .where(eq(episodes.id, episode.id))
    }

    // Rethrow either way: pg-boss owns the retry decision, and swallowing this would
    // report a successful job for an episode with no summary.
    throw error
  }
}

/**
 * pg-boss counts retries already taken, so the final attempt is the one where none remain.
 */
function isFinalAttempt(job: { retryCount?: number | null }, retryLimit: number): boolean {
  return (job.retryCount ?? 0) >= retryLimit
}

/**
 * Registers the `summarize-episode` pg-boss worker.
 *
 * `batchSize: 1` makes this explicit rather than relying on pg-boss's own default: a
 * free-tier LLM key has one shared rate limit across the whole process, so jobs for this
 * queue must run one at a time, never concurrently.
 */
export async function registerSummarizeEpisodeWorker(boss: PgBoss): Promise<void> {
  const queue = await boss.getQueue(QUEUES.summarizeEpisode)
  const retryLimit = queue?.retryLimit ?? 0

  await boss.work(
    QUEUES.summarizeEpisode,
    { includeMetadata: true, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const result = await handleSummarizeEpisode(job.data, {
          isFinalAttempt: isFinalAttempt(job, retryLimit),
        })
        console.log(
          `[summarize-episode] job ${job.id}: ${result.outcome}` +
            (result.summarizedUserIds
              ? ` (${result.summarizedUserIds.length} user(s))`
              : ''),
        )
      }
    },
  )
}
