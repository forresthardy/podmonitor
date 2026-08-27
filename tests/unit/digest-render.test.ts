import { describe, expect, it } from 'vitest'
import type { DigestContent } from '@/lib/digest/assemble'
import { renderDigestEmail } from '@/lib/digest/render'

const CONTENT: DigestContent = {
  userId: 'user-1',
  weekOf: '2026-08-24',
  episodes: [
    {
      episodeId: 'ep-1',
      episodeTitle: 'The <Standard> Oil Episode',
      podcastTitle: 'Acquired & Co',
      tldr: 'Rockefeller built a refining "monopoly".',
      topInsights: [{ text: 'Distribution moats beat product moats.', context: 'x', timestampSec: 1 }],
    },
  ],
}

describe('renderDigestEmail', () => {
  it('renders the exact email a real send would use — this is what dry-run mode returns', () => {
    const email = renderDigestEmail(CONTENT, { appUrl: 'https://podmonitor.example.com/dashboard' })

    expect(email.subject).toBe('Your Podmonitor digest: 1 new episode')
    expect(email.html).toContain('https://podmonitor.example.com/dashboard')
    expect(email.html).toContain('2026-08-24')
    expect(email.text).toContain('https://podmonitor.example.com/dashboard')
  })

  it('pluralizes the subject for more than one episode', () => {
    const email = renderDigestEmail(
      { ...CONTENT, episodes: [...CONTENT.episodes, { ...CONTENT.episodes[0]!, episodeId: 'ep-2' }] },
      { appUrl: 'https://app.example.com' },
    )

    expect(email.subject).toBe('Your Podmonitor digest: 2 new episodes')
  })

  it('escapes HTML from episode/podcast titles and TL;DRs so LLM/RSS content cannot break the markup', () => {
    const email = renderDigestEmail(CONTENT, { appUrl: 'https://app.example.com' })

    expect(email.html).not.toContain('<Standard>')
    expect(email.html).toContain('&lt;Standard&gt;')
    expect(email.html).toContain('&quot;monopoly&quot;')
    expect(email.html).toContain('Acquired &amp; Co')
  })

  it('includes every episode TL;DR and insight in both the html and text bodies', () => {
    const email = renderDigestEmail(CONTENT, { appUrl: 'https://app.example.com' })

    expect(email.text).toContain('Distribution moats beat product moats.')
    expect(email.html).toContain('Distribution moats beat product moats.')
  })

  it('renders a valid (if sparse) email for zero episodes rather than throwing', () => {
    const email = renderDigestEmail({ userId: 'user-1', weekOf: '2026-08-24', episodes: [] }, { appUrl: 'https://app.example.com' })

    expect(email.subject).toBe('Your Podmonitor digest: 0 new episodes')
    expect(email.html).toContain('2026-08-24')
  })
})
