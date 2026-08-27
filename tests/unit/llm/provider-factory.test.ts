import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLLMProviderFromEnv } from '@/lib/llm/provider'

/**
 * `LLM_PROVIDER` is the one switch the spec requires: swapping Groq for OpenAI or
 * Anthropic must be a config change, never a code change. This proves the factory reads
 * that switch and nothing else determines which adapter comes back.
 */

const ENV_KEYS = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_REQUEST_TIMEOUT_MS',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const

const originalEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

describe('createLLMProviderFromEnv', () => {
  it('defaults to groq when LLM_PROVIDER is unset', () => {
    delete process.env.LLM_PROVIDER
    process.env.GROQ_API_KEY = 'sk-groq'

    const provider = createLLMProviderFromEnv()

    expect(provider.name).toBe('groq')
  })

  it('selects openai when configured, with no code change required', () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'sk-openai'

    expect(createLLMProviderFromEnv().name).toBe('openai')
  })

  it('selects anthropic when configured', () => {
    process.env.LLM_PROVIDER = 'anthropic'
    process.env.ANTHROPIC_API_KEY = 'sk-ant'

    expect(createLLMProviderFromEnv().name).toBe('anthropic')
  })

  it('applies LLM_MODEL as an override regardless of provider', () => {
    process.env.LLM_PROVIDER = 'groq'
    process.env.GROQ_API_KEY = 'sk-groq'
    process.env.LLM_MODEL = 'llama-3.1-8b-instant'

    expect(createLLMProviderFromEnv().model).toBe('llama-3.1-8b-instant')
  })

  it('throws a clear error when the selected provider is missing its API key', () => {
    process.env.LLM_PROVIDER = 'openai'
    delete process.env.OPENAI_API_KEY

    expect(() => createLLMProviderFromEnv()).toThrow(/OPENAI_API_KEY/)
  })

  it('rejects an unsupported provider name', () => {
    process.env.LLM_PROVIDER = 'not-a-real-provider'

    expect(() => createLLMProviderFromEnv()).toThrow(/Unsupported LLM_PROVIDER/)
  })
})
