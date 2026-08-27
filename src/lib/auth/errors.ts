export type AuthErrorCode =
  | 'invalid_input'
  | 'email_taken'
  | 'invalid_credentials'
  | 'unauthenticated'

const STATUS_BY_CODE: Record<AuthErrorCode, number> = {
  invalid_input: 400,
  email_taken: 409,
  invalid_credentials: 401,
  unauthenticated: 401,
}

/** A failure the client is allowed to see, with a stable machine-readable code. */
export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly status: number

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
  }
}
