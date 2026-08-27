import type { ParsedTranscript, TranscriptFormat, TranscriptSegment } from './types'

/**
 * Turns a publisher transcript file into `{ fullText, segments }`.
 *
 * Feeds in the wild are sloppy — Windows line endings, cue identifiers, `NOTE` blocks,
 * HTML entities, VTT voice spans — so these parsers are lenient by design. A file we
 * cannot make sense of yields an empty transcript, which the acquisition loop treats as
 * a failed attempt and falls through to the next source.
 */

export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptParseError'
  }
}

const CUE_ARROW = '-->'

/** `HH:MM:SS.mmm`, `MM:SS.mmm`, and the SRT comma variant all reduce to seconds. */
export function parseTimestamp(raw: string): number | undefined {
  const trimmed = raw.trim().replace(',', '.')
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(trimmed)
  if (!match) return undefined
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0
  const minutes = Number.parseInt(match[2] ?? '0', 10)
  const seconds = Number.parseFloat(match[3] ?? '0')
  if (!Number.isFinite(hours + minutes + seconds)) return undefined
  return hours * 3600 + minutes * 60 + seconds
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
}

/** Collapses whitespace so a segment is one clean line of text. */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

interface CueBody {
  text: string
  speaker?: string
}

/**
 * Extracts the cue text and any speaker. VTT marks speakers with a voice span
 * (`<v Ben Gilbert>`); Acquired's speaker-labeled files use exactly that mechanism.
 * Remaining angle-bracket tags (`<i>`, `<00:00:01.000>`) are presentation noise.
 */
function parseCueBody(lines: string[]): CueBody {
  const raw = lines.join('\n')
  const voice = /<v(?:\.[^\s>]+)*\s+([^>]+)>/i.exec(raw)
  const speaker = voice?.[1] ? normalizeText(decodeEntities(voice[1])) : undefined
  const text = normalizeText(decodeEntities(raw.replace(/<[^>]*>/g, ' ')))
  return speaker ? { text, speaker } : { text }
}

/**
 * Shared VTT/SRT cue reader: both formats are blank-line-separated blocks whose timing
 * line contains `-->`, differing only in the decimal separator and the header.
 */
function parseCueFormat(content: string): TranscriptSegment[] {
  const blocks = content
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split(/\n{2,}/)
  const segments: TranscriptSegment[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) continue
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0] ?? '')) continue

    const timingIndex = lines.findIndex((line) => line.includes(CUE_ARROW))
    if (timingIndex === -1) continue

    const [startRaw, endRaw] = (lines[timingIndex] ?? '').split(CUE_ARROW)
    const start = parseTimestamp(startRaw ?? '')
    // VTT cue settings (`align:start position:50%`) trail the end timestamp.
    const end = parseTimestamp((endRaw ?? '').trim().split(/\s+/)[0] ?? '')
    if (start === undefined || end === undefined) continue

    const body = parseCueBody(lines.slice(timingIndex + 1))
    if (body.text === '') continue

    segments.push({
      start,
      end: Math.max(end, start),
      text: body.text,
      ...(body.speaker ? { speaker: body.speaker } : {}),
    })
  }

  return segments
}

/**
 * The podcast-namespace JSON transcript format.
 *
 * @see https://github.com/Podcastindex-org/podcast-namespace/blob/main/transcripts/transcripts.md
 */
function parseJsonTranscript(content: string): TranscriptSegment[] {
  let payload: unknown
  try {
    payload = JSON.parse(content)
  } catch (error) {
    throw new TranscriptParseError(
      `transcript is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }

  const rawSegments = (payload as { segments?: unknown })?.segments
  if (!Array.isArray(rawSegments)) {
    throw new TranscriptParseError('JSON transcript has no `segments` array')
  }

  const segments: TranscriptSegment[] = []
  for (const entry of rawSegments) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const start = typeof record.startTime === 'number' ? record.startTime : undefined
    const end = typeof record.endTime === 'number' ? record.endTime : undefined
    const text = typeof record.body === 'string' ? normalizeText(record.body) : ''
    if (start === undefined || end === undefined || text === '') continue
    const speaker = typeof record.speaker === 'string' ? normalizeText(record.speaker) : ''
    segments.push({ start, end: Math.max(end, start), text, ...(speaker ? { speaker } : {}) })
  }
  return segments
}

/**
 * Plain-text and HTML transcripts. Timing is unavailable, so this returns text only and
 * no segments — an honest empty rather than one fabricated segment spanning the episode.
 */
function parseTextTranscript(content: string): string {
  const withoutTags = content
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(withoutTags)
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter((line) => line !== '')
    .join('\n')
}

/** Segment texts joined into the `full_text` column, one line per cue. */
export function segmentsToFullText(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((segment) => (segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text))
    .join('\n')
}

/** Parses transcript content according to the format the selector resolved. */
export function parseTranscript(content: string, format: TranscriptFormat): ParsedTranscript {
  if (format === 'text') {
    return { fullText: parseTextTranscript(content), segments: [] }
  }
  const segments = format === 'json' ? parseJsonTranscript(content) : parseCueFormat(content)
  return { fullText: segmentsToFullText(segments), segments }
}
