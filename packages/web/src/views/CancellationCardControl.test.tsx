// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerView } from '@civ/engine'
import { getCancelPick, stopCancelPick } from '../lib/cancelPick.js'
import { CancellationCardControl } from './CancellationCardControl.js'

afterEach(() => {
  stopCancelPick()
  cleanup()
  document.body.innerHTML = ''
})

const view = (targets: readonly { logId: string; text: string; blocked: string | null }[]) =>
  ({ id: 'g', rev: 12, cancellations: { responseCards: [{ itemId: 'twain', name: 'Mark Twain', targets }] } }) as unknown as PlayerView

describe('cancellation card control', () => {
  it('starts the cancel mode of the log and scrolls there, with no action dropdown', () => {
    const original = Element.prototype.scrollIntoView
    let scrolled = 0
    Element.prototype.scrollIntoView = () => { scrolled += 1 }
    document.body.insertAdjacentHTML('beforeend', '<section><button aria-controls="log-content" aria-expanded="true"></button></section>')
    try {
      render(<CancellationCardControl view={view([{ logId: 'log', text: 'Alice devoted a city', blocked: null }])} busy={false} itemId="twain" name="Mark Twain" />)
      expect(screen.queryByLabelText('Action to cancel')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Play Mark Twain' }))
      expect(scrolled).toBe(1)
      expect(getCancelPick()).toEqual({ itemId: 'twain', name: 'Mark Twain' })
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('is disabled, with the reason, when nothing can be cancelled', () => {
    render(<CancellationCardControl view={view([{ logId: 'log', text: 'Own action', blocked: 'Your own action' }])} busy={false} itemId="twain" name="Mark Twain" />)
    expect((screen.getByRole('button', { name: 'Play Mark Twain' }) as HTMLButtonElement).disabled).toBe(true)
    // The reason is in the ? button, not on the card
    expect(screen.queryByText(/Nothing in the log can be cancelled/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: Mark Twain' }))
    expect(screen.getByText(/Nothing in the log can be cancelled with it right now/)).toBeTruthy()
  })

  it('has the ? after Play, and the help, not the card, says to choose the log line', () => {
    render(<CancellationCardControl view={view([{ logId: 'log', text: 'Alice devoted a city', blocked: null }])} busy={false} itemId="twain" name="Mark Twain" />)
    const buttons = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(buttons).toEqual(['Play Mark Twain', 'Help: Mark Twain'])
    expect(screen.queryByText(/Choose the log line to act on in the log/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: Mark Twain' }))
    expect(screen.getByText(/Cancel a city action, a culture event or a resource ability of another player/)).toBeTruthy()
    expect(screen.getByText(/Choose the log line to act on in the log\./)).toBeTruthy()
  })
})
