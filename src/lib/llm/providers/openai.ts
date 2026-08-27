import { createOpenAiCompatibleProvider } from '../openai-compatible'
import type { LLMProvider } from '../types'

export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

/** Cheap, capable, and enough context for a long episode transcript. */
export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini'

export interface OpenAiProviderOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  timeoutMs?: number
}

export function createOpenAiProvider(options: OpenAiProviderOptions): LLMProvider {
  return createOpenAiCompatibleProvider({
    name: 'openai',
    apiKey: options.apiKey,
    model: options.model ?? OPENAI_DEFAULT_MODEL,
    baseUrl: options.baseUrl ?? OPENAI_BASE_URL,
    timeoutMs: options.timeoutMs ?? 60_000,
  })
}
