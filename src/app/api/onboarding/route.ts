import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse, readJsonBody } from '@/lib/http'
import { completeOnboarding } from '@/lib/onboarding/service'

export const dynamic = 'force-dynamic'

/** Records the reader's interests and subscribes them to the seed shows. Idempotent. */
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const result = await completeOnboarding(user.id, await readJsonBody(request))
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
