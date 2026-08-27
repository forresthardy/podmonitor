'use client'

import { useRouter } from 'next/navigation'
import { EpisodeLibrary } from '@/components/episode-library'
import type { EpisodeLibraryItem } from '@/lib/episodes/types'
import { postJson } from '@/lib/http-client'

export function EpisodeLibraryPanel({ episodes }: { episodes: EpisodeLibraryItem[] }) {
  const router = useRouter()

  return (
    <EpisodeLibrary
      episodes={episodes}
      onRetry={async (episodeId) => {
        await postJson(`/api/episodes/${episodeId}/retry`)
        // Refresh rather than patch local state: the badge should show what the pipeline
        // now says, and the server component already knows how to render that.
        router.refresh()
      }}
    />
  )
}
