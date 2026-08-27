import { getBoss, stopBoss } from './boss'
import { registerPollFeedsWorker, schedulePollFeeds } from './handlers/poll-feeds'
import { ALL_QUEUES, QUEUES } from './queues'

/**
 * Worker entry point. `poll-feeds` has its real handler; every other pipeline stage still
 * only logs, since a later PR replaces each of those bodies in turn. Running this process
 * proves the queue round-trips end to end.
 */
async function main(): Promise<void> {
  const boss = await getBoss()

  for (const name of ALL_QUEUES) {
    if (name === QUEUES.pollFeeds) continue
    await boss.work(name, async (jobs) => {
      for (const job of jobs) {
        console.log(`[worker] ${name} received job ${job.id} (no handler implemented yet)`)
      }
    })
  }

  await registerPollFeedsWorker(boss)
  await schedulePollFeeds(boss)

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
