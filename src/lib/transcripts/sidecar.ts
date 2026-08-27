import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'
import type { TranscriptSegment } from './types'

/**
 * Client for the Python transcription sidecar (see `sidecar/README.md`).
 *
 * The response is validated rather than trusted: the sidecar is a separate process on a
 * separate release cycle, and a silently changed field would otherwise become a corrupt
 * transcript row.
 */

export class SidecarError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'SidecarError'
    if (status !== undefined) this.status = status
  }
}

/** Snake_case on the wire: the sidecar is idiomatic Python, this is the mapping layer. */
const sidecarResponseSchema = z.object({
  model: z.string(),
  compute_type: z.string(),
  language: z.string(),
  language_probability: z.number().nullish(),
  duration_sec: z.number(),
  segments: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      text: z.string(),
      speaker: z.string().nullish(),
    }),
  ),
})

export interface SidecarTranscription {
  model: string
  language: string
  durationSec: number
  segments: TranscriptSegment[]
}

export interface TranscribeOptions {
  baseUrl: string
  /** ASR of a long episode runs for tens of minutes; this is deliberately generous. */
  timeoutMs: number
  language?: string
  signal?: AbortSignal
}

/** Pulls the sidecar's JSON `detail` out of an error response, falling back to raw text. */
function errorDetail(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    const value = (parsed as { detail?: unknown })?.detail
    if (typeof value === 'string') return value
  } catch {
    // Not JSON; the raw body is the best detail available.
  }
  return body
}

/**
 * Posts an audio file to the sidecar and returns normalized segments.
 * The file is streamed from disk, not read into memory.
 */
export async function transcribeAudioFile(
  filePath: string,
  options: TranscribeOptions,
): Promise<SidecarTranscription> {
  const endpoint = new URL('/transcribe', options.baseUrl)
  const form = new FormData()
  // openAsBlob keeps the file lazy: undici streams it off disk as it uploads.
  form.append('file', await openAsBlob(filePath), basename(filePath))
  if (options.language) form.append('language', options.language)

  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout

  let response: Response
  try {
    response = await fetch(endpoint, { method: 'POST', body: form, signal })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new SidecarError(`transcription sidecar unreachable at ${endpoint.href}: ${detail}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new SidecarError(
      `transcription sidecar returned HTTP ${response.status}: ${errorDetail(body) || '(no detail)'}`,
      response.status,
    )
  }

  const payload: unknown = await response.json().catch(() => undefined)
  const parsed = sidecarResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new SidecarError(
      `transcription sidecar returned an unexpected payload: ${parsed.error.message}`,
    )
  }

  const segments: TranscriptSegment[] = parsed.data.segments
    .map((segment) => ({
      start: segment.start,
      end: Math.max(segment.end, segment.start),
      text: segment.text.trim(),
      ...(segment.speaker ? { speaker: segment.speaker } : {}),
    }))
    .filter((segment) => segment.text !== '')

  return {
    model: parsed.data.model,
    language: parsed.data.language,
    durationSec: parsed.data.duration_sec,
    segments,
  }
}
