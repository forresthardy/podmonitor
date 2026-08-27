import { cookies } from 'next/headers'
import { isProduction } from '@/lib/env'
import type { IssuedSession } from './service'

export const SESSION_COOKIE = 'pm_session'

export async function readSessionToken(): Promise<string | undefined> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value
}

export async function setSessionCookie(session: IssuedSession): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    expires: session.expiresAt,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
