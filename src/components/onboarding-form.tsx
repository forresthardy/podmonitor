'use client'

import { useState, type FormEvent } from 'react'
import type { SeedShow } from '@/lib/feeds/seed-shows'
import { useAsyncAction } from './hooks/use-async-action'

/**
 * First run: say what you want to learn about, and subscribe to the seed shows.
 *
 * Interests are collected as a list *before* anything is saved, because the first one
 * typed is rarely the only one and a one-at-a-time form makes the reader feel like they
 * are done after one. Nothing is submitted until they choose to finish, so a half-typed
 * interest never becomes a scoring signal.
 *
 * Subscribing to the four seed shows is stated rather than offered: v1 is scoped to those
 * feeds (spec §non-goals — no arbitrary feed adding yet), and hiding that would leave the
 * reader wondering where the episodes came from.
 */
export function OnboardingForm({
  seedShows,
  suggestions,
  onComplete,
}: {
  seedShows: SeedShow[]
  /** Example interests, shown as one-click starters. */
  suggestions: string[]
  onComplete: (interests: string[]) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const complete = useAsyncAction(onComplete, 'Could not finish setup, please try again')

  function addInterest(text: string) {
    const trimmed = text.trim()
    // Duplicates would double-count the same topic when scoring an episode.
    if (trimmed.length < 2 || interests.includes(trimmed)) return
    setInterests((current) => [...current, trimmed])
    setDraft('')
  }

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    addInterest(draft)
  }

  return (
    <div className="stack">
      <header className="stack">
        <h1>What do you want to learn about?</h1>
        <p className="muted">
          Episodes are scored against these topics. High scorers are summarized automatically;
          borderline ones wait for you in the review queue.
        </p>
      </header>

      <section className="card stack">
        <form className="stack" onSubmit={onAdd}>
          <div>
            <label htmlFor="onboarding-interest">Add an interest</label>
            <input
              id="onboarding-interest"
              name="interest"
              minLength={2}
              maxLength={200}
              placeholder="AI agents in production"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          <button type="submit" className="secondary" disabled={draft.trim().length < 2}>
            Add
          </button>
        </form>

        {interests.length === 0 ? (
          <p className="muted">
            No interests yet. Add at least one — without a topic there is nothing to score
            episodes against.
          </p>
        ) : (
          <ul className="plain topic-row">
            {interests.map((interest) => (
              <li key={interest} className="badge badge-neutral">
                {interest}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`Remove ${interest}`}
                  onClick={() => setInterests((current) => current.filter((i) => i !== interest))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {suggestions.length > 0 ? (
          <div className="stack">
            <p className="muted">Or start from an example:</p>
            <ul className="plain topic-row">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => addInterest(suggestion)}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="card stack">
        <h2>Shows you will be subscribed to</h2>
        <ul className="plain">
          {seedShows.map((show) => (
            <li key={show.feedUrl}>
              {show.title} <span className="muted">{show.feedUrl}</span>
            </li>
          ))}
        </ul>
        <p className="muted">These four feeds are what v1 monitors. Adding your own comes later.</p>
      </section>

      {complete.error ? <p className="error">{complete.error}</p> : null}
      <button
        type="button"
        disabled={interests.length === 0 || complete.pending}
        onClick={() => complete.run('complete', interests)}
      >
        {complete.pending ? 'Setting up...' : 'Start monitoring'}
      </button>
    </div>
  )
}
