import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/db/client'
import {
  digests,
  episodeInterestMatches,
  episodes,
  insights,
  podcasts,
  summaries,
} from '@/db/schema'
import { getUserSummary } from '@/lib/knowledge/summary-service'
import { FakeCookieStore } from '../helpers/cookie-store'
import { resetDatabase } from '../helpers/db'

/**
 * Isolation across the web app's own surfaces: library, knowledge base, settings, and the
 * two write actions (retry, remove interest).
 *
 * Two accounts are given deliberately *symmetric* data — same podcast, one episode each,
 * one summary each, one insight each, one digest each — so a leak shows up as an extra row
 * rather than as an empty result that a broken query could also produce. A test where the
 * second user has no data at all would pass even if every query ignored `userId`.
 */

const { activeStore } = vi.hoisted(() => ({ activeStore: { current: undefined as unknown } }))

vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(activeStore.current) }))

const { POST: register } = await import('@/app/api/auth/register/route')
const { GET: me } = await import('@/app/api/auth/me/route')
const { GET: listEpisodes } = await import('@/app/api/episodes/route')
const { POST: retryEpisode } = await import('@/app/api/episodes/[episodeId]/retry/route')
const { GET: listInsights } = await import('@/app/api/insights/route')
const { GET: getSettings, PATCH: patchSettings } = await import('@/app/api/settings/route')
const { POST: createInterest } = await import('@/app/api/interests/route')
const { DELETE: deleteInterest } = await import('@/app/api/interests/[interestId]/route')

function jsonRequest(body: unknown, method = 'POST'): Request {
  return new Request('http://localhost/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function as<T>(store: FakeCookieStore, handler: () => Promise<T>): Promise<T> {
  activeStore.current = store
  return handler()
}

interface Account {
  store: FakeCookieStore
  userId: string
  episodeId: string
  summaryId: string
  insightId: string
  interestId: string
}

/** Registers an account and gives it one episode, summary, insight, digest and interest. */
async function seedAccount(email: string, podcastId: string, label: string): Promise<Account> {
  const store = new FakeCookieStore()
  const registered = await as(store, () =>
    register(jsonRequest({ email, password: 'a-strong-passphrase' })),
  )
  expect(registered.status).toBe(201)

  const userId: string = (await (await as(store, () => me())).json()).user.id
  const db = getDb()

  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId,
      guid: `guid-${label}`,
      title: `${label} episode`,
      status: 'failed',
      failureReason: `${label} transcript fetch failed`,
      publishedAt: new Date('2026-08-20T00:00:00Z'),
    })
    .returning()
  if (!episode) throw new Error('episode insert returned no row')

  await db.insert(episodeInterestMatches).values({
    episodeId: episode.id,
    userId,
    score: 0.9,
    signal: 'transcript',
    decision: 'auto_queued',
  })

  const [summary] = await db
    .insert(summaries)
    .values({
      episodeId: episode.id,
      userId,
      tldr: `${label} tldr`,
      insights: [{ text: `${label} insight`, context: `${label} context`, timestampSec: 42 }],
      quotes: [{ quote: `${label} quote`, speaker: 'Host', timestampSec: 42 }],
      topics: [label],
      model: 'test-model',
    })
    .returning()
  if (!summary) throw new Error('summary insert returned no row')

  const [insight] = await db
    .insert(insights)
    .values({
      userId,
      episodeId: episode.id,
      summaryId: summary.id,
      ordinal: 1,
      text: `${label} insight`,
      context: `${label} context`,
      timestampSec: 42,
    })
    .returning()
  if (!insight) throw new Error('insight insert returned no row')

  await db.insert(digests).values({
    userId,
    weekOf: '2026-08-17',
    episodeIds: [episode.id],
    sentAt: new Date('2026-08-17T09:00:00Z'),
  })

  const created = await as(store, () => createInterest(jsonRequest({ text: `${label} interest` })))
  expect(created.status).toBe(201)
  const interestId: string = (await created.json()).interest.id

  return {
    store,
    userId,
    episodeId: episode.id,
    summaryId: summary.id,
    insightId: insight.id,
    interestId,
  }
}

let first: Account
let second: Account

