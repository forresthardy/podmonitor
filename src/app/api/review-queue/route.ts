import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse } from '@/lib/http'
import { listReviewQueue } from '@/lib/interest-matching/match-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requireUser()
    return NextResponse.json({ items: await listReviewQueue(user.id) })
  } catch (error) {
    return errorResponse(error)
  }
}
