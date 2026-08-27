import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { errorResponse } from '@/lib/http'
import { browseInsights, searchInsights } from '@/lib/knowledge/search-service'
import type { InsightSearchResponse } from '@/lib/knowledge/search-view'

export const dynamic = 'force-dynamic'

/**
 * `?q=` searches the reader's insights semantically; without it, the browse feed.
 *
 * The query is echoed back in the response so the client can drop a reply that arrived
 * after the reader had already typed something else — an out-of-order response rendering
 * over newer results is the classic bug in a search-as-you-type box.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''

    const results = query
      ? await searchInsights(user.id, query)
      : await browseInsights(user.id)

    const body: InsightSearchResponse = { query, results }
    return NextResponse.json(body)
  } catch (error) {
    return errorResponse(error)
  }
}
