import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const { POST: login } = await import('@/app/api/auth/login/route')
const { POST: logout } = await import('@/app/api/auth/logout/route')
const { GET: me } = await import('@/app/api/auth/me/route')
const { GET: listInterestsRoute, POST: createInterestRoute } = await import(
  '@/app/api/interests/route'
)

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
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

beforeEach(async () => {
  await resetDatabase()
  activeStore.current = new FakeCookieStore()
})

describe('session cookie lifecycle', () => {
  it('sets a session on register, identifies the user, and clears it on logout', async () => {
    const store = await signUp('first@example.com')
    expect(store.get('pm_session')?.value).toBeTruthy()

    const identified = await as(store, () => me())
    expect(identified.status).toBe(200)
    await expect(identified.json()).resolves.toMatchObject({
      user: { email: 'first@example.com' },
    })

    const loggedOut = await as(store, () => logout())
    expect(loggedOut.status).toBe(200)
    expect(store.get('pm_session')).toBeUndefined()

    const afterLogout = await as(store, () => me())
    expect(afterLogout.status).toBe(401)
  })

  it('rejects unauthenticated access to user data', async () => {
    const anonymous = new FakeCookieStore()
    const response = await as(anonymous, () => listInterestsRoute())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthenticated' },
    })
  })

  it('rejects a forged session cookie', async () => {
    await signUp('first@example.com')
    const forged = new FakeCookieStore()
    forged.set('pm_session', 'x'.repeat(43))

    expect((await as(forged, () => me())).status).toBe(401)
  })

  it('re-issues a session on login', async () => {
    const store = await signUp('first@example.com')
    const registered = store.get('pm_session')?.value

    const response = await as(store, () =>
      login(jsonRequest({ email: 'first@example.com', password: 'a-strong-passphrase' })),
    )

    expect(response.status).toBe(200)
    expect(store.get('pm_session')?.value).not.toBe(registered)
    expect((await as(store, () => me())).status).toBe(200)
  })
})

describe('per-user data isolation', () => {
  it('never shows one user the interests of another', async () => {
    const first = await signUp('first@example.com')
    const second = await signUp('second@example.com')

    await as(first, () => createInterestRoute(jsonRequest({ text: 'AI agents in production' })))
    await as(second, () => createInterestRoute(jsonRequest({ text: 'Bond market plumbing' })))

    const firstBody = await (await as(first, () => listInterestsRoute())).json()
    const secondBody = await (await as(second, () => listInterestsRoute())).json()

    expect(firstBody.interests.map((i: { text: string }) => i.text)).toEqual([
      'AI agents in production',
    ])
    expect(secondBody.interests.map((i: { text: string }) => i.text)).toEqual([
      'Bond market plumbing',
    ])
    expect(firstBody.interests[0].userId).not.toBe(secondBody.interests[0].userId)
  })

  it('scopes writes to the session user, ignoring any user id in the payload', async () => {
    const first = await signUp('first@example.com')
    const second = await signUp('second@example.com')

    const secondId = (await (await as(second, () => me())).json()).user.id
    // A client-supplied userId must have no effect: the row belongs to the session user.
    await as(first, () =>
      createInterestRoute(jsonRequest({ text: 'Injected ownership', userId: secondId })),
    )

    const secondBody = await (await as(second, () => listInterestsRoute())).json()
    expect(secondBody.interests).toHaveLength(0)

    const firstBody = await (await as(first, () => listInterestsRoute())).json()
    expect(firstBody.interests).toHaveLength(1)
    expect(firstBody.interests[0].userId).not.toBe(secondId)
  })
})
