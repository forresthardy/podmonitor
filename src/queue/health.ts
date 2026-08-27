import { sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { getBoss } from './boss'
import { ALL_QUEUES } from './queues'

export interface ComponentHealth {
  ok: boolean
  detail: string
}

export interface HealthReport {
  ok: boolean
  database: ComponentHealth
  pgvector: ComponentHealth
  queue: ComponentHealth & { queues: Array<{ name: string; size: number }> }
}

async function checkDatabase(): Promise<ComponentHealth> {
  try {
    await getDb().execute(sql`select 1`)
    return { ok: true, detail: 'reachable' }
  } catch (error) {
    return { ok: false, detail: describe(error) }
  }
}

async function checkPgvector(): Promise<ComponentHealth> {
  try {
    const result = await getDb().execute<{ installed: boolean }>(
      sql`select exists (select 1 from pg_extension where extname = 'vector') as installed`,
    )
    const installed = result.rows[0]?.installed === true
    return installed
      ? { ok: true, detail: 'extension installed' }
      : { ok: false, detail: 'extension "vector" is not installed' }
  } catch (error) {
    return { ok: false, detail: describe(error) }
  }
}

async function checkQueue(): Promise<HealthReport['queue']> {
  try {
    const boss = await getBoss()
    const queues = await Promise.all(
      ALL_QUEUES.map(async (name) => ({ name, size: await boss.getQueueSize(name) })),
    )
    return { ok: true, detail: 'started', queues }
  } catch (error) {
    return { ok: false, detail: describe(error), queues: [] }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Probes every infrastructure dependency the pipeline needs before it can do any work. */
export async function checkHealth(): Promise<HealthReport> {
  const [database, pgvector, queue] = await Promise.all([
    checkDatabase(),
    checkPgvector(),
    checkQueue(),
  ])
  return { ok: database.ok && pgvector.ok && queue.ok, database, pgvector, queue }
}
