import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LLMProviderError, LLMRateLimitError } from '@/lib/llm/errors'
import { createOpenAiCompatibleProvider } from '@/lib/llm/openai-compatible'
import { createGroqProvider, GROQ_DEFAULT_MODEL } from '@/lib/llm/providers/groq'
import { createOpenAiProvider, OPENAI_DEFAULT_MODEL } from '@/lib/llm/providers/openai'

/**
 * The contract every OpenAI-compatible adapter must satisfy, exercised against a real
 * local HTTP server rather than a mocked `fetch` — this is what "mocked HTTP" means for
 * this suite: a fake backend standing in for Groq/OpenAI, controlling status codes and
 * capturing what was actually sent.
 *
 * Groq and OpenAI share `createOpenAiCompatibleProvider`, so the contract is proven once
 * here; `groq.ts`/`openai.ts` only need thin wiring tests for their own defaults.
 */

let server: Server
let baseUrl: string
let handler: (req: { path: string; body: unknown; headers: Record<string, string | string[] | undefined> }) => {
  status: number
  body: unknown
  headers?: Record<string, string>
}

beforeEach(async () => {
  handler = () => ({
    status: 200,
    body: { choices: [{ message: { content: '{"ok":true}' } }] },
  })
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      const result = handler({
        path: request.url ?? '/',
        body: rawBody ? JSON.parse(rawBody) : undefined,
        headers: request.headers,
      })
      response.writeHead(result.status, {
        'content-type': 'application/json',
        ...result.headers,
      })
      response.end(JSON.stringify(result.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}/openai/v1`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

function provider() {
  return createOpenAiCompatibleProvider({
    name: 'test-provider',
    apiKey: 'sk-test-key',
    model: 'test-model',
    baseUrl,
    timeoutMs: 5000,
  })
}

describe('createOpenAiCompatibleProvider', () => {
  it('posts to the base URL\'s own /chat/completions path, not the bare origin', async () => {
    let seenPath = ''
    handler = (req) => {
      seenPath = req.path
      return { status: 200, body: { choices: [{ message: { content: 'hi' } }] } }
    }

    await provider().complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(seenPath).toBe('/openai/v1/chat/completions')
  })

  it('sends the model, messages, and bearer auth header', async () => {
    let seenBody: unknown
    let seenAuth: string | string[] | undefined
    handler = (req) => {
      seenBody = req.body
      seenAuth = req.headers.authorization
      return { status: 200, body: { choices: [{ message: { content: 'hi' } }] } }
    }

    await provider().complete({
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'summarize this' },
      ],
      temperature: 0.1,
      maxTokens: 500,
    })

    expect(seenAuth).toBe('Bearer sk-test-key')
    expect(seenBody).toMatchObject({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'summarize this' },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    })
  })

  it('returns the message content on success', async () => {
    handler = () => ({
      status: 200,
      body: { choices: [{ message: { content: '{"tldr":"..."}' } }] },
    })

    const result = await provider().complete({ messages: [{ role: 'user', content: 'x' }] })

    expect(result).toBe('{"tldr":"..."}')
  })

  it('throws LLMRateLimitError with retryAfterMs parsed from the header on a 429', async () => {
    handler = () => ({
      status: 429,
      body: { error: { message: 'rate limited' } },
      headers: { 'retry-after': '2' },
    })

    await expect(provider().complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(LLMRateLimitError)
        expect((error as LLMRateLimitError).retryAfterMs).toBe(2000)
        expect((error as Error).message).toContain('rate limited')
        return true
      },
    )
  })

  it('throws a plain LLMRateLimitError with no retryAfterMs when the header is absent', async () => {
    handler = () => ({ status: 429, body: { error: { message: 'slow down' } } })

    await expect(provider().complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(LLMRateLimitError)
        expect((error as LLMRateLimitError).retryAfterMs).toBeUndefined()
        return true
      },
    )
  })

  it('throws LLMProviderError with the status on a non-429 error response', async () => {
    handler = () => ({ status: 500, body: { error: { message: 'boom' } } })

    await expect(provider().complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(LLMProviderError)
        expect((error as LLMProviderError).status).toBe(500)
        expect((error as Error).message).toContain('boom')
        return true
      },
    )
  })

  it('throws LLMProviderError when the response has no completion content', async () => {
    handler = () => ({ status: 200, body: { choices: [] } })

    await expect(
      provider().complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(LLMProviderError)
  })
})

describe('createGroqProvider', () => {
  it('defaults to the documented free-tier model and provider name', () => {
    const groq = createGroqProvider({ apiKey: 'sk-groq' })
    expect(groq.name).toBe('groq')
    expect(groq.model).toBe(GROQ_DEFAULT_MODEL)
  })

  it('honors an explicit model override', () => {
    const groq = createGroqProvider({ apiKey: 'sk-groq', model: 'custom-model' })
    expect(groq.model).toBe('custom-model')
  })
})

describe('createOpenAiProvider', () => {
  it('defaults to the documented model and provider name', () => {
    const openai = createOpenAiProvider({ apiKey: 'sk-openai' })
    expect(openai.name).toBe('openai')
    expect(openai.model).toBe(OPENAI_DEFAULT_MODEL)
  })
})
