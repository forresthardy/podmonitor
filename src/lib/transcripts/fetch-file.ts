/** Fetches a publisher transcript file as text. */

export class TranscriptFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptFetchError'
  }
}

export interface FetchTranscriptOptions {
  timeoutMs: number
  /** Transcripts are text; anything huge is a wrong URL, not a transcript. */
  maxBytes: number
  signal?: AbortSignal
}

export async function fetchTranscriptFile(
  url: string,
  options: FetchTranscriptOptions,
): Promise<string> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout

  let response: Response
  try {
    response = await fetch(url, { signal, redirect: 'follow' })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new TranscriptFetchError(`transcript fetch failed for ${url}: ${detail}`)
  }

  if (!response.ok) {
    throw new TranscriptFetchError(`transcript fetch returned HTTP ${response.status} for ${url}`)
  }

  const declaredLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    throw new TranscriptFetchError(
      `transcript is ${declaredLength} bytes, over the ${options.maxBytes} byte limit`,
    )
  }

  const body = await response.text()
  // Re-check after reading: a chunked response never declares a length.
  if (Buffer.byteLength(body) > options.maxBytes) {
    throw new TranscriptFetchError(`transcript exceeded the ${options.maxBytes} byte limit`)
  }
  return body
}
