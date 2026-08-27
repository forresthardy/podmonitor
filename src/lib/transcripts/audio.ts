import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * Episode audio download.
 *
 * Audio is streamed to disk and deleted afterwards, never buffered: a 2-hour episode is
 * ~120 MB, and several concurrent jobs holding that in memory would take the worker down.
 */

export class AudioDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioDownloadError'
  }
}

export interface DownloadedAudio {
  /** Absolute path to the audio file inside a private temp directory. */
  path: string
  bytes: number
  contentType?: string
}

interface DownloadedAudioHandle extends DownloadedAudio {
  /** Temp directory holding the file; the caller is responsible for removing it. */
  directory: string
}

export interface DownloadAudioOptions {
  maxBytes: number
  /** Abort if the whole download has not finished within this window. */
  timeoutMs: number
  signal?: AbortSignal
}

/** Keeps a recognizable extension so the sidecar's demuxer can guess the container. */
function fileNameFor(url: string): string {
  try {
    const name = basename(new URL(url).pathname)
    if (/^[\w.-]{1,80}$/.test(name) && name.includes('.')) return name
  } catch {
    // Fall through to the default below.
  }
  return 'episode-audio'
}

function assertHttpUrl(url: string): void {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    throw new AudioDownloadError(`audio URL is not a valid URL: ${url}`)
  }
  // Only http(s): a feed must not be able to make the worker read local files.
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new AudioDownloadError(`audio URL must be http(s), received: ${protocol}`)
  }
}

/**
 * Reads the response body, enforcing the size cap as bytes arrive. Reading through the
 * reader rather than bridging to a Node stream keeps this fully typed, and the cap is
 * what protects a chunked response that never declared a content-length.
 */
async function* readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  counter: { bytes: number },
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (!value) continue
      counter.bytes += value.byteLength
      if (counter.bytes > maxBytes) {
        throw new AudioDownloadError(`audio exceeded the ${maxBytes} byte limit mid-download`)
      }
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Downloads audio into a fresh temp directory.
 *
 * The caller owns the directory and must remove it — prefer `withDownloadedAudio`, which
 * does that on every path.
 */
export async function downloadAudio(
  url: string,
  options: DownloadAudioOptions,
): Promise<DownloadedAudioHandle> {
  assertHttpUrl(url)

  const directory = await mkdtemp(join(tmpdir(), 'podmonitor-audio-'))
  const path = join(directory, fileNameFor(url))
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout

  try {
    const response = await fetch(url, { signal, redirect: 'follow' })
    if (!response.ok) {
      throw new AudioDownloadError(`audio fetch returned HTTP ${response.status} for ${url}`)
    }
    if (!response.body) {
      throw new AudioDownloadError(`audio fetch returned an empty body for ${url}`)
    }

    // Reject an oversized file before spending the bandwidth, when the server says so.
    const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      throw new AudioDownloadError(
        `audio is ${declaredLength} bytes, over the ${options.maxBytes} byte limit`,
      )
    }

    const counter = { bytes: 0 }
    await pipeline(readCapped(response.body, options.maxBytes, counter), createWriteStream(path))

    if (counter.bytes === 0) {
      throw new AudioDownloadError(`audio download produced 0 bytes for ${url}`)
    }

    const contentType = response.headers.get('content-type') ?? undefined
    return {
      path,
      bytes: counter.bytes,
      directory,
      ...(contentType ? { contentType } : {}),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    if (error instanceof AudioDownloadError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new AudioDownloadError(`audio download failed for ${url}: ${detail}`)
  }
}

/**
 * Downloads audio, runs `consume`, and removes the file whether or not `consume` threw.
 * The only download entry point worth using from a job handler.
 */
export async function withDownloadedAudio<T>(
  url: string,
  options: DownloadAudioOptions,
  consume: (audio: DownloadedAudio) => Promise<T>,
): Promise<T> {
  const audio = await downloadAudio(url, options)
  try {
    return await consume(audio)
  } finally {
    await rm(audio.directory, { recursive: true, force: true })
  }
}
