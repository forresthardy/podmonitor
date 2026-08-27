import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ user: await requireUser() })
  } catch (error) {
    return errorResponse(error)
  }
}
