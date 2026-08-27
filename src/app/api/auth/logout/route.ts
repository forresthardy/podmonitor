import { NextResponse } from 'next/server'
import { clearSessionCookie, readSessionToken } from '@/lib/auth/cookies'
import { revokeSession } from '@/lib/auth/service'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // Revoke server-side first: clearing only the cookie would leave a live session row.
    await revokeSession(await readSessionToken())
    await clearSessionCookie()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
