import { createOpenAiCompatibleProvider } from '../openai-compatible'
import type { LLMProvider } from '../types'

/** Groq's OpenAI-compatible endpoint. */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

/**
 * A fast, generous-limit model on Groq's free tier. Overridable via `LLM_MODEL` — this is
 * a config default, not a hard dependency.
 */
export const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile'

export interface GroqProviderOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  timeoutMs?: number
}

export function createGroqProvider(options: GroqProviderOptions): LLMProvider {
  return createOpenAiCompatibleProvider({
    name: 'groq',
    apiKey: options.apiKey,
    model: options.model ?? GROQ_DEFAULT_MODEL,
    baseUrl: options.baseUrl ?? GROQ_BASE_URL,
    timeoutMs: options.timeoutMs ?? 60_000,
  })
}
