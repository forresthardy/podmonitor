import { NextResponse } from 'next/server'
import { setSessionCookie } from '@/lib/auth/cookies'
import { registerUser } from '@/lib/auth/service'
import { errorResponse, readJsonBody } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const { user, session } = await registerUser(await readJsonBody(request))
    await setSessionCookie(session)
    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
