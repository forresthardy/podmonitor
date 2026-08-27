import nodemailer from 'nodemailer'
import { EmailProviderError } from '../errors'
import type { EmailMessage, EmailProvider, EmailSendResult } from '../types'

export interface SmtpProviderOptions {
  host: string
  port: number
  secure: boolean
  user?: string
  password?: string
  /** The sender address/name the SMTP server will send as. */
  from: string
}

/**
 * Generic SMTP adapter — any SMTP-speaking provider (Postmark, SES, a self-hosted relay)
 * plugs in via config, proving the `EmailProvider` interface is not Resend-specific.
 * Switching from `EMAIL_PROVIDER=resend` to `smtp` is a config change, never a code change.
 */
export function createSmtpProvider(options: SmtpProviderOptions): EmailProvider {
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: options.user && options.password ? { user: options.user, pass: options.password } : undefined,
  })

  return {
    name: 'smtp',
    async send(message: EmailMessage): Promise<EmailSendResult> {
      try {
        const info = await transport.sendMail({
          from: options.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        })
        return { id: info.messageId }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new EmailProviderError(`smtp send failed: ${detail}`, 'smtp')
      }
    },
  }
}
