import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, type Database } from '@/db/client'
import { interests, type Interest } from '@/db/schema'
import { AuthError } from '@/lib/auth/errors'

const createInterestSchema = z.object({
  text: z.string().trim().min(2).max(200),
  weight: z.number().min(0).max(10).default(1),
})

/**
 * Every read and write takes `userId` as its first argument and filters on it. No caller
 * can pass a user id from request input: it always comes from `requireUser()`.
 */
export async function listInterests(userId: string, db: Database = getDb()): Promise<Interest[]> {
  return db
    .select()
    .from(interests)
    .where(and(eq(interests.userId, userId), eq(interests.active, true)))
    .orderBy(asc(interests.createdAt))
}

export interface AddInterestResult {
  interest: Interest
  /** False when the interest already existed — the settings page shows no new row. */
  created: boolean
}

/**
 * The single definition of "add an interest", used by onboarding, settings, and the API.
 *
 * Repeating an interest the reader already holds is a no-op, and repeating one they retired
 * reactivates that row rather than inserting a second one. Both matter beyond tidiness:
 * `episode_interest_matches.interest_id` points at the original row, so a duplicate would
 * strand the matches that explain why episodes are already in their library, and two active
 * rows for the same topic would double-count it every time an episode is scored.
 *
 * Matching is case-insensitive, done in JS over the reader's own interests rather than with
 * a `lower()` index: the row count here is a handful per account, and a partial unique index
 * would still need this branch to distinguish reactivation from insertion.
 */
export async function addOrReactivateInterest(
  userId: string,
  input: unknown,
  db: Database = getDb(),
): Promise<AddInterestResult> {
  const parsed = createInterestSchema.safeParse(input)
  if (!parsed.success) {
    throw new AuthError('invalid_input', 'interest text must be 2-200 characters')
  }
  const { text, weight } = parsed.data

  const existing = await db.select().from(interests).where(eq(interests.userId, userId))
  const match = existing.find((row) => row.text.toLowerCase() === text.toLowerCase())

  if (!match) {
    const [inserted] = await db.insert(interests).values({ userId, text, weight }).returning()
    if (!inserted) throw new Error('interest insert returned no row')
    return { interest: inserted, created: true }
  }

  if (match.active) return { interest: match, created: false }

  const [reactivated] = await db
    .update(interests)
    .set({ active: true })
    .where(eq(interests.id, match.id))
    .returning()

  if (!reactivated) throw new Error('interest reactivation returned no row')
  return { interest: reactivated, created: false }
}

export async function createInterest(
  userId: string,
  input: unknown,
  db: Database = getDb(),
): Promise<Interest> {
  const { interest } = await addOrReactivateInterest(userId, input, db)
  return interest
}
