'use client'

import { useCallback, useState } from 'react'

/**
 * The pending/error pair every interactive surface in this app needs, once.
 *
 * Each caller was otherwise repeating the same four lines of `useState` plus a
 * try/catch/finally, and the copies disagreed on details that matter: whether the button
 * re-enables after a failure, whether a network error surfaces at all. Keyed rather than
 * boolean because most of these lists act on one row at a time — the library disables the
 * retry button of the episode being retried, not all of them.
 */

export interface AsyncActionState<TArgs extends unknown[]> {
  /** Runs the action under `key`, capturing failure as `error` instead of throwing. */
  run: (key: string, ...args: TArgs) => Promise<void>
  /** Key currently running, or null. */
  pendingKey: string | null
  pending: boolean
  error: string | null
  clearError: () => void
}

export function useAsyncAction<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<void>,
  fallbackMessage: string,
): AsyncActionState<TArgs> {
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (key: string, ...args: TArgs) => {
      setPendingKey(key)
      setError(null)
      try {
        await action(...args)
      } catch (cause) {
        // Never swallowed: a dead button with no explanation is the worst outcome here.
        setError(cause instanceof Error ? cause.message : fallbackMessage)
      } finally {
        setPendingKey(null)
      }
    },
    [action, fallbackMessage],
  )

  const clearError = useCallback(() => setError(null), [])

  return { run, pendingKey, pending: pendingKey !== null, error, clearError }
}