beforeEach(async () => {
  await resetDatabase()
  activeStore.current = new FakeCookieStore()

  const [podcast] = await getDb()
    .insert(podcasts)
    .values({ feedUrl: 'https://example.com/feed.xml', title: 'Shared Show' })
    .returning()
  if (!podcast) throw new Error('podcast insert returned no row')

  // One shared podcast on purpose: isolation must come from the per-user match, summary and
  // insight rows, not from the two readers happening to follow different shows.
  first = await seedAccount('first@example.com', podcast.id, 'first')
  second = await seedAccount('second@example.com', podcast.id, 'second')
})

describe('episode library isolation', () => {
  it('shows each reader only the episodes matched for them', async () => {
    const body = await (await as(first.store, () => listEpisodes())).json()

    expect(body.episodes).toHaveLength(1)
    expect(body.episodes[0].episodeId).toBe(first.episodeId)
    expect(body.episodes[0].summaryId).toBe(first.summaryId)
    expect(body.episodes[0].title).toBe('first episode')
  })

  it('refuses to retry an episode matched for another reader', async () => {
    const response = await as(first.store, () =>
      retryEpisode(jsonRequest({}), { params: Promise.resolve({ episodeId: second.episodeId }) }),
    )

    // 404, not 403: the two answers are indistinguishable, so this cannot probe for ids.
    expect(response.status).toBe(404)

    // And the other reader's episode is untouched — still failed, not reset to discovered.
    const secondLibrary = await (await as(second.store, () => listEpisodes())).json()
    expect(secondLibrary.episodes[0].status).toBe('failed')
  })
})

describe('knowledge base isolation', () => {
  it('browses only the reader’s own insights', async () => {
    const firstBody = await (
      await as(first.store, () => listInsights(new Request('http://localhost/api/insights')))
    ).json()
    const secondBody = await (
      await as(second.store, () => listInsights(new Request('http://localhost/api/insights')))
    ).json()

    expect(firstBody.results.map((r: { insightId: string }) => r.insightId)).toEqual([
      first.insightId,
    ])
    expect(secondBody.results.map((r: { insightId: string }) => r.insightId)).toEqual([
      second.insightId,
    ])
  })
})

describe('summary isolation', () => {
  it('returns nothing for another reader’s summary id', async () => {
    await expect(getUserSummary(first.userId, second.summaryId)).resolves.toBeNull()
    await expect(getUserSummary(first.userId, first.summaryId)).resolves.toMatchObject({
      tldr: 'first tldr',
    })
  })
})

describe('settings isolation', () => {
  it('shows each reader only their own interests and digests', async () => {
    const firstBody = await (await as(first.store, () => getSettings())).json()
    const secondBody = await (await as(second.store, () => getSettings())).json()

    expect(firstBody.settings.interests.map((i: { text: string }) => i.text)).toEqual([
      'first interest',
    ])
    expect(secondBody.settings.interests.map((i: { text: string }) => i.text)).toEqual([
      'second interest',
    ])
    // Both readers have a digest for the same week covering their own episode, so a leak
    // would show as two digests here rather than as a wrong week.
    expect(firstBody.settings.recentDigests).toHaveLength(1)
    expect(secondBody.settings.recentDigests).toHaveLength(1)
    expect(firstBody.settings.recentDigests[0].episodeCount).toBe(1)
    expect(firstBody.settings.recentDigests[0].id).not.toBe(
      secondBody.settings.recentDigests[0].id,
    )
    expect(firstBody.settings.email).toBe('first@example.com')
  })

  it('refuses to remove another reader’s interest', async () => {
    const response = await as(first.store, () =>
      deleteInterest(jsonRequest({}, 'DELETE'), {
        params: Promise.resolve({ interestId: second.interestId }),
      }),
    )

    expect(response.status).toBe(404)

    const secondBody = await (await as(second.store, () => getSettings())).json()
    expect(secondBody.settings.interests).toHaveLength(1)
  })

  it('keeps a digest preference change on the reader who made it', async () => {
    const patched = await as(first.store, () =>
      patchSettings(jsonRequest({ weeklyDigestOptIn: false }, 'PATCH')),
    )
    expect(patched.status).toBe(200)
    await expect(patched.json()).resolves.toMatchObject({
      settings: { weeklyDigestOptIn: false },
    })

    const secondBody = await (await as(second.store, () => getSettings())).json()
    expect(secondBody.settings.weeklyDigestOptIn).toBe(true)
  })
})
