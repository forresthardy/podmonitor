import { formatTimestamp } from '@/lib/format/time'

/**
 * A position in the episode, as a link.
 *
 * v1 has no in-app playback (spec §non-goals), so this is not a play button: it points at
 * the place in the reading view that holds this quote or insight. `href` rather than a
 * fragment built here, because the same reading differs by surface — inside a summary it
 * is `#insight-2`, and in a search result it is the other summary's URL plus that anchor.
 *
 * `aria-label` spells the position out, because "42:07" read aloud on its own tells a
 * screen-reader user nothing.
 */
export function TimestampAnchor({
  timestampSec,
  href,
  label,
}: {
  timestampSec: number
  /** Where the reading links to — an in-page fragment or a full summary URL with one. */
  href: string
  label?: string
}) {
  const reading = formatTimestamp(timestampSec)

  return (
    <a className="timestamp" href={href} aria-label={`${label ?? 'Episode position'} ${reading}`}>
      {reading}
    </a>
  )
}
