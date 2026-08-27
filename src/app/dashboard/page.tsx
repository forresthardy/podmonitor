import { redirect } from 'next/navigation'
import { InterestManager } from '@/components/interest-manager'
import { SignOutButton } from '@/components/sign-out-button'
import { getCurrentUser } from '@/lib/auth/current-user'
import { listInterests } from '@/lib/interests/service'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // The user id comes from the session, never from the request: this is the isolation boundary.
  const interests = await listInterests(user.id)

  return (
    <div className="stack">
      <h1>Podmonitor</h1>
      <p className="muted">Signed in as {user.email}</p>
      <InterestManager interests={interests} />
      <p className="muted">
        Feed polling, transcripts, summaries, and the weekly digest arrive in later PRs. The
        pipeline queues are already live; check <code>/api/health</code>.
      </p>
      <SignOutButton />
    </div>
  )
}
