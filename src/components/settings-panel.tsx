'use client'

import { useState, type FormEvent } from 'react'
import type { SettingsView } from '@/lib/settings/types'
import { useAsyncAction } from './hooks/use-async-action'

/**
 * Settings: the two things a reader actually wants to change — what they care about, and
 * whether we email them.
 *
 * Interest edits and the digest preference are separate actions with separate pending
 * state, because one failing must not silently discard the other. Recent digests are shown
 * read-only: "did last Monday's email go out" is the question this page gets asked, and
 * answering it here beats a support conversation.
 */
export function SettingsPanel({
  settings,
  onAddInterest,
  onRemoveInterest,
  onSetDigestOptIn,
}: {
  settings: SettingsView
  onAddInterest: (text: string) => Promise<void>
  onRemoveInterest: (interestId: string) => Promise<void>
  onSetDigestOptIn: (optIn: boolean) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const add = useAsyncAction(onAddInterest, 'Could not add that interest')
  const remove = useAsyncAction(onRemoveInterest, 'Could not remove that interest')
  const digest = useAsyncAction(onSetDigestOptIn, 'Could not save your digest preference')

  async function submitInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (text.length < 2) return
    await add.run('add', text)
    setDraft('')
  }

  return (
    <div className="stack">
      <header className="stack">
        <h1>Settings</h1>
        <p className="muted">Signed in as {settings.email}</p>
      </header>

      <section className="card stack">
        <h2>Interests</h2>
        <p className="muted">
          Episodes are scored against these. Removing one stops it influencing future matches;
          summaries you already have are untouched.
        </p>

        {settings.interests.length === 0 ? (
          <p className="muted">
            No interests yet — nothing will be auto-queued until you add at least one.
          </p>
        ) : (
          <ul className="plain stack">
            {settings.interests.map((interest) => (
              <li key={interest.id} className="row-between">
                <span>{interest.text}</span>
                <span className="row-tight">
                  <span className="muted">weight {interest.weight.toFixed(2)}</span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={remove.pendingKey === interest.id}
                    onClick={() => remove.run(interest.id, interest.id)}
                  >
                    {remove.pendingKey === interest.id ? 'Removing...' : 'Remove'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {remove.error ? <p className="error">{remove.error}</p> : null}

        <form className="stack" onSubmit={submitInterest}>
          <div>
            <label htmlFor="settings-interest">Add an interest</label>
            <input
              id="settings-interest"
              name="interest"
              minLength={2}
              maxLength={200}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          <button type="submit" disabled={add.pending || draft.trim().length < 2}>
            {add.pending ? 'Adding...' : 'Add interest'}
          </button>
          {add.error ? <p className="error">{add.error}</p> : null}
        </form>
      </section>

      <section className="card stack">
        <h2>Weekly digest</h2>
        <label className="row-tight" htmlFor="digest-opt-in">
          <input
            id="digest-opt-in"
            type="checkbox"
            checked={settings.weeklyDigestOptIn}
            disabled={digest.pending}
            onChange={(event) => digest.run('digest', event.target.checked)}
          />
          Email me a digest of the week&apos;s summaries
        </label>
        <p className="muted">
          {settings.weeklyDigestOptIn
            ? 'Sent Monday mornings, covering the previous week. Nothing is sent on a week with no summaries.'
            : 'Off — summaries still appear in the app, you just will not be emailed.'}
        </p>
        {digest.error ? <p className="error">{digest.error}</p> : null}
      </section>

      <section className="card stack">
        <h2>Recent digests</h2>
        {settings.recentDigests.length === 0 ? (
          <p className="muted">No digests yet. The first one covers your first full week.</p>
        ) : (
          <ul className="plain stack">
            {settings.recentDigests.map((entry) => (
              <li key={entry.id} className="row-between">
                <span>Week of {entry.weekOf}</span>
                <span className="muted">
                  {entry.episodeCount} {entry.episodeCount === 1 ? 'episode' : 'episodes'} ·{' '}
                  {entry.sentAt ? 'sent' : 'not sent'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
