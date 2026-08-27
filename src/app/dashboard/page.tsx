import { redirect } from 'next/navigation'
import { InterestManager } from '@/components/interest-manager'
import { ReviewQueue } from '@/components/review-queue'
import { SignOutButton } from '@/components/sign-out-button'
import { getCurrentUser } from '@/lib/auth/current-user'
import { listReviewQueue } from '@/lib/interest-matching/match-service'
import { listInterests } from '@/lib/interests/service'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // The user id comes from the session, never from the request: this is the isolation boundary.
  const [interests, reviewItems] = await Promise.all([
    listInterests(user.id),
    listReviewQueue(user.id),
  ])

  return (
    <div className="stack">
      <h1>Podmonitor</h1>
      <p className="muted">Signed in as {user.email}</p>
      <InterestManager interests={interests} />
      <ReviewQueue items={reviewItems} />
      <p className="muted">
        Transcripts, summaries, and the weekly digest arrive in later PRs. New episodes are
        already being scored against your interests; check <code>/api/health</code>.
      </p>
      <SignOutButton />
    </div>
  )
}
