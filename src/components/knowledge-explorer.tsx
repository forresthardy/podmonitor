'use client'

import { useState, type FormEvent } from 'react'
import type { InsightSearchResult } from '@/lib/knowledge/search-view'
import { useAsyncAction } from './hooks/use-async-action'
import { InsightResultCard } from './insight-result-card'

/**
 * Search and browse the knowledge base.
 *
 * Opens in browse mode with the most recent insights already rendered from props — an
 * empty search box in front of an empty page tells the reader nothing about what is in
 * there. Searching replaces the list; clearing the box restores the browse feed, so
 * "search" never becomes a trap the reader has to reload out of.
 *
 * The query runs through the injected `onSearch`, never a fetch in this component: that
 * keeps the results path testable and the transport in one place.
 */
export function KnowledgeExplorer({
  browseResults,
  onSearch,
}: {
  /** Recent insights, shown until the reader searches for something. */
  browseResults: InsightSearchResult[]
  onSearch: (query: string) => Promise<InsightSearchResult[]>
}) {
  const [draft, setDraft] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [results, setResults] = useState<InsightSearchResult[] | null>(null)

  const search = useAsyncAction(async (query: string) => {
    const found = await onSearch(query)
    setResults(found)
    setActiveQuery(query)
  }, 'Search failed, please try again')

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = draft.trim()
    if (query.length === 0) {
      // Empty query is "show me everything again", not a search for nothing.
      setResults(null)
      setActiveQuery('')
      return
    }
    void search.run('search', query)
  }

  const searching = results !== null
  const shown = results ?? browseResults

  return (
    <div className="stack">
      <header className="stack">
        <h1>Knowledge base</h1>
        <p className="muted">
          Every insight from every summary you have read, searchable by what it says — not by
          which episode it came from.
        </p>
      </header>

      <form className="card stack" onSubmit={onSubmit}>
        <div>
          <label htmlFor="kb-search">Search insights</label>
          <input
            id="kb-search"
            name="q"
            type="search"
            placeholder="pricing power"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <button type="submit" disabled={search.pending}>
          {search.pending ? 'Searching...' : 'Search'}
        </button>
        {search.error ? <p className="error">{search.error}</p> : null}
      </form>

      <p className="muted" data-testid="kb-result-summary">
        {searching
          ? `${shown.length} ${shown.length === 1 ? 'insight' : 'insights'} matching “${activeQuery}”`
          : `Browsing ${shown.length} recent ${shown.length === 1 ? 'insight' : 'insights'}`}
      </p>

      {shown.length === 0 ? (
        <p className="muted">
          {searching
            ? 'Nothing matches that yet. Try a broader phrase — the knowledge base only holds insights from episodes already summarized.'
            : 'Your knowledge base is empty. It fills up as episodes are summarized.'}
        </p>
      ) : (
        <div className="stack">
          {shown.map((result) => (
            <InsightResultCard key={result.insightId} result={result} />
          ))}
        </div>
      )}
    </div>
  )
}
