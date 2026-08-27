import type { TranscriptSegment } from '@/db/schema'
import type { LLMMessage } from '@/lib/llm/types'

/**
 * A transcript can run to tens of thousands of words; most providers (especially Groq's
 * free tier) have a real context ceiling. Truncating to a generous character budget is a
 * deliberate simplification for v1 — a future PR can add map-reduce summarization for
 * multi-hour episodes instead of silently cutting off the back half of the conversation.
 */
const MAX_TRANSCRIPT_CHARS = 60_000

export interface SummarizationPromptInput {
  episodeTitle: string
  podcastTitle?: string
  transcriptSegments: readonly TranscriptSegment[]
}

/** One line per segment, timestamped, so the model can ground quotes to a real moment. */
function formatSegments(segments: readonly TranscriptSegment[]): string {
  const lines: string[] = []
  let usedChars = 0

  for (const segment of segments) {
    const speaker = segment.speaker ? `${segment.speaker}: ` : ''
    const line = `[${segment.start.toFixed(1)}s] ${speaker}${segment.text}`
    if (usedChars + line.length > MAX_TRANSCRIPT_CHARS) break
    lines.push(line)
    usedChars += line.length + 1
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are a podcast summarization assistant. Given an episode transcript, \
produce a structured summary as a single JSON object and nothing else — no markdown \
fences, no commentary before or after.

The JSON object must have exactly these fields:
- "tldr": a 3-5 sentence plain-English summary of the episode.
- "keyInsights": an array of { "text": string, "context": string, "timestampSec": number \
or null }. Each insight is one distinct takeaway; "context" explains why it matters; \
"timestampSec" is the moment it was discussed, or null if it isn't tied to one moment.
- "notableQuotes": an array of { "quote": string, "speaker": string, "timestampSec": \
number }. Only include a quote if you can give the exact "timestampSec" of a transcript \
line it appears in — every quote must be traceable back to a real transcript timestamp. \
Omit this field's entries entirely rather than guessing a timestamp.
- "topics": an array of short topic strings covering what the episode discussed.

Every "timestampSec" value must be a number taken from one of the "[N.Ns]" markers in the \
transcript below, not an estimate.`

export function buildSummarizationPrompt(input: SummarizationPromptInput): LLMMessage[] {
  const transcriptText = formatSegments(input.transcriptSegments)
  const heading = input.podcastTitle
    ? `${input.podcastTitle} — ${input.episodeTitle}`
    : input.episodeTitle

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Episode: ${heading}\n\nTranscript:\n${transcriptText}`,
    },
  ]
}
