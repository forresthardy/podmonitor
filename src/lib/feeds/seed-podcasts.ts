import { getDb, type Database } from '@/db/client'
import { podcasts } from '@/db/schema'
import { SEED_SHOWS } from './seed-shows'

/**
 * Makes sure the four seed shows exist as podcast rows. Safe to call on every poll run and
 * on every onboarding submit: `onConflictDoNothing` on `feed_url` leaves an existing show
 * exactly as-is (title edits made after the fact, `last_polled_at` history, etc. are never
 * reset).
 *
 * Lives here rather than beside the poll worker because onboarding needs it too, and a web
 * route should not have to import the queue module — and with it pg-boss — to subscribe a
 * new reader to the seed shows.
 */
export async function ensureSeedPodcasts(db: Database = getDb()): Promise<void> {
  await db
    .insert(podcasts)
    .values(SEED_SHOWS.map((show) => ({ feedUrl: show.feedUrl, title: show.title })))
    .onConflictDoNothing({ target: podcasts.feedUrl })
}
