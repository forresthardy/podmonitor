import {
  emailFromAddress,
  emailProviderName,
  emailRequestTimeoutMs,
  requireEnv,
  smtpHost,
  smtpPort,
  smtpSecure,
} from '@/lib/env'
import { createResendProvider } from './providers/resend'
import { createSmtpProvider } from './providers/smtp'
import type { EmailProvider } from './types'

/**
 * Builds the active email provider from environment config. This is the one place that
 * reads `EMAIL_PROVIDER` — everything downstream (the digest job, the render step) only
 * ever sees the `EmailProvider` interface, so swapping Resend for an SMTP relay never
 * touches job code. Mirrors `src/lib/llm/provider.ts`.
 */
export function createEmailProviderFromEnv(): EmailProvider {
  const name = emailProviderName()
  const from = emailFromAddress()

  switch (name) {
    case 'resend':
      return createResendProvider({
        apiKey: requireEnv('RESEND_API_KEY'),
        from,
        timeoutMs: emailRequestTimeoutMs(),
      })
    case 'smtp':
      return createSmtpProvider({
        host: smtpHost(),
        port: smtpPort(),
        secure: smtpSecure(),
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASSWORD,
        from,
      })
  }
}
