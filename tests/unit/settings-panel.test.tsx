/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsPanel } from '@/components/settings-panel'
import '../helpers/dom'
import { settingsViewFixture } from '../helpers/view-fixtures'

function renderPanel(overrides: Parameters<typeof settingsViewFixture>[0] = {}) {
  const handlers = {
    onAddInterest: vi.fn().mockResolvedValue(undefined),
    onRemoveInterest: vi.fn().mockResolvedValue(undefined),
    onSetDigestOptIn: vi.fn().mockResolvedValue(undefined),
  }
  render(<SettingsPanel settings={settingsViewFixture(overrides)} {...handlers} />)
  return handlers
}

describe('SettingsPanel', () => {
  it('lists the interests currently steering what gets summarized', () => {
    renderPanel()

    expect(screen.getByText('pricing power')).toBeTruthy()
    expect(screen.getByText('AI agents in production')).toBeTruthy()
  })

  it('adds an interest and clears the field for the next one', async () => {
    const { onAddInterest } = renderPanel()

    const field = screen.getByLabelText('Add an interest') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'capital allocation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add interest' }))

    await waitFor(() => expect(onAddInterest).toHaveBeenCalledWith('capital allocation'))
    await waitFor(() => expect(field.value).toBe(''))
  })

  it('removes the interest whose button was pressed', async () => {
    const { onRemoveInterest } = renderPanel()

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
    expect(removeButtons).toHaveLength(2)
    const second = removeButtons[1]
    if (!second) throw new Error('Expected a remove button per interest')
    fireEvent.click(second)

    await waitFor(() => expect(onRemoveInterest).toHaveBeenCalledWith('interest-2'))
  })

  it('turns the weekly digest off with the reader in control of the decision', async () => {
    const { onSetDigestOptIn } = renderPanel({ weeklyDigestOptIn: true })

    const toggle = screen.getByLabelText(/Email me a digest/i) as HTMLInputElement
    expect(toggle.checked).toBe(true)

    fireEvent.click(toggle)

    await waitFor(() => expect(onSetDigestOptIn).toHaveBeenCalledWith(false))
  })

  it('turns the weekly digest back on', async () => {
    const { onSetDigestOptIn } = renderPanel({ weeklyDigestOptIn: false })

    fireEvent.click(screen.getByLabelText(/Email me a digest/i))

    await waitFor(() => expect(onSetDigestOptIn).toHaveBeenCalledWith(true))
  })

  it('answers "did last week\'s digest go out" without a support conversation', () => {
    renderPanel()

    expect(screen.getByText('Week of 2026-08-17')).toBeTruthy()
    expect(screen.getByText(/3 episodes · sent/)).toBeTruthy()
  })

  it('distinguishes an unsent digest from a sent one', () => {
    renderPanel({
      recentDigests: [{ id: 'digest-2', weekOf: '2026-08-24', sentAt: null, episodeCount: 1 }],
    })

    expect(screen.getByText(/1 episode · not sent/)).toBeTruthy()
  })

  it('surfaces a failed preference save rather than pretending it stuck', async () => {
    render(
      <SettingsPanel
        settings={settingsViewFixture()}
        onAddInterest={vi.fn()}
        onRemoveInterest={vi.fn()}
        onSetDigestOptIn={vi.fn().mockRejectedValue(new Error('Database unavailable'))}
      />,
    )

    fireEvent.click(screen.getByLabelText(/Email me a digest/i))

    expect(await screen.findByText('Database unavailable')).toBeTruthy()
  })

  it('explains what an empty interest list means for the pipeline', () => {
    renderPanel({ interests: [] })

    expect(screen.getByText(/nothing will be auto-queued/i)).toBeTruthy()
  })

  it('explains an empty digest history', () => {
    renderPanel({ recentDigests: [] })

    expect(screen.getByText(/No digests yet/i)).toBeTruthy()
  })
})
