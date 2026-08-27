import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse } from '@/lib/http'
import { dismissMatch } from '@/lib/interest-matching/match-service'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, context: { params: Promise<{ matchId: string }> }) {
  try {
    const user = await requireUser()
    const { matchId } = await context.params
    return NextResponse.json({ match: await dismissMatch(user.id, matchId) })
  } catch (error) {
    return errorResponse(error)
  }
}
