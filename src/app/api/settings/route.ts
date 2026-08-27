import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse, readJsonBody } from '@/lib/http'
import { getSettingsView, setDigestPreference } from '@/lib/settings/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requireUser()
    return NextResponse.json({ settings: await getSettingsView(user.id) })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Changes the digest preference and answers with the whole settings view: the client then
 * renders server state rather than its own optimistic guess about what the toggle did.
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser()
    const settings = await setDigestPreference(user.id, await readJsonBody(request))
    return NextResponse.json({ settings })
  } catch (error) {
    return errorResponse(error)
  }
}
