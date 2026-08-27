import type PgBoss from 'pg-boss'
import { getDb } from '@/db/client'
import { podcasts } from '@/db/schema'
import { pollAllPodcasts } from '@/lib/feeds/ingest'
import { SEED_SHOWS } from '@/lib/feeds/seed-shows'
import { QUEUES } from '../queues'

/**
 * Makes sure the four seed shows exist as podcast rows. Safe to call on every poll run:
 * `onConflictDoNothing` on `feed_url` means an existing show is left exactly as-is (title
 * edits made after the fact, `last_polled_at` history, etc. are never reset).
 */
export async function ensureSeedPodcasts(): Promise<void> {
  const db = getDb()
  await db
    .insert(podcasts)
    .values(SEED_SHOWS.map((show) => ({ feedUrl: show.feedUrl, title: show.title })))
    .onConflictDoNothing({ target: podcasts.feedUrl })
}

/**
 * Registers the `poll-feeds` pg-boss worker. On each job it ensures the seed shows are
 * present, then polls every known podcast's feed and upserts podcasts/episodes.
 * Idempotent: re-running (retry, duplicate schedule tick, manual trigger) never creates
 * duplicate rows — see `ingestFeedXml` for how the guid/feed_url uniqueness is enforced.
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
      console.log(
        `[poll-feeds] job ${job.id} polled ${result.succeeded.length} feed(s), ` +
          `inserted ${result.succeeded.reduce((sum, s) => sum + s.episodesInserted, 0)} new episode(s), ` +
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
