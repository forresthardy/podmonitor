/**
 * Display formatting for episode positions and dates.
 *
 * Pure and dependency-free on purpose: the summary reader, the episode library and the
 * knowledge base all print the same clock readings, and a timestamp that renders one way
 * in a summary and another way in search results reads like two different products.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Clock reading for a position inside an episode: `12:34`, or `1:02:03` past the hour.
 * Negative and fractional inputs are clamped and floored rather than rejected — the
 * transcript timestamps come from ASR and occasionally carry sub-second drift.
 */
export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/**
 * Fragment id for a position in an episode. v1 has no in-app playback (spec §non-goals),
 * so a timestamp anchor is a deep link *into the reading view*: it scrolls to the insight
 * or quote at that position and gives the reader a URL to come back to.
 */
export function timestampAnchorId(totalSeconds: number): string {
  return `t-${Math.max(0, Math.floor(totalSeconds))}`
}

/** `1h 42m` / `38m`. Null in, null out: feeds do omit `itunes:duration`. */
export function formatDuration(totalSeconds: number | null): string | null {
  if (totalSeconds === null || totalSeconds <= 0) return null

  const safe = Math.floor(totalSeconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.round((safe % 3600) / 60)

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/**
 * `Nov 12, 2025` in UTC. A missing date returns null so callers can drop the clause
 * entirely instead of printing a placeholder — same reasoning as the cross-reference
 * callout, which omits the date rather than showing `Invalid Date`.
 */
export function formatPublishedDate(iso: string | null): string | null {
  if (!iso) return null

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
