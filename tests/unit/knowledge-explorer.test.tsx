/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KnowledgeExplorer } from '@/components/knowledge-explorer'
import '../helpers/dom'
import { crossReferenceViewFixture, insightSearchResultFixture } from '../helpers/view-fixtures'

function search(query: string) {
  fireEvent.change(screen.getByLabelText('Search insights'), { target: { value: query } })
  fireEvent.submit(screen.getByLabelText('Search insights').closest('form') as HTMLFormElement)
}

describe('KnowledgeExplorer', () => {
  it('browses recent insights before anything is searched', () => {
    render(
      <KnowledgeExplorer
        browseResults={[insightSearchResultFixture()]}
        onSearch={vi.fn()}
      />,
    )

    expect(screen.getByTestId('kb-result-summary').textContent).toContain('Browsing 1 recent insight')
    expect(screen.getByText(/Pricing power shows up in retention/)).toBeTruthy()
  })

  it('links an insight back to its summary at that insight anchor', () => {
    render(
      <KnowledgeExplorer
        browseResults={[insightSearchResultFixture({ ordinal: 3, summaryId: 'summary-42' })]}
        onSearch={vi.fn()}
      />,
    )

    const link = screen.getByRole('link', { name: 'How pricing power compounds' })
    expect(link.getAttribute('href')).toBe('/summaries/summary-42#insight-3')
  })

  it('replaces the browse feed with what the query returned', async () => {
    const onSearch = vi.fn().mockResolvedValue([
      insightSearchResultFixture({
        insightId: 'insight-match',
        text: 'Distribution beats product in a commodity market.',
      }),
    ])

    render(
      <KnowledgeExplorer
        browseResults={[insightSearchResultFixture({ text: 'Something else entirely.' })]}
        onSearch={onSearch}
      />,
    )

    search('distribution')

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('distribution'))
    expect(await screen.findByText('Distribution beats product in a commodity market.')).toBeTruthy()
    expect(screen.queryByText('Something else entirely.')).toBeNull()
    expect(screen.getByTestId('kb-result-summary').textContent).toContain('1 insight matching')
  })

  it('says nothing matched rather than showing an empty page', async () => {
    render(
      <KnowledgeExplorer
        browseResults={[insightSearchResultFixture()]}
        onSearch={vi.fn().mockResolvedValue([])}
      />,
    )

    search('quantum tunnelling')

    expect(await screen.findByText(/Nothing matches that yet/i)).toBeTruthy()
  })

  it('restores browsing when the query is cleared', async () => {
    const onSearch = vi.fn().mockResolvedValue([])
    render(
      <KnowledgeExplorer
        browseResults={[insightSearchResultFixture({ text: 'Back to browsing.' })]}
        onSearch={onSearch}
      />,
    )

    search('nothing here')
    expect(await screen.findByText(/Nothing matches that yet/i)).toBeTruthy()

    search('')
    expect(await screen.findByText('Back to browsing.')).toBeTruthy()
  })

  it('surfaces a failed search', async () => {
    render(
      <KnowledgeExplorer
        browseResults={[]}
        onSearch={vi.fn().mockRejectedValue(new Error('Embedding provider unavailable'))}
      />,
    )

    search('pricing')

    expect(await screen.findByText('Embedding provider unavailable')).toBeTruthy()
  })

  it('carries cross-reference callouts into search results', () => {
    render(
      <KnowledgeExplorer
        browseResults={[
          insightSearchResultFixture({ crossReferences: [crossReferenceViewFixture()] }),
        ]}
        onSearch={vi.fn()}
      />,
    )

    expect(screen.getByText(/Extends insight #2/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe(
      '/summaries/summary-older#insight-2',
    )
  })

  it('explains an empty knowledge base', () => {
    render(<KnowledgeExplorer browseResults={[]} onSearch={vi.fn()} />)

    expect(screen.getByText(/Your knowledge base is empty/i)).toBeTruthy()
  })
})
