import { z } from 'zod'
import { AuthError } from './errors'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password'

export interface Credentials {
  email: string
  password: string
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
})

/** Emails are compared and stored in one canonical form so `A@x.com` cannot shadow `a@x.com`. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Validates raw request input into credentials, translating Zod issues into a single
 * client-safe AuthError. Returns the normalized email.
 */
export function parseCredentials(input: unknown): Credentials {
  const result = credentialsSchema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue?.path.join('.') ?? 'input'
    const detail =
      field === 'password'
        ? `password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`
        : 'a valid email address is required'
    throw new AuthError('invalid_input', detail)
  }
  return result.data
}
