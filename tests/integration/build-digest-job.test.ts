import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/db/client'
import { digests, episodes, podcasts, summaries, users } from '@/db/schema'
import type { EmailProvider } from '@/lib/email/types'
import { handleBuildDigest } from '@/queue/handlers/build-digest'
import { resetDatabase } from '../helpers/db'

/**
 * The digest stage against a real database with a stubbed email provider. What is under
 * test is persistence, dry-run's guarantee that it never sends or writes, and the
 * idempotency the `digests` table's unique index provides — assembly/render logic itself
 * is covered by `tests/unit/digest-assemble.test.ts` and `tests/unit/digest-render.test.ts`.
 */

function stubProvider(): EmailProvider & { send: ReturnType<typeof vi.fn> } {
  return {
    name: 'stub',
    send: vi.fn(async () => ({ id: 'stub-message-id' })),
  }
}

async function seedUser(email: string): Promise<typeof users.$inferSelect> {
  const [user] = await getDb()
    .insert(users)
    .values({ email, passwordHash: 'not-a-real-hash' })
    .returning()
  if (!user) throw new Error('failed to seed user')
  return user
}

async function seedSummary(
  userId: string,
  options: { publishedAt: Date; createdAt: Date },
): Promise<void> {
  const db = getDb()
  const [podcast] = await db
    .insert(podcasts)
    .values({ feedUrl: `https://feeds.example.com/${crypto.randomUUID()}.xml`, title: 'Acquired' })
    .returning()
  if (!podcast) throw new Error('failed to seed podcast')

  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast.id,
      guid: crypto.randomUUID(),
      title: 'The Standard Oil Episode',
      status: 'summarized',
      publishedAt: options.publishedAt,
    })
    .returning()
  if (!episode) throw new Error('failed to seed episode')

  await db.insert(summaries).values({
    episodeId: episode.id,
    userId,
    tldr: 'Rockefeller built a refining monopoly.',
    insights: [{ text: 'Distribution moats beat product moats.', context: 'x', timestampSec: 1 }],
    quotes: [],
    topics: ['distribution'],
    model: 'stub:stub-model',
    createdAt: options.createdAt,
  })
}

beforeEach(async () => {
  await resetDatabase()
})

describe('handleBuildDigest', () => {
  it('dry-run mode renders the full email without sending or persisting a digest row', async () => {
    const user = await seedUser('a@example.com')
    await seedSummary(user.id, {
      publishedAt: new Date('2026-08-20T00:00:00Z'),
      createdAt: new Date('2026-08-20T12:00:00Z'),
    })
    const provider = stubProvider()

    const result = await handleBuildDigest(
      { userId: user.id, weekOf: '2026-08-24', dryRun: true },
      { provider, appUrl: 'https://app.example.com' },
    )

    expect(result.results).toEqual([
      expect.objectContaining({ outcome: 'dry_run', userId: user.id, weekOf: '2026-08-24' }),
    ])
    const rendered = result.results[0]?.rendered
    expect(rendered?.subject).toContain('1 new episode')
    expect(rendered?.html).toContain('Rockefeller built a refining monopoly.')
    expect(rendered?.text).toContain('https://app.example.com')

    // The whole point of dry-run: no email goes out, and no digests row is written.
    expect(provider.send).not.toHaveBeenCalled()
    expect(await getDb().select().from(digests)).toHaveLength(0)
  })

  it('sends the rendered email and stores one digests row per user for a real run', async () => {
    const user = await seedUser('a@example.com')
    await seedSummary(user.id, {
      publishedAt: new Date('2026-08-20T00:00:00Z'),
      createdAt: new Date('2026-08-20T12:00:00Z'),
    })
    const provider = stubProvider()

    const result = await handleBuildDigest(
      { userId: user.id, weekOf: '2026-08-24' },
      { provider, appUrl: 'https://app.example.com' },
    )

    expect(result.results).toEqual([
      expect.objectContaining({ outcome: 'sent', userId: user.id }),
    ])
    expect(provider.send).toHaveBeenCalledTimes(1)
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: user.email, subject: expect.stringContaining('1 new episode') }),
    )

    const stored = await getDb().select().from(digests).where(eq(digests.userId, user.id))
    expect(stored).toHaveLength(1)
    expect(stored[0]?.weekOf).toBe('2026-08-24')
    expect(stored[0]?.sentAt).not.toBeNull()
  })

  it('is idempotent: a re-delivered job for an already-sent week does not resend', async () => {
    const user = await seedUser('a@example.com')
    await seedSummary(user.id, {
      publishedAt: new Date('2026-08-20T00:00:00Z'),
      createdAt: new Date('2026-08-20T12:00:00Z'),
    })
    const provider = stubProvider()

    await handleBuildDigest({ userId: user.id, weekOf: '2026-08-24' }, { provider })
    const second = await handleBuildDigest({ userId: user.id, weekOf: '2026-08-24' }, { provider })

    expect(second.results).toEqual([
      { outcome: 'already_present', userId: user.id, weekOf: '2026-08-24' },
    ])
    expect(provider.send).toHaveBeenCalledTimes(1)
    expect(await getDb().select().from(digests)).toHaveLength(1)
  })

  it('skips a user with no new summaries in the window rather than sending an empty digest', async () => {
    const user = await seedUser('a@example.com')
    // Summary exists but falls outside the requested week's window.
    await seedSummary(user.id, {
      publishedAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-08-01T12:00:00Z'),
    })
    const provider = stubProvider()

    const result = await handleBuildDigest({ userId: user.id, weekOf: '2026-08-24' }, { provider })

    expect(result.results).toEqual([
      { outcome: 'no_new_summaries', userId: user.id, weekOf: '2026-08-24' },
    ])
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('builds a digest for every subscribed user when no userId is given', async () => {
    const userA = await seedUser('a@example.com')
    const userB = await seedUser('b@example.com')
    await seedSummary(userA.id, {
      publishedAt: new Date('2026-08-20T00:00:00Z'),
      createdAt: new Date('2026-08-20T12:00:00Z'),
    })
    await seedSummary(userB.id, {
      publishedAt: new Date('2026-08-21T00:00:00Z'),
      createdAt: new Date('2026-08-21T12:00:00Z'),
    })
    const provider = stubProvider()

    const result = await handleBuildDigest({ weekOf: '2026-08-24' }, { provider })

    expect(result.results.map((row) => row.outcome).sort()).toEqual(['sent', 'sent'])
    expect(provider.send).toHaveBeenCalledTimes(2)
  })

  it('treats a deleted user as done rather than retrying forever', async () => {
    const provider = stubProvider()

    const result = await handleBuildDigest(
      { userId: crypto.randomUUID(), weekOf: '2026-08-24' },
      { provider },
    )

    expect(result.results).toEqual([
      expect.objectContaining({ outcome: 'user_missing' }),
    ])
  })

  it('rejects a malformed payload', async () => {
    await expect(handleBuildDigest({ userId: 'not-a-uuid' }, {})).rejects.toThrow()
  })
})
