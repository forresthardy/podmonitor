import { redirect } from 'next/navigation'
import { OnboardingPanel } from '@/components/connected/onboarding-panel'
import { getCurrentUser } from '@/lib/auth/current-user'
import { SEED_SHOWS } from '@/lib/feeds/seed-shows'
import { hasCompletedOnboarding } from '@/lib/onboarding/service'

export const dynamic = 'force-dynamic'

/**
 * Starter interests, not a taxonomy: concrete enough to be clickable, and drawn from the
 * subject matter of the four seed shows so a one-click start actually matches episodes.
 */
const SUGGESTIONS = [
  'AI agents in production',
  'pricing power and moats',
  'sleep and circadian rhythm',
  'founder-led sales',
  'capital allocation',
  'developer tooling',
]

export default async function OnboardingPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Re-running setup would silently add nothing; sending the reader to the library is the
  // honest answer to "I already did this".
  if (await hasCompletedOnboarding(user.id)) redirect('/episodes')

  return <OnboardingPanel seedShows={SEED_SHOWS} suggestions={SUGGESTIONS} />
}
