import type { FeedTranscriptCandidate, TranscriptFormat } from './types'

/**
 * Transcript source selection, as a pure function.
 *
 * The locked product decision: publisher transcripts win, ASR is the fallback and is
 * never chosen while a usable feed transcript exists. Of the four seed shows only
 * Acquired ships in-feed `podcast:transcript` links, so in practice this selector
 * produces a feed-tag attempt for Acquired and an ASR-only plan for the rest.
 *
 * `episode_page` scraping is a known third source (Lenny's) that the spec explicitly
 * defers, so it is absent here rather than stubbed.
 */

/** Attempt a publisher-provided transcript file. */
export interface FeedTagAttempt {
  source: 'feed_tag'
  candidate: FeedTranscriptCandidate
  format: TranscriptFormat
}

/** Transcribe the episode audio with the whisper sidecar. */
export interface AsrAttempt {
  source: 'asr'
  audioUrl: string
}

export type TranscriptAttempt = FeedTagAttempt | AsrAttempt

/** A candidate we refused, kept so the reason reaches logs instead of vanishing. */
export interface RejectedCandidate {
  candidate: FeedTranscriptCandidate
  reason: string
}

export interface TranscriptPlan {
  /** Ordered attempts. Empty only when there is neither a usable transcript nor audio. */
  attempts: TranscriptAttempt[]
  rejected: RejectedCandidate[]
}

export interface PlanInput {
  audioUrl?: string | null
  feedTranscripts?: readonly FeedTranscriptCandidate[]
  /** BCP-47 tag; candidates in this language sort ahead of the rest. Defaults to `en`. */
  preferredLanguage?: string
}

export const DEFAULT_PREFERRED_LANGUAGE = 'en'

/**
 * Format preference, best first. JSON carries speaker labels and timings; VTT and SRT
 * carry timings only; plain text carries neither but is still a real publisher
 * transcript, so it outranks ASR.
 */
const FORMAT_RANK: Record<TranscriptFormat, number> = { json: 0, vtt: 1, srt: 2, text: 3 }

const MIME_FORMATS: Record<string, TranscriptFormat> = {
  'application/json': 'json',
  'application/x-json': 'json',
  'text/json': 'json',
  'text/vtt': 'vtt',
  'text/webvtt': 'vtt',
  'application/x-subrip': 'srt',
  'application/x-srt': 'srt',
  'text/srt': 'srt',
  'text/plain': 'text',
  'text/html': 'text',
}

const EXTENSION_FORMATS: Record<string, TranscriptFormat> = {
  json: 'json',
  vtt: 'vtt',
  srt: 'srt',
  txt: 'text',
}

/** Strips parameters and casing: `Text/VTT; charset=utf-8` -> `text/vtt`. */
function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
}

/** Language comparison is on the primary subtag, so `en-US` matches a preference of `en`. */
function primaryLanguageSubtag(language: string | undefined): string | undefined {
  const tag = language?.trim().toLowerCase()
  if (!tag) return undefined
  return tag.split(/[-_]/)[0]
}

function fileExtension(url: string): string | undefined {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }
  const match = /\.([a-z0-9]+)$/i.exec(pathname)
  return match?.[1]?.toLowerCase()
}

function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Resolves the serialization of a candidate. The declared MIME type wins; when a feed
 * declares something useless (`application/octet-stream` is common) the URL extension
 * is the fallback.
 */
export function resolveTranscriptFormat(
  candidate: FeedTranscriptCandidate,
): TranscriptFormat | undefined {
  const declared = MIME_FORMATS[normalizeMimeType(candidate.mimeType)]
  if (declared) return declared
  const extension = fileExtension(candidate.url)
  return extension ? EXTENSION_FORMATS[extension] : undefined
}

interface ScoredCandidate {
  attempt: FeedTagAttempt
  formatRank: number
  languageRank: number
  /** Feed order, so equal candidates keep the publisher's ordering. */
  index: number
}

/**
 * Builds the ordered acquisition plan for one episode.
 *
 * Ordering: usable feed transcripts (preferred language first, then best format), then
 * ASR when audio exists. Every discarded candidate is reported in `rejected` with a
 * reason rather than silently dropped.
 */
export function planTranscriptAcquisition(input: PlanInput): TranscriptPlan {
  const preferred = primaryLanguageSubtag(input.preferredLanguage) ?? DEFAULT_PREFERRED_LANGUAGE
  const rejected: RejectedCandidate[] = []
  const scored: ScoredCandidate[] = []
  const seenUrls = new Set<string>()

  input.feedTranscripts?.forEach((candidate, index) => {
    if (!isHttpUrl(candidate.url)) {
      rejected.push({ candidate, reason: 'url is not an http(s) URL' })
      return
    }
    if (seenUrls.has(candidate.url)) {
      rejected.push({ candidate, reason: 'duplicate url' })
      return
    }
    const format = resolveTranscriptFormat(candidate)
    if (!format) {
      rejected.push({
        candidate,
        reason: `unsupported transcript type: ${candidate.mimeType || '(none)'}`,
      })
      return
    }

    seenUrls.add(candidate.url)
    const language = primaryLanguageSubtag(candidate.language)
    scored.push({
      attempt: { source: 'feed_tag', candidate, format },
      formatRank: FORMAT_RANK[format],
      // Unlabeled languages sit between a match and a mismatch: most feeds that omit
      // the attribute are publishing in the show's own language.
      languageRank: language === preferred ? 0 : language === undefined ? 1 : 2,
      index,
    })
  })

  scored.sort(
    (a, b) =>
      a.languageRank - b.languageRank || a.formatRank - b.formatRank || a.index - b.index,
  )

  const attempts: TranscriptAttempt[] = scored.map((entry) => entry.attempt)
  if (input.audioUrl && isHttpUrl(input.audioUrl)) {
    attempts.push({ source: 'asr', audioUrl: input.audioUrl })
  }

  return { attempts, rejected }
}
