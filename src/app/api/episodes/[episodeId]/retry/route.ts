import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/current-user'
import { retryFailedEpisode } from '@/lib/episodes/library-service'
import { errorResponse } from '@/lib/http'
import { QUEUES } from '@/queue/queues'

export const dynamic = 'force-dynamic'

/**
 * Re-enters the pipeline at transcript acquisition.
 *
 * One entry point covers every failure stage: `handleAcquireTranscript` returns
 * `already_present` and hands straight off to summarization when the transcript is already
 * stored, so an episode that failed while being summarized is not re-transcribed — the
 * expensive half is skipped without the route having to know where the failure happened.
 *
 * pg-boss is imported lazily so a request that never retries anything does not open a
 * queue connection.
 */
async function enqueueRetry(episodeId: string): Promise<void> {
  const { getBoss } = await import('@/queue/boss')
  const boss = await getBoss()
  await boss.send(QUEUES.acquireTranscript, { episodeId })
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ episodeId: string }> },
) {
  try {
    const user = await requireUser()
    const { episodeId } = await context.params
    await retryFailedEpisode(user.id, episodeId, enqueueRetry)
    return NextResponse.json({ episodeId, status: 'discovered' })
  } catch (error) {
    return errorResponse(error)
  }
}
