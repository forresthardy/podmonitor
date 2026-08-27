import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/db/client'
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
export async function listInterests(userId: string): Promise<Interest[]> {
  return getDb()
    .select()
    .from(interests)
    .where(and(eq(interests.userId, userId), eq(interests.active, true)))
    .orderBy(asc(interests.createdAt))
}

export async function createInterest(userId: string, input: unknown): Promise<Interest> {
  const parsed = createInterestSchema.safeParse(input)
  if (!parsed.success) {
    throw new AuthError('invalid_input', 'interest text must be 2-200 characters')
  }

  const inserted = await getDb()
    .insert(interests)
    .values({ userId, text: parsed.data.text, weight: parsed.data.weight })
    .returning()

  const interest = inserted[0]
  if (!interest) throw new Error('interest insert returned no row')
  return interest
}
