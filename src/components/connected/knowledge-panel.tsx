'use client'

import { KnowledgeExplorer } from '@/components/knowledge-explorer'
import { getJson } from '@/lib/http-client'
import type { InsightSearchResponse, InsightSearchResult } from '@/lib/knowledge/search-view'

export function KnowledgePanel({ browseResults }: { browseResults: InsightSearchResult[] }) {
  return (
    <KnowledgeExplorer
      browseResults={browseResults}
      onSearch={async (query) => {
        const response = await getJson<InsightSearchResponse>(
          `/api/insights?q=${encodeURIComponent(query)}`,
        )
        return response.results
      }}
    />
  )
}
