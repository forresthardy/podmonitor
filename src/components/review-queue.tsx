'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ReviewQueueItem } from '@/lib/interest-matching/match-service'

interface ApiError {
  error?: { message?: string }
}

/**
 * Borderline episodes (cheap + transcript scoring landed between the review and
 * auto-queue thresholds) wait here until the user confirms or dismisses them. Either
 * action tunes the matched interest's weight for future scoring - see `match-service.ts`.
 */
export function ReviewQueue({ items }: { items: ReviewQueueItem[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resolve(matchId: string, action: 'confirm' | 'dismiss') {
    setPendingId(matchId)
    setError(null)

    try {
      const response = await fetch(`/api/review-queue/${matchId}/${action}`, { method: 'POST' })
      if (!response.ok) {
        const body: ApiError = await response.json().catch(() => ({}))
        setError(body.error?.message ?? `Could not ${action} that episode`)
        return
      }
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Network error')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className="card stack">
      <h2>Review queue</h2>
      {items.length === 0 ? (
        <p className="muted">
          Nothing borderline right now - episodes that clearly match or miss your interests skip
          this queue entirely.
        </p>
      ) : (
        <ul className="plain stack">
          {items.map((item) => (
            <li key={item.matchId} className="stack">
              <strong>{item.episodeTitle}</strong>
              <span className="muted">match score {item.score.toFixed(2)}</span>
              <div>
                <button
                  type="button"
                  disabled={pendingId === item.matchId}
                  onClick={() => resolve(item.matchId, 'confirm')}
                >
                  Confirm
                </button>{' '}
                <button
                  type="button"
                  disabled={pendingId === item.matchId}
                  onClick={() => resolve(item.matchId, 'dismiss')}
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="error">{error}</p> : null}
    </section>
  )
}
