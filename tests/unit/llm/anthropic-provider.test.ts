import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LLMProviderError, LLMRateLimitError } from '@/lib/llm/errors'
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from '@/lib/llm/providers/anthropic'

/**
 * Anthropic speaks a different wire format than the OpenAI-compatible adapters (top-level
 * `system` field, content-block response), so it gets its own contract suite against a
 * real local HTTP server standing in for the Anthropic API.
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
    body: { content: [{ type: 'text', text: 'hi' }] },
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
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

function provider() {
  return createAnthropicProvider({ apiKey: 'sk-ant-test', baseUrl, timeoutMs: 5000 })
}

describe('createAnthropicProvider', () => {
  it('defaults to the documented model and provider name', () => {
    expect(provider().name).toBe('anthropic')
    expect(provider().model).toBe(ANTHROPIC_DEFAULT_MODEL)
  })

  it('posts to /v1/messages with x-api-key and anthropic-version headers', async () => {
    let seenPath = ''
    let seenHeaders: Record<string, string | string[] | undefined> = {}
    handler = (req) => {
      seenPath = req.path
      seenHeaders = req.headers
      return { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } }
    }

    await provider().complete({ messages: [{ role: 'user', content: 'hello' }] })

    expect(seenPath).toBe('/v1/messages')
    expect(seenHeaders['x-api-key']).toBe('sk-ant-test')
    expect(seenHeaders['anthropic-version']).toBe('2023-06-01')
  })

  it('lifts system messages into the top-level system field, not the messages array', async () => {
    let seenBody: unknown
    handler = (req) => {
      seenBody = req.body
      return { status: 200, body: { content: [{ type: 'text', text: 'ok' }] } }
    }

    await provider().complete({
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'summarize this' },
      ],
    })

    expect(seenBody).toMatchObject({
      system: 'be terse',
      messages: [{ role: 'user', content: 'summarize this' }],
    })
  })

  it('joins text content blocks from the response', async () => {
    handler = () => ({
      status: 200,
      body: { content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: 'tail' }] },
    })

    const result = await provider().complete({ messages: [{ role: 'user', content: 'x' }] })

    expect(result).toBe('{"a":1}tail')
  })

  it('throws LLMRateLimitError with retryAfterMs on a 429', async () => {
    handler = () => ({
      status: 429,
      body: { error: { message: 'overloaded' } },
      headers: { 'retry-after': '3' },
    })

    await expect(provider().complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(LLMRateLimitError)
        expect((error as LLMRateLimitError).retryAfterMs).toBe(3000)
        return true
      },
    )
  })

  it('throws LLMProviderError with the status on a non-429 error response', async () => {
    handler = () => ({ status: 503, body: { error: { message: 'service unavailable' } } })

    await expect(provider().complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(LLMProviderError)
        expect((error as LLMProviderError).status).toBe(503)
        return true
      },
    )
  })

  it('throws LLMProviderError when the response has no text content block', async () => {
    handler = () => ({ status: 200, body: { content: [] } })

    await expect(
      provider().complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(LLMProviderError)
  })
})
