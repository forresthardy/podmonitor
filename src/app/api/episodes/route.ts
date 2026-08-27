import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { listEpisodeLibrary } from '@/lib/episodes/library-service'
import { errorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'

/** The signed-in reader's episode library, with each episode's pipeline state. */
export async function GET() {
  try {
    const user = await requireUser()
    return NextResponse.json({ episodes: await listEpisodeLibrary(user.id) })
  } catch (error) {
    return errorResponse(error)
  }
}
