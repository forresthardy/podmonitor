'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signOut() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) {
        setError('Sign out failed, please retry')
        return
      }
      router.replace('/login')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Network error')
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <button className="secondary" type="button" onClick={signOut} disabled={pending}>
        {pending ? 'Signing out...' : 'Sign out'}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
