/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SummaryReader } from '@/components/summary-reader'
import '../helpers/dom'
import { crossReferenceViewFixture, summaryViewFixture } from '../helpers/view-fixtures'

describe('SummaryReader', () => {
  it('leads with the TL;DR and numbers the insights in order', () => {
    render(<SummaryReader summary={summaryViewFixture()} />)

    expect(screen.getByText('TL;DR')).toBeTruthy()
    expect(
      screen.getByText('Pricing power is the cheapest growth lever most companies never pull.'),
    ).toBeTruthy()

    const insights = screen.getAllByRole('listitem').filter((node) => node.id.startsWith('insight-'))
    expect(insights.map((node) => node.id)).toEqual(['insight-1', 'insight-2'])
    expect(insights[0]?.textContent).toContain('#1')
    expect(insights[0]?.textContent).toContain('Pricing power shows up in retention')
  })

  it('keeps each insight with the context that makes it usable', () => {
    render(<SummaryReader summary={summaryViewFixture()} />)

    const first = document.getElementById('insight-1')
    expect(first).not.toBeNull()
    expect(first?.textContent).toContain('comparing two SaaS businesses with identical churn')
  })

  it('anchors an insight timestamp to that insight', () => {
    render(<SummaryReader summary={summaryViewFixture()} />)

    // 754s = 12:34 — the reading and the fragment must agree.
    const anchor = screen.getByRole('link', { name: 'Insight 1 at 12:34' })
    expect(anchor.getAttribute('href')).toBe('#insight-1')
  })

  it('attributes each quote to a speaker at a jumpable timestamp', () => {
    render(<SummaryReader summary={summaryViewFixture()} />)

    const quote = screen.getByText(/Nobody churns over a price/)
    const figure = quote.closest('figure')
    expect(figure).not.toBeNull()
    expect(figure?.id).toBe('quote-t-1230')
    expect(figure?.textContent).toContain('Patrick OShaughnessy')

    const anchor = screen.getByRole('link', { name: 'Patrick OShaughnessy at 20:30' })
    expect(anchor.getAttribute('href')).toBe('#quote-t-1230')
  })

  it('shows a cross-reference callout under the insight it belongs to, linking the older insight', () => {
    render(<SummaryReader summary={summaryViewFixture()} />)

    const second = document.getElementById('insight-2')
    expect(second).not.toBeNull()

    const callout = within(second as HTMLElement).getByText(/Extends insight #2/)
    expect(callout.textContent).toContain('Standard Oil')

    const link = within(second as HTMLElement).getByRole('link', { name: 'Open it' })
    expect(link.getAttribute('href')).toBe('/summaries/summary-older#insight-2')

    // The callout belongs to insight 2 only — insight 1 has no cross-references.
    const first = document.getElementById('insight-1') as HTMLElement
    expect(within(first).queryByText(/Extends insight/)).toBeNull()
  })

  it('marks a contradiction differently from an agreement', () => {
    const summary = summaryViewFixture({
      insights: [
        {
          ordinal: 1,
          text: 'Scale, not integration, was the moat.',
          context: 'Directly disputing an earlier guest.',
          timestampSec: 60,
          crossReferences: [
            crossReferenceViewFixture({
              relation: 'contradicts',
              callout: 'Contradicts insight #2 from “Standard Oil” (Mar 4, 2026)',
            }),
          ],
        },
      ],
    })

    render(<SummaryReader summary={summary} />)

    const callout = screen.getByText(/Contradicts insight #2/).closest('aside')
    expect(callout?.getAttribute('data-relation')).toBe('contradicts')
  })

  it('says so plainly when a summary has no insights or quotes', () => {
    render(<SummaryReader summary={summaryViewFixture({ insights: [], quotes: [] })} />)

    expect(screen.getByText(/no key insights/i)).toBeTruthy()
    expect(screen.getByText(/No quotes cleared the timestamp check/i)).toBeTruthy()
  })
})
