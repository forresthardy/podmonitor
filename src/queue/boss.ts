import PgBoss from 'pg-boss'
import { databaseUrl } from '@/lib/env'
import { ALL_QUEUES, QUEUE_OPTIONS } from './queues'

/** pg-boss owns its own schema so its tables never collide with Drizzle migrations. */
export const PG_BOSS_SCHEMA = 'pgboss'

let bossPromise: Promise<PgBoss> | undefined

async function startBoss(): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl(), schema: PG_BOSS_SCHEMA })
  // A queue error that reaches nobody is an invisible outage.
  boss.on('error', (error) => {
    console.error('[queue] pg-boss error', error)
  })
  await boss.start()
  await ensureQueues(boss)
  return boss
}

/**
 * Returns the process-wide pg-boss instance, starting it on first use.
 * A failed start clears the cached promise so the next caller retries instead of
 * inheriting a permanently rejected singleton.
 */
export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = startBoss().catch((error: unknown) => {
      bossPromise = undefined
      throw error
    })
  }
  return bossPromise
}

/**
 * Creating a queue that already exists is a no-op, so this is safe on every boot.
 * An existing queue is updated rather than left alone, so a changed retry policy takes
 * effect on deploy instead of only on a fresh database.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of ALL_QUEUES) {
    const options = { name, ...QUEUE_OPTIONS[name] }
    const existing = await boss.getQueue(name)
    if (existing) {
      await boss.updateQueue(name, options)
    } else {
      await boss.createQueue(name, options)
    }
  }
}

export async function stopBoss(): Promise<void> {
  const current = bossPromise
  bossPromise = undefined
  if (!current) return
  const boss = await current
  await boss.stop({ graceful: true })
}
