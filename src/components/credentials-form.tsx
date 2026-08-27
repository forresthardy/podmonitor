'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

export type CredentialsMode = 'login' | 'register'

const COPY: Record<CredentialsMode, { submit: string; endpoint: string }> = {
  login: { submit: 'Sign in', endpoint: '/api/auth/login' },
  register: { submit: 'Create account', endpoint: '/api/auth/register' },
}

interface ApiError {
  error?: { message?: string }
}

export function CredentialsForm({ mode }: { mode: CredentialsMode }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { submit, endpoint } = COPY[mode]

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const body: ApiError = await response.json().catch(() => ({}))
        setError(body.error?.message ?? 'Request failed, please try again')
        return
      }

      router.replace('/dashboard')
    } catch (cause) {
      // Network-level failure: surface it rather than leaving a silent dead button.
      setError(cause instanceof Error ? cause.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Working...' : submit}
      </button>
    </form>
  )
}
