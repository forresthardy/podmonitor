'use client'

import { useRouter } from 'next/navigation'
import { OnboardingForm } from '@/components/onboarding-form'
import type { SeedShow } from '@/lib/feeds/seed-shows'
import { postJson } from '@/lib/http-client'

/**
 * The connector layer: components stay presentational and these thin clients own the fetch
 * and the navigation. Errors are not caught here on purpose — `useAsyncAction` inside each
 * component turns a rejection into visible text, and swallowing it here would hide it.
 */
export function OnboardingPanel({
  seedShows,
  suggestions,
}: {
  seedShows: SeedShow[]
  suggestions: string[]
}) {
  const router = useRouter()

  return (
    <OnboardingForm
      seedShows={seedShows}
      suggestions={suggestions}
      onComplete={async (interests) => {
        await postJson('/api/onboarding', { interests })
        router.push('/episodes')
      }}
    />
  )
}
