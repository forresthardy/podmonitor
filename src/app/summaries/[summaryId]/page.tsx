import { notFound, redirect } from 'next/navigation'
import { AppNav } from '@/components/app-nav'
import { SummaryReader } from '@/components/summary-reader'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserSummary } from '@/lib/knowledge/summary-service'
import { toSummaryView } from '@/lib/knowledge/summary-view'

export const dynamic = 'force-dynamic'

export default async function SummaryPage({
  params,
}: {
  params: Promise<{ summaryId: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const { summaryId } = await params
  const summary = await getUserSummary(user.id, summaryId)

  // Another reader's summary id is a 404, not a 403: the two answers are indistinguishable
  // from outside, so the page cannot be used to learn which summary ids exist.
  if (!summary) notFound()

  return (
    <div className="stack">
      <AppNav email={user.email} />
      <SummaryReader summary={toSummaryView(summary)} />
    </div>
  )
}
