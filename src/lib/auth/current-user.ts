import { readSessionToken } from './cookies'
import { AuthError } from './errors'
import { resolveSession, type AuthenticatedUser } from './service'

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  return resolveSession(await readSessionToken())
}

/**
 * The single gate every authenticated route goes through. Callers get a user id from
 * the session and never from request input — that is what makes per-user isolation hold.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser()
  if (!user) throw new AuthError('unauthenticated', 'Sign in to continue')
  return user
}
