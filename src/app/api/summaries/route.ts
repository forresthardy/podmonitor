import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse } from '@/lib/http'
import { listUserSummaries } from '@/lib/knowledge/summary-service'

export const dynamic = 'force-dynamic'

/** The signed-in user's recent summaries, each with its cross-reference callouts. */
export async function GET() {
  try {
    const user = await requireUser()
    return NextResponse.json({ summaries: await listUserSummaries(user.id) })
  } catch (error) {
    return errorResponse(error)
  }
}
