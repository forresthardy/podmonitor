import { createServer, type Server } from 'node:http'
import { readFile, rm, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AudioDownloadError, downloadAudio, withDownloadedAudio } from '@/lib/transcripts/audio'

/**
 * Exercised against a real local HTTP server rather than a mocked fetch: the behavior that
 * matters here is streaming, the mid-stream size cap, and temp-file cleanup, none of which
 * a stubbed fetch would actually test.
 */

type Handler = (path: string) => {
  status?: number
  body?: Buffer
  contentType?: string
  /** Send chunks without a content-length, as a real CDN does. */
  chunks?: Buffer[]
}

let server: Server
let baseUrl: string
let handler: Handler

beforeEach(async () => {
  handler = () => ({ body: Buffer.from('default') })
  server = createServer((request, response) => {
    const result = handler(request.url ?? '/')
    const status = result.status ?? 200
    if (result.chunks) {
      response.writeHead(status, { 'content-type': result.contentType ?? 'audio/mpeg' })
      for (const chunk of result.chunks) response.write(chunk)
      response.end()
      return
    }
    const body = result.body ?? Buffer.alloc(0)
    response.writeHead(status, {
      'content-type': result.contentType ?? 'audio/mpeg',
      'content-length': String(body.byteLength),
    })
    response.end(body)
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

const OPTIONS = { maxBytes: 1024 * 1024, timeoutMs: 10_000 }

describe('downloadAudio', () => {
  it('streams the body to disk byte for byte', async () => {
    const payload = Buffer.alloc(256 * 1024, 7)
    handler = () => ({ body: payload })

    const audio = await downloadAudio(`${baseUrl}/episode.mp3`, OPTIONS)

    expect(audio.bytes).toBe(payload.byteLength)
    expect(audio.contentType).toBe('audio/mpeg')
    // The URL's extension is preserved so the sidecar's demuxer can guess the container.
    expect(audio.path).toMatch(/episode\.mp3$/)
    expect(await readFile(audio.path)).toEqual(payload)

    // downloadAudio hands ownership of the directory to the caller, including here.
    await rm(audio.directory, { recursive: true, force: true })
  })

  it('rejects an oversized file from its declared length without downloading it', async () => {
    handler = () => ({ body: Buffer.alloc(4096, 1) })

    await expect(
      downloadAudio(`${baseUrl}/big.mp3`, { ...OPTIONS, maxBytes: 1024 }),
    ).rejects.toThrow(/over the 1024 byte limit/)
  })

  it('enforces the cap mid-stream when no length is declared', async () => {
    // A chunked response can lie by omission; the cap has to hold anyway.
    handler = () => ({ chunks: [Buffer.alloc(600, 1), Buffer.alloc(600, 2)] })

    await expect(
      downloadAudio(`${baseUrl}/chunked.mp3`, { ...OPTIONS, maxBytes: 1000 }),
    ).rejects.toThrow(/exceeded the 1000 byte limit mid-download/)
  })

  it('rejects an error response', async () => {
    handler = () => ({ status: 404, body: Buffer.from('nope') })

    await expect(downloadAudio(`${baseUrl}/missing.mp3`, OPTIONS)).rejects.toThrow(
      /returned HTTP 404/,
    )
  })

  it('rejects an empty body', async () => {
    handler = () => ({ body: Buffer.alloc(0) })

    await expect(downloadAudio(`${baseUrl}/empty.mp3`, OPTIONS)).rejects.toThrow(/produced 0 bytes/)
  })

  it('refuses a non-http URL', async () => {
    // A feed must never be able to make the worker read a local file.
    await expect(downloadAudio('file:///etc/passwd', OPTIONS)).rejects.toBeInstanceOf(
      AudioDownloadError,
    )
  })

  it('leaves no temp directory behind when the download fails', async () => {
    handler = () => ({ status: 500, body: Buffer.from('boom') })
    const before = await countTempDirs()

    await expect(downloadAudio(`${baseUrl}/fail.mp3`, OPTIONS)).rejects.toThrow()

    expect(await countTempDirs()).toBe(before)
  })
})

describe('withDownloadedAudio', () => {
  it('deletes the audio after the callback returns', async () => {
    handler = () => ({ body: Buffer.alloc(2048, 3) })

    const seenPath = await withDownloadedAudio(`${baseUrl}/ep.mp3`, OPTIONS, async (audio) => {
      // The file must exist while the callback runs — the sidecar streams it from here.
      expect((await stat(audio.path)).size).toBe(2048)
      return audio.path
    })

    await expect(stat(seenPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deletes the audio even when the callback throws', async () => {
    handler = () => ({ body: Buffer.alloc(2048, 3) })
    let capturedPath = ''

    await expect(
      withDownloadedAudio(`${baseUrl}/ep.mp3`, OPTIONS, async (audio) => {
        capturedPath = audio.path
        throw new Error('sidecar exploded')
      }),
    ).rejects.toThrow('sidecar exploded')

    expect(capturedPath).not.toBe('')
    await expect(stat(capturedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function countTempDirs(): Promise<number> {
  const { readdir } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const entries = await readdir(tmpdir())
  return entries.filter((entry) => entry.startsWith('podmonitor-audio-')).length
}
