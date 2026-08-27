import type PgBoss from 'pg-boss'
import { getDb } from '@/db/client'
import { podcasts } from '@/db/schema'
import { pollAllPodcasts } from '@/lib/feeds/ingest'
import { ensureSeedPodcasts } from '@/lib/feeds/seed-podcasts'
import { QUEUES } from '../queues'

// Re-exported for the tests and callers that already know this name from the poll worker.
export { ensureSeedPodcasts }

/**
 * Registers the `poll-feeds` pg-boss worker. On each job it ensures the seed shows are
 * present, then polls every known podcast's feed and upserts podcasts/episodes.
 * Idempotent: re-running (retry, duplicate schedule tick, manual trigger) never creates
 * duplicate rows — see `ingestFeedXml` for how the guid/feed_url uniqueness is enforced.
 *
 * Every newly-inserted episode is fanned out onto `ingest-episode` — the INTEREST MATCH
 * stage — exactly once. A repeat poll of the same feed content inserts nothing new, so it
 * enqueues nothing new either.
 */
export async function registerPollFeedsWorker(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.pollFeeds, async (jobs) => {
    for (const job of jobs) {
      await ensureSeedPodcasts()

      const rows = await getDb().select({ feedUrl: podcasts.feedUrl }).from(podcasts)
      const result = await pollAllPodcasts(rows.map((row) => row.feedUrl))

      for (const failure of result.failed) {
        console.error(`[poll-feeds] job ${job.id} failed to poll ${failure.feedUrl}: ${failure.error}`)
      }

      const newEpisodeIds = result.succeeded.flatMap((summary) => summary.insertedEpisodeIds)
      for (const episodeId of newEpisodeIds) {
        await boss.send(QUEUES.ingestEpisode, { episodeId })
      }

      console.log(
        `[poll-feeds] job ${job.id} polled ${result.succeeded.length} feed(s), ` +
          `inserted ${newEpisodeIds.length} new episode(s), ` +
          `${result.failed.length} failure(s)`,
      )
    }
  })
}

/**
 * Schedules the recurring poll. `pg-boss` scheduling is itself idempotent per queue name, so
 * calling this on every worker boot just keeps the existing cron in sync rather than
 * duplicating it.
 */
export async function schedulePollFeeds(boss: PgBoss): Promise<void> {
  await boss.schedule(QUEUES.pollFeeds, '*/30 * * * *', {})
}
