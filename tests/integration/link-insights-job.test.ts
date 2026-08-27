import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/db/client'
import { episodes, insightLinks, insights, podcasts, summaries, users } from '@/db/schema'
import { createLocalEmbeddingProvider } from '@/lib/embeddings/local'
import { listSummaryCrossReferences } from '@/lib/knowledge/cross-references'
import { listUserSummaries } from '@/lib/knowledge/summary-service'
import type { LLMProvider } from '@/lib/llm/types'
import { handleLinkInsights } from '@/queue/handlers/link-insights'
import { resetDatabase } from '../helpers/db'

/**
 * The acceptance evidence from the spec: summarize two episodes with overlapping themes
 * and the second summary's insights link back to the first's with a visible callout.
 *
 * Real Postgres and real pgvector, with the embedding provider fixed to the deterministic
 * local adapter and the relation classifier stubbed — the vector search, the threshold, and
 * the callout join are what is under test here, not the LLM's taste.
 */

const MOAT_INSIGHT = {
  text: 'Distribution moats compound faster than product moats.',
  context: 'The hosts trace how early distribution deals outlasted every product advantage.',
  timestampSec: 1200,
}

/** Same idea, different wording: the case cross-referencing exists to catch. */
const MOAT_RESTATEMENT = {
  text: 'Distribution moats compound faster than any product moats can.',
  context: 'A later conversation returns to how distribution deals outlasted product advantage.',
  timestampSec: 300,
}

const UNRELATED_INSIGHT = {
  text: 'Morning sunlight regulates the circadian clock.',
  context: 'Light exposure within an hour of waking anchors the wake maintenance zone.',
  timestampSec: 60,
}

function relationProvider(relation = 'echoes'): LLMProvider {
  return {
    name: 'stub',
    model: 'stub-model',
    complete: vi.fn(async () => JSON.stringify({ links: [{ candidate: 1, relation }] })),
  }
}

const embeddingProvider = createLocalEmbeddingProvider()

async function seedUser(email: string): Promise<string> {
  const [user] = await getDb()
    .insert(users)
    .values({ email, passwordHash: 'not-a-real-hash' })
    .returning({ id: users.id })
  if (!user) throw new Error('failed to seed user')
  return user.id
}

async function seedEpisode(title: string, publishedAt: Date | null): Promise<string> {
  const db = getDb()
  const [podcast] = await db
    .insert(podcasts)
    .values({ feedUrl: `https://feeds.example.com/${crypto.randomUUID()}.xml`, title: 'Acquired' })
    .returning({ id: podcasts.id })
  if (!podcast) throw new Error('failed to seed podcast')

  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast.id,
      guid: crypto.randomUUID(),
      title,
      status: 'summarized',
      ...(publishedAt ? { publishedAt } : {}),
    })
    .returning({ id: episodes.id })
  if (!episode) throw new Error('failed to seed episode')
  return episode.id
}

async function seedSummary(
  userId: string,
  episodeId: string,
  keyInsights: { text: string; context: string; timestampSec: number | null }[],
): Promise<string> {
  const [summary] = await getDb()
    .insert(summaries)
    .values({
      episodeId,
      userId,
      tldr: 'One. Two. Three.',
      insights: keyInsights,
      quotes: [],
      topics: ['moats'],
      model: 'stub:stub-model',
    })
    .returning({ id: summaries.id })
  if (!summary) throw new Error('failed to seed summary')
  return summary.id
}

/** Links the whole knowledge base for one summary with the deterministic providers. */
async function link(episodeId: string, summaryId: string, llmProvider = relationProvider()) {
  return handleLinkInsights({ episodeId, summaryId }, { embeddingProvider, llmProvider })
}

beforeEach(async () => {
  await resetDatabase()
})

