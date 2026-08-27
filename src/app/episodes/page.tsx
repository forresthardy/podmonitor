import { redirect } from 'next/navigation'
import { AppNav } from '@/components/app-nav'
import { EpisodeLibraryPanel } from '@/components/connected/episode-library-panel'
import { getCurrentUser } from '@/lib/auth/current-user'
import { listEpisodeLibrary } from '@/lib/episodes/library-service'
import { hasCompletedOnboarding } from '@/lib/onboarding/service'

export const dynamic = 'force-dynamic'

export default async function EpisodesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // An empty library and "you have not told us what you care about yet" look identical on
  // screen but need different actions, so the second case goes to onboarding instead.
  if (!(await hasCompletedOnboarding(user.id))) redirect('/onboarding')

  // The user id comes from the session, never from the request: this is the isolation boundary.
  const episodes = await listEpisodeLibrary(user.id)

  return (
    <div className="stack">
      <AppNav email={user.email} />
      <EpisodeLibraryPanel episodes={episodes} />
    </div>
  )
}
