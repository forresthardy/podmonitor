import { sql } from 'drizzle-orm'
import { getDb } from '@/db/client'

/**
 * Wipes every domain table. `cascade` reaches sessions, interests, summaries and
 * insights through their foreign keys, so new tables stay covered automatically.
 */
export async function resetDatabase(): Promise<void> {
  await getDb().execute(sql`truncate table users, podcasts restart identity cascade`)
}
