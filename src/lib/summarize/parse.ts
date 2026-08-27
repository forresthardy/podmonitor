import { episodeSummarySchema, type EpisodeSummary } from './schema'

/** Raised when the LLM's response is not valid JSON, or is valid JSON that fails the schema. */
export class SummaryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SummaryParseError'
  }
}

/** Strips a ```json ... ``` or ``` ... ``` fence some models add despite instructions. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return fenced?.[1] ?? trimmed
}

export function parseEpisodeSummary(raw: string): EpisodeSummary {
  const candidate = stripCodeFence(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new SummaryParseError(`LLM response was not valid JSON: ${detail}`)
  }

  const result = episodeSummarySchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new SummaryParseError(`LLM response failed schema validation: ${issues}`)
  }

  return result.data
}
