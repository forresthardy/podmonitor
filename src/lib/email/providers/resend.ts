import { EmailProviderError } from '../errors'
import type { EmailMessage, EmailProvider, EmailSendResult } from '../types'

/** Default (free-tier) email adapter per the spec: 100/day, no card required. */
export const RESEND_BASE_URL = 'https://api.resend.com'

export interface ResendProviderOptions {
  apiKey: string
  /** The verified sender address/name Resend will send as. */
  from: string
  baseUrl?: string
  timeoutMs?: number
}

/** Pulls Resend's JSON `message`, falling back to the raw body. */
function errorDetail(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    const message = (parsed as { message?: unknown })?.message
    if (typeof message === 'string') return message
  } catch {
    // Not JSON; the raw body is the best detail available.
  }
  return body
}

export function createResendProvider(options: ResendProviderOptions): EmailProvider {
  const baseUrl = options.baseUrl ?? RESEND_BASE_URL
  const timeoutMs = options.timeoutMs ?? 30_000

  return {
    name: 'resend',
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const endpoint = new URL('emails', `${baseUrl.replace(/\/+$/, '')}/`)
      const signal = AbortSignal.timeout(timeoutMs)

      let response: Response
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new EmailProviderError(`resend request failed: ${detail}`, 'resend')
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new EmailProviderError(
          `resend returned HTTP ${response.status}: ${errorDetail(body) || '(no detail)'}`,
          'resend',
          response.status,
        )
      }

      const payload: unknown = await response.json().catch(() => undefined)
      const id = (payload as { id?: unknown })?.id
      return { id: typeof id === 'string' ? id : undefined }
    },
  }
}
