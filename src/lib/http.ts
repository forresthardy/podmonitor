import { NextResponse } from 'next/server'
import { AuthError } from '@/lib/auth/errors'

export interface ApiErrorBody {
  error: { code: string; message: string }
}

/**
 * Maps a thrown error to a response. Known AuthErrors surface their code; anything else
 * is logged in full and reported as an opaque 500 — never silently swallowed.
 */
export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }

  console.error('[api] unhandled error', error)
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Something went wrong' } },
    { status: 500 },
  )
}

/** Parses a JSON body, returning `{}` for empty or malformed payloads so validation owns the error. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}
