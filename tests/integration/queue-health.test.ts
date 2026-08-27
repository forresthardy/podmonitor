import { afterAll, describe, expect, it } from 'vitest'
import { getBoss, stopBoss } from '@/queue/boss'
import { checkHealth } from '@/queue/health'
import { ALL_QUEUES, QUEUES } from '@/queue/queues'

afterAll(async () => {
  await stopBoss()
})

describe('infrastructure health', () => {
  it('reports database, pgvector, and queue all reachable', async () => {
    const report = await checkHealth()

    expect(report.database).toEqual({ ok: true, detail: 'reachable' })
    expect(report.pgvector.ok, report.pgvector.detail).toBe(true)
    expect(report.queue.ok, report.queue.detail).toBe(true)
    expect(report.queue.queues.map((queue) => queue.name)).toEqual(ALL_QUEUES)
    expect(report.ok).toBe(true)
  })

  it('round-trips a job through a pipeline queue', async () => {
    const boss = await getBoss()

    const jobId = await boss.send(QUEUES.pollFeeds, { probe: true })
    expect(jobId).toBeTruthy()

    const [fetched] = await boss.fetch(QUEUES.pollFeeds)
    expect(fetched?.id).toBe(jobId)
    expect(fetched?.data).toEqual({ probe: true })

    await boss.complete(QUEUES.pollFeeds, fetched?.id ?? '')
  })
})
