import { llmModelOverride, llmProviderName, llmRequestTimeoutMs, requireEnv } from '@/lib/env'
import { createAnthropicProvider } from './providers/anthropic'
import { createGroqProvider } from './providers/groq'
import { createOpenAiProvider } from './providers/openai'
import type { LLMProvider } from './types'

/**
 * Builds the active provider from environment config. This is the one place that reads
 * `LLM_PROVIDER` — everything downstream (the summarization job, retry logic, schema
 * validation) only ever sees the `LLMProvider` interface, so swapping Groq for OpenAI or
 * Anthropic never touches job code.
 */
export function createLLMProviderFromEnv(): LLMProvider {
  const name = llmProviderName()
  const model = llmModelOverride()
  const timeoutMs = llmRequestTimeoutMs()

  switch (name) {
    case 'groq':
      return createGroqProvider({ apiKey: requireEnv('GROQ_API_KEY'), model, timeoutMs })
    case 'openai':
      return createOpenAiProvider({ apiKey: requireEnv('OPENAI_API_KEY'), model, timeoutMs })
    case 'anthropic':
      return createAnthropicProvider({
        apiKey: requireEnv('ANTHROPIC_API_KEY'),
        model,
        timeoutMs,
      })
  }
}
