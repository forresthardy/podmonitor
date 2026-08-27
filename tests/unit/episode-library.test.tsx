/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EpisodeLibrary } from '@/components/episode-library'
import '../helpers/dom'
import { episodeLibraryItemFixture } from '../helpers/view-fixtures'

// Titles are deliberately unlike any status wording: the rows also render a plain-language
// status line ("Ready to read"), and a title that echoes it makes the row lookup ambiguous.
function rowFor(title: string): HTMLElement {
  const node = screen.getByText(title).closest('li')
  if (!node) throw new Error(`No library row for ${title}`)
  return node
}

describe('EpisodeLibrary', () => {
  it('badges each episode with where it is in the pipeline', () => {
    render(
      <EpisodeLibrary
        episodes={[
          episodeLibraryItemFixture({ episodeId: 'a', title: 'Alpha episode', status: 'discovered', summaryId: null }),
          episodeLibraryItemFixture({ episodeId: 'b', title: 'Beta episode', status: 'transcribing', summaryId: null }),
          episodeLibraryItemFixture({ episodeId: 'c', title: 'Gamma episode', status: 'summarized' }),
          episodeLibraryItemFixture({
            episodeId: 'd',
            title: 'Delta episode',
            status: 'failed',
            summaryId: null,
            failureReason: 'Whisper sidecar unreachable after 3 attempts',
          }),
        ]}
        onRetry={vi.fn()}
      />,
    )

    expect(within(rowFor('Alpha episode')).getByText('Discovered')).toBeTruthy()
    expect(within(rowFor('Beta episode')).getByText('Transcribing')).toBeTruthy()
    expect(within(rowFor('Gamma episode')).getByText('Summarized')).toBeTruthy()
    expect(within(rowFor('Delta episode')).getByText('Failed')).toBeTruthy()
  })

  it('links a summarized episode to the reader', () => {
    render(<EpisodeLibrary episodes={[episodeLibraryItemFixture()]} onRetry={vi.fn()} />)

    const link = screen.getByRole('link', { name: 'Read the summary' })
    expect(link.getAttribute('href')).toBe('/summaries/summary-1')
  })

  it('shows why a failed episode failed, and offers a retry that reaches the caller', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined)
    render(
      <EpisodeLibrary
        episodes={[
          episodeLibraryItemFixture({
            episodeId: 'episode-failed',
            status: 'failed',
            summaryId: null,
            failureReason: 'Transcript download returned 404',
          }),
        ]}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('Transcript download returned 404')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith('episode-failed'))
  })

  it('offers no retry for an episode that has not failed', () => {
    render(<EpisodeLibrary episodes={[episodeLibraryItemFixture()]} onRetry={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('surfaces a failed retry instead of leaving the button dead', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('Queue is not accepting jobs'))
    render(
      <EpisodeLibrary
        episodes={[
          episodeLibraryItemFixture({ status: 'failed', summaryId: null, failureReason: 'ASR timed out' }),
        ]}
        onRetry={onRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Queue is not accepting jobs')).toBeTruthy()
    // The button comes back so the reader can try again once the queue recovers.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(false))
  })

  it('explains an empty library rather than rendering a blank page', () => {
    render(<EpisodeLibrary episodes={[]} onRetry={vi.fn()} />)

    expect(screen.getByText(/No episodes queued yet/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Review your interests' }).getAttribute('href')).toBe(
      '/settings',
    )
  })

  it('does not imply a summary exists when this reader has none yet', () => {
    render(
      <EpisodeLibrary
        episodes={[episodeLibraryItemFixture({ status: 'summarized', summaryId: null })]}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.queryByRole('link', { name: 'Read the summary' })).toBeNull()
    expect(screen.getByText(/yours is still being written/i)).toBeTruthy()
  })
})
