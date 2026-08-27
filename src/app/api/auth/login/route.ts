import { NextResponse } from 'next/server'
import { setSessionCookie } from '@/lib/auth/cookies'
import { loginUser } from '@/lib/auth/service'
import { errorResponse, readJsonBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const { user, session } = await loginUser(await readJsonBody(request))
    await setSessionCookie(session)
    return NextResponse.json({ user })
  } catch (error) {
    return errorResponse(error)
  }
}
