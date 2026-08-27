import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/db/client'
import { episodes, podcasts } from '@/db/schema'
import { FakeCookieStore } from '../helpers/cookie-store'
import { resetDatabase } from '../helpers/db'

// One browser per store; the mock lets each request run as a chosen user.
const { activeStore } = vi.hoisted(() => ({
  activeStore: { current: undefined as unknown },
}))

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(activeStore.current),
}))

const { POST: register } = await import('@/app/api/auth/register/route')
const { POST: createInterestRoute, GET: listInterestsRoute } = await import(
  '@/app/api/interests/route'
)
const { GET: reviewQueueRoute } = await import('@/app/api/review-queue/route')
const { POST: confirmRoute } = await import('@/app/api/review-queue/[matchId]/confirm/route')
const { POST: dismissRoute } = await import('@/app/api/review-queue/[matchId]/dismiss/route')
const { matchEpisodeForAllUsers } = await import('@/lib/interest-matching/match-service')

// Overlaps just enough with the interest below to land in the review band, not auto-queued
// or skipped — see tests/unit/interest-scoring.test.ts for the scoring math this relies on.
const AMBIGUOUS_INTEREST_TEXT = 'artificial intelligence agents in production systems'
const AMBIGUOUS_EPISODE = {
  title: 'Weekly roundup on artificial intelligence agents',
  description: 'A brief mention of artificial intelligence trends this week.',
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function postTo(matchId: string) {
  return { params: Promise.resolve({ matchId }) }
}

/** Runs a handler as the browser holding `store`. */
async function as<T>(store: FakeCookieStore, handler: () => Promise<T>): Promise<T> {
  activeStore.current = store
  return handler()
}

async function signUp(email: string): Promise<FakeCookieStore> {
  const store = new FakeCookieStore()
  const response = await as(store, () =>
    register(jsonRequest({ email, password: 'a-strong-passphrase' })),
  )
  expect(response.status).toBe(201)
  return store
}

/** Inserts a podcast + episode directly (bypassing feed ingestion, which isn't under test here). */
async function seedEpisode(title: string, description: string): Promise<string> {
  const db = getDb()
  const [podcast] = await db
    .insert(podcasts)
    .values({ feedUrl: `https://example.com/${crypto.randomUUID()}`, title: 'Test Podcast' })
    .returning({ id: podcasts.id })
  const [episode] = await db
    .insert(episodes)
    .values({
      podcastId: podcast!.id,
      guid: crypto.randomUUID(),
      title,
      description,
    })
    .returning({ id: episodes.id })
  return episode!.id
}

async function getInterestWeight(store: FakeCookieStore, text: string): Promise<number> {
  const body = await (await as(store, () => listInterestsRoute())).json()
  const interest = body.interests.find((i: { text: string }) => i.text === text)
  expect(interest, `expected an interest with text "${text}"`).toBeDefined()
  return interest.weight
}

beforeEach(async () => {
  await resetDatabase()
  activeStore.current = new FakeCookieStore()
})

describe('review queue: confirm/dismiss', () => {
  it('surfaces a borderline match only to the user it belongs to', async () => {
    const owner = await signUp('owner@example.com')
    const other = await signUp('other@example.com')
    await as(owner, () => createInterestRoute(jsonRequest({ text: AMBIGUOUS_INTEREST_TEXT })))

    const episodeId = await seedEpisode(AMBIGUOUS_EPISODE.title, AMBIGUOUS_EPISODE.description)
    await matchEpisodeForAllUsers(episodeId)

    const ownerQueue = await (await as(owner, () => reviewQueueRoute())).json()
    expect(ownerQueue.items).toHaveLength(1)
    expect(ownerQueue.items[0].episodeTitle).toBe(AMBIGUOUS_EPISODE.title)

    // `other` has no interests at all, so the match was never scored for them.
    const otherQueue = await (await as(other, () => reviewQueueRoute())).json()
    expect(otherQueue.items).toHaveLength(0)
  })

  it('confirming queues the episode, reinforces the interest, and clears the queue', async () => {
    const owner = await signUp('owner@example.com')
    await as(owner, () => createInterestRoute(jsonRequest({ text: AMBIGUOUS_INTEREST_TEXT })))
    const weightBefore = await getInterestWeight(owner, AMBIGUOUS_INTEREST_TEXT)

    const episodeId = await seedEpisode(AMBIGUOUS_EPISODE.title, AMBIGUOUS_EPISODE.description)
    await matchEpisodeForAllUsers(episodeId)
    const { items } = await (await as(owner, () => reviewQueueRoute())).json()
    const matchId = items[0].matchId

    const confirmed = await as(owner, () => confirmRoute(new Request('http://localhost'), postTo(matchId)))
    expect(confirmed.status).toBe(200)
    const confirmedBody = await confirmed.json()
    expect(confirmedBody.match.decision).toBe('confirmed')
    expect(confirmedBody.match.reviewedAt).toBeTruthy()

    const weightAfter = await getInterestWeight(owner, AMBIGUOUS_INTEREST_TEXT)
    expect(weightAfter).toBeGreaterThan(weightBefore)

    const queueAfter = await (await as(owner, () => reviewQueueRoute())).json()
    expect(queueAfter.items).toHaveLength(0)
  })

  it('dismissing drops the episode and discourages the interest', async () => {
    const owner = await signUp('owner@example.com')
    await as(owner, () => createInterestRoute(jsonRequest({ text: AMBIGUOUS_INTEREST_TEXT })))
    const weightBefore = await getInterestWeight(owner, AMBIGUOUS_INTEREST_TEXT)

    const episodeId = await seedEpisode(AMBIGUOUS_EPISODE.title, AMBIGUOUS_EPISODE.description)
    await matchEpisodeForAllUsers(episodeId)
    const { items } = await (await as(owner, () => reviewQueueRoute())).json()
    const matchId = items[0].matchId

    const dismissed = await as(owner, () => dismissRoute(new Request('http://localhost'), postTo(matchId)))
    expect(dismissed.status).toBe(200)
    expect((await dismissed.json()).match.decision).toBe('dismissed')

    const weightAfter = await getInterestWeight(owner, AMBIGUOUS_INTEREST_TEXT)
    expect(weightAfter).toBeLessThan(weightBefore)

    const queueAfter = await (await as(owner, () => reviewQueueRoute())).json()
    expect(queueAfter.items).toHaveLength(0)
  })

  it('rejects confirming a match that belongs to another user', async () => {
    const owner = await signUp('owner@example.com')
    const attacker = await signUp('attacker@example.com')
    await as(owner, () => createInterestRoute(jsonRequest({ text: AMBIGUOUS_INTEREST_TEXT })))

    const episodeId = await seedEpisode(AMBIGUOUS_EPISODE.title, AMBIGUOUS_EPISODE.description)
    await matchEpisodeForAllUsers(episodeId)
    const { items } = await (await as(owner, () => reviewQueueRoute())).json()
    const matchId = items[0].matchId

    const response = await as(attacker, () =>
      confirmRoute(new Request('http://localhost'), postTo(matchId)),
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'not_found' } })

    // Untouched: the attacker's attempt did not resolve the owner's item.
    const ownerQueue = await (await as(owner, () => reviewQueueRoute())).json()
    expect(ownerQueue.items).toHaveLength(1)
  })

  it('rejects resolving an already-resolved match a second time', async () => {
    const owner = await signUp('owner@example.com')
    await as(owner, () => createInterestRoute(jsonRequest({ text: AMBIGUOUS_INTEREST_TEXT })))

    const episodeId = await seedEpisode(AMBIGUOUS_EPISODE.title, AMBIGUOUS_EPISODE.description)
    await matchEpisodeForAllUsers(episodeId)
    const { items } = await (await as(owner, () => reviewQueueRoute())).json()
    const matchId = items[0].matchId

    await as(owner, () => confirmRoute(new Request('http://localhost'), postTo(matchId)))
    const secondAttempt = await as(owner, () =>
      dismissRoute(new Request('http://localhost'), postTo(matchId)),
    )
    expect(secondAttempt.status).toBe(404)
  })

  it('requires authentication to read or resolve the review queue', async () => {
    const anonymous = new FakeCookieStore()
    expect((await as(anonymous, () => reviewQueueRoute())).status).toBe(401)
    expect(
      (
        await as(anonymous, () =>
          confirmRoute(new Request('http://localhost'), postTo(crypto.randomUUID())),
        )
      ).status,
    ).toBe(401)
  })

  it('is idempotent: rerunning the match job never duplicates or overwrites a decision', async () => {
    const owner = await signUp('owner@example.com')
    await as(owner, () => createInterestRoute(jsonRequest({ text: AMBIGUOUS_INTEREST_TEXT })))

    const episodeId = await seedEpisode(AMBIGUOUS_EPISODE.title, AMBIGUOUS_EPISODE.description)
    await matchEpisodeForAllUsers(episodeId)
    const { items } = await (await as(owner, () => reviewQueueRoute())).json()
    await as(owner, () => confirmRoute(new Request('http://localhost'), postTo(items[0].matchId)))

    // A retried/duplicate job for the same episode must not resurrect the confirmed match.
    await matchEpisodeForAllUsers(episodeId)
    const queueAfter = await (await as(owner, () => reviewQueueRoute())).json()
    expect(queueAfter.items).toHaveLength(0)

    const [match] = await getDb().select().from(episodes).where(eq(episodes.id, episodeId))
    expect(match).toBeDefined()
  })
})