describe('handleLinkInsights', () => {
  it('links the second episode\u2019s insight back to the first with a rendered callout', async () => {
    const userId = await seedUser('reader@example.com')
    const firstEpisodeId = await seedEpisode('The Standard Oil Episode', new Date('2025-11-04T00:00:00Z'))
    const secondEpisodeId = await seedEpisode('Lenny on Moats', new Date('2026-02-10T00:00:00Z'))
    const firstSummaryId = await seedSummary(userId, firstEpisodeId, [MOAT_INSIGHT, UNRELATED_INSIGHT])
    const secondSummaryId = await seedSummary(userId, secondEpisodeId, [MOAT_RESTATEMENT])

    const first = await link(firstEpisodeId, firstSummaryId)
    expect(first).toMatchObject({ outcome: 'linked', insightsCreated: 2, linksCreated: 0 })

    const second = await link(secondEpisodeId, secondSummaryId)
    expect(second).toMatchObject({ outcome: 'linked', insightsCreated: 1, linksCreated: 1 })

    const storedLinks = await getDb().select().from(insightLinks)
    expect(storedLinks).toHaveLength(1)
    expect(storedLinks[0]?.relation).toBe('echoes')
    expect(storedLinks[0]?.score).toBeGreaterThan(0.55)

    const crossReferences = await listSummaryCrossReferences(secondSummaryId, userId)
    expect(crossReferences).toHaveLength(1)
    const [reference] = crossReferences
    expect(reference?.insightOrdinal).toBe(1)
    expect(reference?.related).toMatchObject({
      ordinal: 1,
      text: MOAT_INSIGHT.text,
      episodeTitle: 'The Standard Oil Episode',
      podcastTitle: 'Acquired',
      summaryId: firstSummaryId,
    })
    expect(reference?.callout).toBe(
      'This echoes insight #1 from \u201CThe Standard Oil Episode\u201D, Nov 2025',
    )

    // The read model the summary view consumes carries the same callout.
    const [latestSummary] = await listUserSummaries(userId)
    expect(latestSummary?.id).toBe(secondSummaryId)
    expect(latestSummary?.crossReferences[0]?.callout).toContain('echoes insight #1')
  })

  it('stores the relation the classifier chose', async () => {
    const userId = await seedUser('reader@example.com')
    const firstEpisodeId = await seedEpisode('The Standard Oil Episode', new Date('2025-11-04T00:00:00Z'))
    const secondEpisodeId = await seedEpisode('Lenny on Moats', null)
    const firstSummaryId = await seedSummary(userId, firstEpisodeId, [MOAT_INSIGHT])
    const secondSummaryId = await seedSummary(userId, secondEpisodeId, [MOAT_RESTATEMENT])

    await link(firstEpisodeId, firstSummaryId)
    await link(secondEpisodeId, secondSummaryId, relationProvider('contradicts'))

    const [stored] = await getDb().select().from(insightLinks)
    expect(stored?.relation).toBe('contradicts')

    const [reference] = await listSummaryCrossReferences(secondSummaryId, userId)
    expect(reference?.callout).toBe('This contradicts insight #1 from \u201CThe Standard Oil Episode\u201D, Nov 2025')
  })

  it('links nothing when no earlier insight clears the threshold', async () => {
    const userId = await seedUser('reader@example.com')
    const firstEpisodeId = await seedEpisode('Huberman on Light', new Date('2026-01-05T00:00:00Z'))
    const secondEpisodeId = await seedEpisode('Lenny on Moats', new Date('2026-02-10T00:00:00Z'))
    const firstSummaryId = await seedSummary(userId, firstEpisodeId, [UNRELATED_INSIGHT])
    const secondSummaryId = await seedSummary(userId, secondEpisodeId, [MOAT_RESTATEMENT])

    await link(firstEpisodeId, firstSummaryId)
    const llmProvider = relationProvider()
    const result = await handleLinkInsights(
      { episodeId: secondEpisodeId, summaryId: secondSummaryId },
      { embeddingProvider, llmProvider },
    )

    expect(result).toMatchObject({ outcome: 'linked', insightsCreated: 1, linksCreated: 0 })
    expect(await getDb().select().from(insightLinks)).toHaveLength(0)
    // Nothing to classify means the LLM is never called at all.
    expect(llmProvider.complete).not.toHaveBeenCalled()
  })

  it('never links across users, even on identical insights', async () => {
    const readerId = await seedUser('reader@example.com')
    const otherId = await seedUser('other@example.com')
    const firstEpisodeId = await seedEpisode('The Standard Oil Episode', new Date('2025-11-04T00:00:00Z'))
    const secondEpisodeId = await seedEpisode('Lenny on Moats', new Date('2026-02-10T00:00:00Z'))
    const readerSummaryId = await seedSummary(readerId, firstEpisodeId, [MOAT_INSIGHT])
    const otherSummaryId = await seedSummary(otherId, secondEpisodeId, [MOAT_INSIGHT])

    await link(firstEpisodeId, readerSummaryId)
    const result = await link(secondEpisodeId, otherSummaryId)

    expect(result.linksCreated).toBe(0)
    expect(await getDb().select().from(insightLinks)).toHaveLength(0)
    expect(await listSummaryCrossReferences(otherSummaryId, otherId)).toEqual([])
  })

  it('is idempotent: a redelivered job neither duplicates insights nor links', async () => {
    const userId = await seedUser('reader@example.com')
    const firstEpisodeId = await seedEpisode('The Standard Oil Episode', new Date('2025-11-04T00:00:00Z'))
    const secondEpisodeId = await seedEpisode('Lenny on Moats', new Date('2026-02-10T00:00:00Z'))
    const firstSummaryId = await seedSummary(userId, firstEpisodeId, [MOAT_INSIGHT])
    const secondSummaryId = await seedSummary(userId, secondEpisodeId, [MOAT_RESTATEMENT])

    await link(firstEpisodeId, firstSummaryId)
    await link(secondEpisodeId, secondSummaryId)
    const redelivered = await link(secondEpisodeId, secondSummaryId)

    expect(redelivered).toMatchObject({ outcome: 'already_linked', insightsCreated: 0, linksCreated: 0 })
    expect(await getDb().select().from(insights)).toHaveLength(2)
    expect(await getDb().select().from(insightLinks)).toHaveLength(1)
  })

  it('recovers a partial run by backfilling missing embeddings and links', async () => {
    const userId = await seedUser('reader@example.com')
    const firstEpisodeId = await seedEpisode('The Standard Oil Episode', new Date('2025-11-04T00:00:00Z'))
    const secondEpisodeId = await seedEpisode('Lenny on Moats', new Date('2026-02-10T00:00:00Z'))
    const firstSummaryId = await seedSummary(userId, firstEpisodeId, [MOAT_INSIGHT])
    const secondSummaryId = await seedSummary(userId, secondEpisodeId, [MOAT_RESTATEMENT])
    await link(firstEpisodeId, firstSummaryId)

    // Simulate a crash after the insight insert but before embedding and linking.
    const db = getDb()
    await db.insert(insights).values({
      userId,
      episodeId: secondEpisodeId,
      summaryId: secondSummaryId,
      ordinal: 1,
      text: MOAT_RESTATEMENT.text,
      context: MOAT_RESTATEMENT.context,
      timestampSec: MOAT_RESTATEMENT.timestampSec,
    })

    const result = await link(secondEpisodeId, secondSummaryId)

    expect(result).toMatchObject({ outcome: 'linked', insightsCreated: 0, linksCreated: 1 })
    const [recovered] = await db.select().from(insights).where(eq(insights.summaryId, secondSummaryId))
    expect(recovered?.embedding).not.toBeNull()
  })

  it('treats a deleted summary as done rather than retrying forever', async () => {
    const result = await handleLinkInsights(
      { episodeId: crypto.randomUUID(), summaryId: crypto.randomUUID() },
      { embeddingProvider, llmProvider: relationProvider() },
    )
    expect(result.outcome).toBe('summary_missing')
  })

  it('rejects a malformed payload', async () => {
    await expect(
      handleLinkInsights({ episodeId: 'not-a-uuid', summaryId: 'nope' }, { embeddingProvider }),
    ).rejects.toThrow()
  })
})
