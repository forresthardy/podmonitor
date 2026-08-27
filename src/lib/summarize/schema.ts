import { z } from 'zod'

/**
 * The `EpisodeSummary` contract from the spec, enforced with zod rather than trusted as
 * TypeScript types: this is the boundary where an LLM's free-form output either becomes
 * safe to store or gets rejected, and only runtime validation can do that job.
 */

/** Splits on sentence-ending punctuation followed by whitespace or end-of-string. */
function countSentences(text: string): number {
  return text
    .split(/[.!?]+(?:\s+|$)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0).length
}

export const summaryInsightSchema = z.object({
  text: z.string().min(1, 'insight text must not be empty'),
  context: z.string().min(1, 'insight context must not be empty'),
  // Nullable rather than optional: the model must say "no single moment" explicitly
  // rather than the field silently going missing.
  timestampSec: z.number().nonnegative().nullable(),
})

export const summaryQuoteSchema = z.object({
  quote: z.string().min(1, 'quote text must not be empty'),
  speaker: z.string().min(1, 'quote speaker must not be empty'),
  timestampSec: z.number().nonnegative(),
})

export const episodeSummarySchema = z.object({
  tldr: z
    .string()
    .min(1, 'tldr must not be empty')
    .refine((value) => {
      const count = countSentences(value)
      return count >= 3 && count <= 5
    }, 'tldr must be 3-5 sentences'),
  keyInsights: z.array(summaryInsightSchema).min(1, 'keyInsights must have at least one entry'),
  // Not every episode yields a strong quote; an empty array is a valid outcome.
  notableQuotes: z.array(summaryQuoteSchema),
  topics: z.array(z.string().min(1)).min(1, 'topics must have at least one entry'),
})

export type EpisodeSummary = z.infer<typeof episodeSummarySchema>
export type SummaryInsight = z.infer<typeof summaryInsightSchema>
export type SummaryQuote = z.infer<typeof summaryQuoteSchema>
