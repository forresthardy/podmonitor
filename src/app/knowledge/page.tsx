import { redirect } from 'next/navigation'
import { AppNav } from '@/components/app-nav'
import { KnowledgePanel } from '@/components/connected/knowledge-panel'
import { getCurrentUser } from '@/lib/auth/current-user'
import { browseInsights } from '@/lib/knowledge/search-service'

export const dynamic = 'force-dynamic'

export default async function KnowledgePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Rendered server-side so the knowledge base has content on first paint; searching from
  // there is a client fetch against the same user-scoped endpoint.
  const browseResults = await browseInsights(user.id)

  return (
    <div className="stack">
      <AppNav email={user.email} />
      <KnowledgePanel browseResults={browseResults} />
    </div>
  )
}
