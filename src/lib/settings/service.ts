import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, type Database } from '@/db/client'
import { digests, interests, users } from '@/db/schema'
import { AuthError } from '@/lib/auth/errors'
import type { DigestView, InterestView, SettingsView } from './types'

/**
 * Settings reads and writes.
 *
 * Every function takes `userId` first and filters on it, matching the rule the rest of the
 * app follows: the id comes from the session, never from request input. An interest id or
 * a digest belonging to someone else is not an authorization error to explain — it simply
 * does not exist for this caller.
 */

const RECENT_DIGEST_LIMIT = 8

const digestPreferenceSchema = z.object({ weeklyDigestOptIn: z.boolean() })

export async function getSettingsView(
  userId: string,
  db: Database = getDb(),
): Promise<SettingsView> {
  const [account] = await db
    .select({ email: users.email, weeklyDigestOptIn: users.weeklyDigestOptIn })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  // A live session whose user row vanished is a broken invariant, not a 404 to render.
  if (!account) throw new Error(`settings requested for missing user ${userId}`)

  const [interestRows, digestRows] = await Promise.all([
    db
      .select({ id: interests.id, text: interests.text, weight: interests.weight })
      .from(interests)
      .where(and(eq(interests.userId, userId), eq(interests.active, true)))
      .orderBy(desc(interests.createdAt)),
    db
      .select({
        id: digests.id,
        weekOf: digests.weekOf,
        sentAt: digests.sentAt,
        episodeIds: digests.episodeIds,
      })
      .from(digests)
      .where(eq(digests.userId, userId))
      .orderBy(desc(digests.weekOf))
      .limit(RECENT_DIGEST_LIMIT),
  ])

  const interestViews: InterestView[] = interestRows.map((row) => ({
    id: row.id,
    text: row.text,
    weight: row.weight,
  }))

  const digestViews: DigestView[] = digestRows.map((row) => ({
    id: row.id,
    weekOf: row.weekOf,
    sentAt: row.sentAt?.toISOString() ?? null,
    episodeCount: row.episodeIds.length,
  }))

  return {
    email: account.email,
    weeklyDigestOptIn: account.weeklyDigestOptIn,
    interests: interestViews,
    recentDigests: digestViews,
  }
}

export async function setDigestPreference(
  userId: string,
  input: unknown,
  db: Database = getDb(),
): Promise<SettingsView> {
  const parsed = digestPreferenceSchema.safeParse(input)
  if (!parsed.success) {
    throw new AuthError('invalid_input', 'weeklyDigestOptIn must be true or false')
  }

  await db
    .update(users)
    .set({ weeklyDigestOptIn: parsed.data.weeklyDigestOptIn })
    .where(eq(users.id, userId))

  return getSettingsView(userId, db)
}

/**
 * Retires an interest rather than deleting it.
 *
 * `episode_interest_matches.interest_id` points at this row, and past matches explain why
 * an episode is in the library at all. Deactivating stops future scoring — which is what
 * "remove" means to the reader — without rewriting the history that produced their
 * existing summaries.
 */
export async function deactivateInterest(
  userId: string,
  interestId: string,
  db: Database = getDb(),
): Promise<void> {
  const updated = await db
    .update(interests)
    .set({ active: false })
    .where(and(eq(interests.id, interestId), eq(interests.userId, userId)))
    .returning({ id: interests.id })

  if (updated.length === 0) {
    throw new AuthError('not_found', 'Interest not found')
  }
}
