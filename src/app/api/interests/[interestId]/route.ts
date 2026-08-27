import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse } from '@/lib/http'
import { deactivateInterest } from '@/lib/settings/service'

export const dynamic = 'force-dynamic'

/**
 * Retires one interest. Another reader's interest id answers 404 — the same answer as an id
 * that never existed, so the endpoint reveals nothing about other accounts.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ interestId: string }> },
) {
  try {
    const user = await requireUser()
    const { interestId } = await context.params
    await deactivateInterest(user.id, interestId)
    return NextResponse.json({ interestId })
  } catch (error) {
    return errorResponse(error)
  }
}
