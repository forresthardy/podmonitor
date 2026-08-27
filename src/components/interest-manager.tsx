'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { Interest } from '@/db/schema'

interface ApiError {
  error?: { message?: string }
}

/**
 * Interests are rendered from server-fetched data; this component owns only the
 * create-and-refresh interaction, including its empty and error states.
 */
export function InterestManager({ interests }: { interests: Interest[] }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/interests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      if (!response.ok) {
        const body: ApiError = await response.json().catch(() => ({}))
        setError(body.error?.message ?? 'Could not save that interest')
        return
      }

      setText('')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card stack">
      <h2>Your interests</h2>
      {interests.length === 0 ? (
        <p className="muted">
          Nothing yet. Add a topic and episode selection will start scoring against it.
        </p>
      ) : (
        <ul className="plain">
          {interests.map((interest) => (
            <li key={interest.id}>
              {interest.text} <span className="muted">weight {interest.weight}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={onSubmit}>
        <div>
          <label htmlFor="interest">Add an interest</label>
          <input
            id="interest"
            name="interest"
            required
            minLength={2}
            maxLength={200}
            placeholder="AI agents in production"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Add interest'}
        </button>
      </form>
    </section>
  )
}
