import { getBoss, stopBoss } from './boss'
import { registerAcquireTranscriptWorker } from './handlers/acquire-transcript'
import { registerBuildDigestWorker, scheduleBuildDigest } from './handlers/build-digest'
import { registerIngestEpisodeWorker } from './handlers/ingest-episode'
import { registerLinkInsightsWorker } from './handlers/link-insights'
import { registerPollFeedsWorker, schedulePollFeeds } from './handlers/poll-feeds'
import { registerSummarizeEpisodeWorker } from './handlers/summarize-episode'
import { ALL_QUEUES, QUEUES } from './queues'

/**
 * Worker entry point. `poll-feeds`, `ingest-episode`, `acquire-transcript`,
 * `summarize-episode`, `link-insights`, and `build-digest` have real handlers; every other
 * pipeline stage still only logs, since a later PR replaces each of those bodies in turn.
 * Running this process proves the queue round-trips end to end.
 */

/** Stages with a real handler. Everything else gets the placeholder logger below. */
const IMPLEMENTED_QUEUES: readonly string[] = [
  QUEUES.pollFeeds,
  QUEUES.ingestEpisode,
  QUEUES.acquireTranscript,
  QUEUES.summarizeEpisode,
  QUEUES.linkInsights,
  QUEUES.buildDigest,
]

async function main(): Promise<void> {
  const boss = await getBoss()

  for (const name of ALL_QUEUES) {
    if (IMPLEMENTED_QUEUES.includes(name)) continue
    await boss.work(name, async (jobs) => {
      for (const job of jobs) {
        console.log(`[worker] ${name} received job ${job.id} (no handler implemented yet)`)
      }
    })
  }

  await registerPollFeedsWorker(boss)
  await schedulePollFeeds(boss)
  await registerIngestEpisodeWorker(boss)
  await registerAcquireTranscriptWorker(boss)
  await registerSummarizeEpisodeWorker(boss)
  await registerLinkInsightsWorker(boss)
  await registerBuildDigestWorker(boss)
  await scheduleBuildDigest(boss)

  console.log(`[worker] listening on ${ALL_QUEUES.length} queues`)
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} received, stopping`)
  await stopBoss()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error)
  process.exitCode = 1
})
