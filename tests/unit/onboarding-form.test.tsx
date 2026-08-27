/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OnboardingForm } from '@/components/onboarding-form'
import { SEED_SHOWS } from '@/lib/feeds/seed-shows'
import '../helpers/dom'

function addInterest(text: string) {
  fireEvent.change(screen.getByLabelText('Add an interest'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
}

describe('OnboardingForm', () => {
  it('names the shows the reader is about to be subscribed to', () => {
    render(<OnboardingForm seedShows={SEED_SHOWS} suggestions={[]} onComplete={vi.fn()} />)

    for (const show of SEED_SHOWS) {
      expect(screen.getByText(show.title)).toBeTruthy()
    }
  })

  it('collects several interests before submitting anything', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined)
    render(<OnboardingForm seedShows={SEED_SHOWS} suggestions={[]} onComplete={onComplete} />)

    addInterest('pricing power')
    addInterest('AI agents in production')

    expect(onComplete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Start monitoring' }))

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(['pricing power', 'AI agents in production']),
    )
  })

  it('cannot finish setup with no interests', () => {
    render(<OnboardingForm seedShows={SEED_SHOWS} suggestions={[]} onComplete={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Start monitoring' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/No interests yet/i)).toBeTruthy()
  })

  it('refuses a duplicate interest, which would double-count when scoring', () => {
    render(<OnboardingForm seedShows={SEED_SHOWS} suggestions={[]} onComplete={vi.fn()} />)

    addInterest('pricing power')
    addInterest('pricing power')

    expect(screen.getAllByText('pricing power')).toHaveLength(1)
  })

  it('drops an interest the reader removes', () => {
    render(<OnboardingForm seedShows={SEED_SHOWS} suggestions={[]} onComplete={vi.fn()} />)

    addInterest('pricing power')
    fireEvent.click(screen.getByRole('button', { name: 'Remove pricing power' }))

    expect(screen.queryByText('pricing power')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start monitoring' }).hasAttribute('disabled')).toBe(true)
  })

  it('adds a suggested interest in one click', () => {
    render(
      <OnboardingForm
        seedShows={SEED_SHOWS}
        suggestions={['founder-led sales']}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'founder-led sales' }))

    expect(screen.getByRole('button', { name: 'Remove founder-led sales' })).toBeTruthy()
  })

  it('keeps the reader on the form when setup fails, and says why', async () => {
    const onComplete = vi.fn().mockRejectedValue(new Error('Could not subscribe to seed shows'))
    render(<OnboardingForm seedShows={SEED_SHOWS} suggestions={[]} onComplete={onComplete} />)

    addInterest('pricing power')
    fireEvent.click(screen.getByRole('button', { name: 'Start monitoring' }))

    expect(await screen.findByText('Could not subscribe to seed shows')).toBeTruthy()
    // The typed interests survive the failure — retyping them would be the real insult.
    expect(screen.getByRole('button', { name: 'Remove pricing power' })).toBeTruthy()
  })
})
