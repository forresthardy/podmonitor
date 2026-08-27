import { getBoss, stopBoss } from './boss'
import { ALL_QUEUES } from './queues'

/**
 * Worker entry point. The foundation registers a handler per pipeline stage that only
 * logs: later PRs replace each body with the real stage. Running this process proves the
 * queue round-trips end to end.
 */
async function main(): Promise<void> {
  const boss = await getBoss()

  for (const name of ALL_QUEUES) {
    await boss.work(name, async (jobs) => {
      for (const job of jobs) {
        console.log(`[worker] ${name} received job ${job.id} (no handler implemented yet)`)
      }
    })
  }

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
