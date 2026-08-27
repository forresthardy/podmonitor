import { z } from 'zod'
import type { LLMMessage, LLMProvider } from '@/lib/llm/types'

/**
 * Relation classification: similarity says two insights are *about the same thing*; only
 * reading them says whether the new one extends, contradicts, or merely echoes the old
 * one. That judgment is the LLM's job — embeddings cannot make it, because "X works" and
 * "X does not work" sit close together in every vector space.
 */

export const INSIGHT_RELATIONS = ['extends', 'contradicts', 'echoes'] as const

export type InsightRelation = (typeof INSIGHT_RELATIONS)[number]

/**
 * The neutral relation. Used when the model's answer is unusable: the similarity link is
 * still real and worth surfacing, and "echoes" is the claim that makes the weakest
 * assertion about the pair.
 */
export const DEFAULT_RELATION: InsightRelation = 'echoes'

/** Candidates are addressed by 1-based position, never by UUID: a model cannot hallucinate an index. */
export const relationResponseSchema = z.object({
  links: z.array(
    z.object({
      candidate: z.number().int().positive(),
      relation: z.enum(INSIGHT_RELATIONS),
    }),
  ),
})

export interface RelationCandidate {
  text: string
  context?: string | null
  episodeTitle: string
}

export interface RelationClassificationInput {
  insightText: string
  insightContext?: string | null
  candidates: readonly RelationCandidate[]
}

/** Raised when the model's classification cannot be read. Callers degrade, never guess. */
export class RelationParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelationParseError'
  }
}

const SYSTEM_PROMPT = `You classify how a new podcast insight relates to insights a reader \
captured earlier. Answer with a single JSON object and nothing else — no markdown fences, \
no commentary.

The object has one field, "links": an array of { "candidate": number, "relation": string }.
- "candidate" is the 1-based number of the earlier insight as listed in the prompt.
- "relation" is exactly one of:
  - "extends": the new insight adds to, sharpens, or builds on the earlier one.
  - "contradicts": the new insight disagrees with or undercuts the earlier one.
  - "echoes": the new insight restates or reinforces the same point without adding to it.

Include every candidate exactly once. Choose "echoes" when unsure.`

function formatCandidate(candidate: RelationCandidate, index: number): string {
  const context = candidate.context ? `\n   context: ${candidate.context}` : ''
  return `${index + 1}. (from "${candidate.episodeTitle}") ${candidate.text}${context}`
}

export function buildRelationPrompt(input: RelationClassificationInput): LLMMessage[] {
  const context = input.insightContext ? `\ncontext: ${input.insightContext}` : ''

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `NEW INSIGHT:\n${input.insightText}${context}\n\n` +
        `EARLIER INSIGHTS:\n${input.candidates.map(formatCandidate).join('\n')}`,
    },
  ]
}

/** Strips a ```json ... ``` fence some models add despite instructions. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  return trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)?.[1] ?? trimmed
}

/**
 * Reads the model's answer into one relation per candidate, in candidate order.
 * Candidates the model skipped or numbered out of range fall back to {@link DEFAULT_RELATION}.
 *
 * @throws RelationParseError when the response is not JSON in the expected shape at all.
 */
export function parseRelationResponse(raw: string, candidateCount: number): InsightRelation[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFence(raw))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new RelationParseError(`relation response was not valid JSON: ${detail}`)
  }

  const result = relationResponseSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new RelationParseError(`relation response failed schema validation: ${issues}`)
  }

  const relations = new Array<InsightRelation>(candidateCount).fill(DEFAULT_RELATION)
  for (const link of result.data.links) {
    const index = link.candidate - 1
    if (index >= 0 && index < candidateCount) relations[index] = link.relation
  }
  return relations
}

/**
 * Classifies every candidate for one insight in a single call.
 *
 * A malformed answer degrades to {@link DEFAULT_RELATION} with a warning — the link itself
 * is still evidence the reader wants. A transport failure is *not* caught here: that is
 * retryable, and pg-boss owns retries.
 */
export async function classifyRelations(
  provider: LLMProvider,
  input: RelationClassificationInput,
): Promise<InsightRelation[]> {
  if (input.candidates.length === 0) return []

  const raw = await provider.complete({
    messages: buildRelationPrompt(input),
    temperature: 0,
  })

  try {
    return parseRelationResponse(raw, input.candidates.length)
  } catch (error) {
    console.warn(
      `[link-insights] relation classification unusable, defaulting to "${DEFAULT_RELATION}"`,
      error,
    )
    return new Array<InsightRelation>(input.candidates.length).fill(DEFAULT_RELATION)
  }
}
