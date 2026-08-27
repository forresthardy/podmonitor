import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, type Database } from '@/db/client'
import { interests } from '@/db/schema'
import { AuthError } from '@/lib/auth/errors'
import { ensureSeedPodcasts } from '@/lib/feeds/seed-podcasts'
import { SEED_SHOWS } from '@/lib/feeds/seed-shows'
import { addOrReactivateInterest } from '@/lib/interests/service'

/**
 * Onboarding: the reader states what they care about, and the four seed shows start being
 * monitored for them.
 *
 * "Subscribe" is deliberately not a per-user join table in v1. The seed shows are the whole
 * catalogue and every account watches all four; what is per-user is the interest set and
 * the match rows scoring produces from it. Adding a subscription table now would model a
 * choice the product does not yet offer, and the isolation that matters — which episodes
 * and summaries a reader sees — already runs through `episode_interest_matches`.
 */

const MAX_ONBOARDING_INTERESTS = 12

const onboardingSchema = z.object({
  interests: z
    .array(z.string().trim().min(2).max(200))
    .min(1)
    .max(MAX_ONBOARDING_INTERESTS),
})

export interface OnboardingResult {
  interestsCreated: number
  showsSubscribed: number
}

export async function completeOnboarding(
  userId: string,
  input: unknown,
  db: Database = getDb(),
): Promise<OnboardingResult> {
  const parsed = onboardingSchema.safeParse(input)
  if (!parsed.success) {
    throw new AuthError(
      'invalid_input',
      `Enter between 1 and ${MAX_ONBOARDING_INTERESTS} interests, each 2-200 characters`,
    )
  }

  // Case-insensitive de-dupe of the submitted list itself: "AI agents" and "ai agents" in
  // one submission are the same topic, and scoring both would double-count it.
  const unique = [
    ...new Map(parsed.data.interests.map((text) => [text.toLowerCase(), text])).values(),
  ]

  // Sequential rather than parallel: each call reads the reader's existing interests to
  // decide insert-vs-reactivate, so concurrent calls could both miss the same new row.
  // At most a dozen interests, so the round-trips are cheap.
  let interestsCreated = 0
  for (const text of unique) {
    const { created } = await addOrReactivateInterest(userId, { text }, db)
    if (created) interestsCreated += 1
  }

  // Idempotent, and the reason onboarding can be re-submitted safely: a reader who returns
  // to the form adds interests without duplicating the shows or their own existing topics.
  await ensureSeedPodcasts(db)

  return { interestsCreated, showsSubscribed: SEED_SHOWS.length }
}

/** True once the reader has at least one active interest — what the app routes on. */
export async function hasCompletedOnboarding(
  userId: string,
  db: Database = getDb(),
): Promise<boolean> {
  const rows = await db
    .select({ id: interests.id })
    .from(interests)
    .where(and(eq(interests.userId, userId), eq(interests.active, true)))
    .limit(1)

  return rows.length > 0
}
