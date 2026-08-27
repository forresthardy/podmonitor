import { getBoss, stopBoss } from './boss'
import { registerAcquireTranscriptWorker } from './handlers/acquire-transcript'
import { registerPollFeedsWorker, schedulePollFeeds } from './handlers/poll-feeds'
import { ALL_QUEUES, QUEUES } from './queues'

/**
 * Worker entry point. Each implemented stage registers its own worker from
 * `handlers/`; the remaining stages still only log, so an enqueued job is visible before
 * its stage exists. Running this process proves the queue round-trips end to end.
 */

/** Stages with a real handler. Everything else gets the placeholder logger below. */
const IMPLEMENTED_QUEUES: readonly string[] = [QUEUES.pollFeeds, QUEUES.acquireTranscript]

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
  await registerAcquireTranscriptWorker(boss)

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
