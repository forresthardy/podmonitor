import { eq } from 'drizzle-orm'
import type PgBoss from 'pg-boss'
import { z } from 'zod'
import { getDb, type Database } from '@/db/client'
import { episodes, transcripts } from '@/db/schema'
import {
  acquireTranscript,
  createAcquisitionDeps,
  TranscriptAcquisitionError,
  type AcquisitionDeps,
} from '@/lib/transcripts/acquire'
import { QUEUES } from '../queues'

/**
 * The transcript-acquisition stage.
 *
 * Owns the episode's state transitions: `discovered` → `transcribing`, then `failed` once
 * pg-boss has exhausted its retries. A transcript that is stored leaves the episode in
 * `transcribing` — the enum has no `transcribed` state, and the next stage moves it to
 * `summarized`, so `transcribing` correctly means "past discovery, not yet summarized".
 */

/**
 * Transcript candidates travel in the payload rather than being re-read here: the feed
 * parser already has them at ingest time, and re-fetching the feed to recover a
 * `podcast:transcript` URL would make this stage depend on the publisher still serving
 * the same feed page.
 */
export const acquireTranscriptPayloadSchema = z.object({
  episodeId: z.string().uuid(),
  feedTranscripts: z
    .array(
      z.object({
        url: z.string(),
        /**
         * The namespace requires `type`, but feeds omit it. Defaulting to empty rather
         * than optional keeps the candidate usable: the selector falls back to the URL
         * extension when the declared type is missing or useless.
         */
        mimeType: z.string().default(''),
        language: z.string().optional(),
        rel: z.string().optional(),
      }),
    )
    .optional(),
  preferredLanguage: z.string().optional(),
})

export type AcquireTranscriptPayload = z.infer<typeof acquireTranscriptPayloadSchema>

export type AcquireTranscriptOutcome = 'acquired' | 'already_present' | 'episode_missing'

export interface AcquireTranscriptResult {
  outcome: AcquireTranscriptOutcome
  episodeId: string
  source?: string
  segmentCount?: number
}

export interface AcquireTranscriptContext {
  /** True on the last pg-boss attempt: only then is the episode marked failed. */
  isFinalAttempt: boolean
  db?: Database
  deps?: AcquisitionDeps
  /** Injected so the integration test does not need a running pg-boss. */
  enqueueSummarize?: (episodeId: string) => Promise<void>
}

/** Postgres text columns are unbounded, but an unbounded reason in the UI is not useful. */
const MAX_FAILURE_REASON_CHARS = 2000

async function defaultEnqueueSummarize(episodeId: string): Promise<void> {
  // Imported lazily so importing this module does not construct a pg-boss connection —
  // the integration test imports the handler without a queue running.
  const { getBoss } = await import('../boss')
  const boss = await getBoss()
  await boss.send(QUEUES.summarizeEpisode, { episodeId })
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

/**
 * Acquires and stores one episode's transcript.
 *
 * @throws when acquisition fails, so pg-boss retries. On the final attempt the episode is
 * marked `failed` with the reason before rethrowing, which is what makes the failure
 * visible in the UI rather than only in the job table.
 */
export async function handleAcquireTranscript(
  rawPayload: unknown,
  context: AcquireTranscriptContext,
): Promise<AcquireTranscriptResult> {
  const payload = acquireTranscriptPayloadSchema.parse(rawPayload)
  const db = context.db ?? getDb()
  const deps = context.deps ?? createAcquisitionDeps()
  const enqueueSummarize = context.enqueueSummarize ?? defaultEnqueueSummarize

  const [episode] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, payload.episodeId))
    .limit(1)

  if (!episode) {
    // A deleted episode is not a retryable fault: returning lets the job succeed empty.
    return { outcome: 'episode_missing', episodeId: payload.episodeId }
  }

  const [existing] = await db
    .select({ id: transcripts.id })
    .from(transcripts)
    .where(eq(transcripts.episodeId, episode.id))
    .limit(1)

  if (existing) {
    // Re-delivery after the transcript landed: hand off again rather than re-transcribing,
    // which is the expensive half of the pipeline.
    await enqueueSummarize(episode.id)
    return { outcome: 'already_present', episodeId: episode.id }
  }

  await db
    .update(episodes)
    .set({ status: 'transcribing', failureReason: null, updatedAt: new Date() })
    .where(eq(episodes.id, episode.id))

  try {
    const acquired = await acquireTranscript(
      {
        audioUrl: episode.audioUrl,
        feedTranscripts: payload.feedTranscripts ?? [],
        ...(payload.preferredLanguage ? { preferredLanguage: payload.preferredLanguage } : {}),
      },
      deps,
    )

    // One transaction: a transcript row without its episode's source recorded would make
    // the provenance question unanswerable, which is exactly what this PR exists to fix.
    await db.transaction(async (tx) => {
      await tx
        .insert(transcripts)
        .values({
          episodeId: episode.id,
          fullText: acquired.fullText,
          segments: acquired.segments,
        })
        // A concurrent delivery may have inserted it; the unique index is the arbiter.
        .onConflictDoNothing({ target: transcripts.episodeId })

      await tx
        .update(episodes)
        .set({
          transcriptSource: acquired.source,
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(eq(episodes.id, episode.id))
    })

    await enqueueSummarize(episode.id)

    return {
      outcome: 'acquired',
      episodeId: episode.id,
      source: acquired.source,
      segmentCount: acquired.segments.length,
    }
  } catch (error) {
    const reason =
      error instanceof TranscriptAcquisitionError
        ? error.message
        : `unexpected transcript failure: ${error instanceof Error ? error.message : String(error)}`

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
    // report a successful job for an episode with no transcript.
    throw error
  }
}

/**
 * pg-boss counts retries already taken, so the final attempt is the one where none remain.
 * Getting this wrong in either direction is costly: too early marks an episode failed
 * while retries are still coming, too late never marks it failed at all.
 */
function isFinalAttempt(job: { retryCount?: number | null }, retryLimit: number): boolean {
  return (job.retryCount ?? 0) >= retryLimit
}

/**
 * Registers the `acquire-transcript` pg-boss worker.
 *
 * The retry limit is read from the queue rather than duplicated here, so the policy in
 * `QUEUE_OPTIONS` stays the single source of truth for when an episode is out of retries.
 */
export async function registerAcquireTranscriptWorker(boss: PgBoss): Promise<void> {
  const queue = await boss.getQueue(QUEUES.acquireTranscript)
  const retryLimit = queue?.retryLimit ?? 0

  await boss.work(QUEUES.acquireTranscript, { includeMetadata: true }, async (jobs) => {
    for (const job of jobs) {
      const result = await handleAcquireTranscript(job.data, {
        isFinalAttempt: isFinalAttempt(job, retryLimit),
      })
      console.log(
        `[acquire-transcript] job ${job.id}: ${result.outcome}` +
          (result.source ? ` via ${result.source} (${result.segmentCount} segments)` : ''),
      )
    }
  })
}
