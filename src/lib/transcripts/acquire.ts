import { transcriptSource } from '@/db/schema'
import {
  maxEpisodeAudioBytes,
  maxTranscriptFileBytes,
  transcriptFetchTimeoutMs,
  whisperSidecarTimeoutMs,
  whisperSidecarUrl,
} from '@/lib/env'
import { withDownloadedAudio } from './audio'
import { fetchTranscriptFile } from './fetch-file'
import { parseTranscript, segmentsToFullText } from './parse'
import { planTranscriptAcquisition, type PlanInput, type TranscriptAttempt } from './selector'
import { transcribeAudioFile } from './sidecar'
import type { TranscriptSegment } from './types'

/**
 * Runs the acquisition plan: try each source in order, stop at the first that yields a
 * real transcript. This is where the transcript-first decision becomes behavior — ASR
 * runs only after every publisher transcript has actually failed, not merely been
 * listed.
 */

type EnumSource = (typeof transcriptSource.enumValues)[number]

/** `episode_page` is a valid column value but no acquisition path produces it yet. */
export type AcquiredTranscriptSource = Extract<EnumSource, 'feed_tag' | 'asr'>

/**
 * A publisher transcript shorter than this is a placeholder page or an error body, not an
 * episode. Real episodes run an hour or more; the shortest plausible transcript is far
 * longer than this.
 */
export const MIN_FEED_TRANSCRIPT_CHARS = 200

export interface AttemptOutcome {
  source: AcquiredTranscriptSource
  url: string
  ok: boolean
  detail: string
}

export interface AcquiredTranscript {
  source: AcquiredTranscriptSource
  fullText: string
  segments: TranscriptSegment[]
  /** Every attempt, in order, including the ones that failed. */
  attempts: AttemptOutcome[]
}

export class TranscriptAcquisitionError extends Error {
  readonly attempts: AttemptOutcome[]

  constructor(message: string, attempts: AttemptOutcome[]) {
    super(message)
    this.name = 'TranscriptAcquisitionError'
    this.attempts = attempts
  }
}

export interface AsrResult {
  segments: TranscriptSegment[]
  model: string
}

/**
 * The two side effects acquisition performs, injected so tests can run the real
 * decision logic against a mocked sidecar and network.
 */
export interface AcquisitionDeps {
  fetchTranscriptFile: (url: string) => Promise<string>
  transcribeFromUrl: (audioUrl: string) => Promise<AsrResult>
}

/** Wires the real network implementations using process configuration. */
export function createAcquisitionDeps(): AcquisitionDeps {
  return {
    fetchTranscriptFile: (url) =>
      fetchTranscriptFile(url, {
        timeoutMs: transcriptFetchTimeoutMs(),
        maxBytes: maxTranscriptFileBytes(),
      }),
    transcribeFromUrl: (audioUrl) =>
      withDownloadedAudio(
        audioUrl,
        { maxBytes: maxEpisodeAudioBytes(), timeoutMs: whisperSidecarTimeoutMs() },
        async (audio) => {
          const result = await transcribeAudioFile(audio.path, {
            baseUrl: whisperSidecarUrl(),
            timeoutMs: whisperSidecarTimeoutMs(),
          })
          return { segments: result.segments, model: result.model }
        },
      ),
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Attempts one publisher transcript. Returns undefined when it is unusable. */
async function tryFeedTag(
  attempt: Extract<TranscriptAttempt, { source: 'feed_tag' }>,
  deps: AcquisitionDeps,
  outcomes: AttemptOutcome[],
): Promise<AcquiredTranscript | undefined> {
  const url = attempt.candidate.url
  try {
    const content = await deps.fetchTranscriptFile(url)
    const parsed = parseTranscript(content, attempt.format)
    const fullText = parsed.fullText.trim()

    if (fullText.length < MIN_FEED_TRANSCRIPT_CHARS) {
      outcomes.push({
        source: 'feed_tag',
        url,
        ok: false,
        detail: `parsed transcript is only ${fullText.length} characters (minimum ${MIN_FEED_TRANSCRIPT_CHARS}); treating as unusable`,
      })
      return undefined
    }

    outcomes.push({
      source: 'feed_tag',
      url,
      ok: true,
      detail: `parsed ${parsed.segments.length} segments from ${attempt.format}`,
    })
    return { source: 'feed_tag', fullText, segments: parsed.segments, attempts: outcomes }
  } catch (error) {
    outcomes.push({ source: 'feed_tag', url, ok: false, detail: describeError(error) })
    return undefined
  }
}

/** Attempts ASR. Returns undefined when the sidecar fails or produces nothing. */
async function tryAsr(
  attempt: Extract<TranscriptAttempt, { source: 'asr' }>,
  deps: AcquisitionDeps,
  outcomes: AttemptOutcome[],
): Promise<AcquiredTranscript | undefined> {
  const url = attempt.audioUrl
  try {
    const result = await deps.transcribeFromUrl(url)
    const fullText = segmentsToFullText(result.segments).trim()

    if (result.segments.length === 0 || fullText === '') {
      outcomes.push({
        source: 'asr',
        url,
        ok: false,
        detail: 'sidecar returned no speech segments',
      })
      return undefined
    }

    outcomes.push({
      source: 'asr',
      url,
      ok: true,
      detail: `transcribed ${result.segments.length} segments with model ${result.model}`,
    })
    return { source: 'asr', fullText, segments: result.segments, attempts: outcomes }
  } catch (error) {
    outcomes.push({ source: 'asr', url, ok: false, detail: describeError(error) })
    return undefined
  }
}

/**
 * Acquires a transcript for one episode.
 *
 * @throws {TranscriptAcquisitionError} when every source in the plan failed. The error
 * carries each attempt so the failure reason reaching the UI names what was tried.
 */
export async function acquireTranscript(
  input: PlanInput,
  deps: AcquisitionDeps,
): Promise<AcquiredTranscript> {
  const plan = planTranscriptAcquisition(input)
  const outcomes: AttemptOutcome[] = []

  if (plan.attempts.length === 0) {
    throw new TranscriptAcquisitionError(
      'no transcript source available: the episode has neither a usable transcript tag nor audio',
      outcomes,
    )
  }

  for (const attempt of plan.attempts) {
    const acquired =
      attempt.source === 'feed_tag'
        ? await tryFeedTag(attempt, deps, outcomes)
        : await tryAsr(attempt, deps, outcomes)
    if (acquired) return acquired
  }

  const summary = outcomes.map((outcome) => `${outcome.source}: ${outcome.detail}`).join('; ')
  throw new TranscriptAcquisitionError(
    `all ${outcomes.length} transcript source(s) failed — ${summary}`,
    outcomes,
  )
}
