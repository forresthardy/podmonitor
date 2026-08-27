/**
 * The email provider adapter interface. Every backend (Resend, SMTP, ...) implements this
 * one shape, so the digest job never branches on which provider is active — swapping
 * providers is a config change (`EMAIL_PROVIDER`), never a code change. Mirrors the LLM
 * provider interface in `src/lib/llm/types.ts`.
 */

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSendResult {
  /** Provider-assigned message id, when available (e.g. Resend's `id`). */
  id?: string
}

export interface EmailProvider {
  /** Short identifier for logging, e.g. `resend`. */
  readonly name: string
  send(message: EmailMessage): Promise<EmailSendResult>
}
