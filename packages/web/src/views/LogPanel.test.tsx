// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCancelPick, startCancelPick, stopCancelPick } from '../lib/cancelPick.js'
import { api } from '../lib/api.js'
import type { LogEntryDto, PlayerView } from '../lib/api.js'
import { clearToasts } from '../lib/toasts.js'
import { ToastRegion } from './ToastRegion.js'
import { LogPanel } from './LogPanel.js'

beforeEach(() => localStorage.setItem('civ.panel.log', 'true'))
afterEach(() => {
  restoreScroll()
  stopCancelPick()
  clearToasts()
  cleanup()
  localStorage.removeItem('civ.panel.log')
  vi.restoreAllMocks()
})

const originalScroll = Element.prototype.scrollIntoView
const stubScroll = (fn: () => void): void => { Element.prototype.scrollIntoView = fn }
const restoreScroll = (): void => { Element.prototype.scrollIntoView = originalScroll }

const entry = (id: string, message: string, extra: Partial<LogEntryDto> = {}): LogEntryDto => ({
  id,
  username: 'Alice',
  logType: null,
  message,
  hasUndo: false,
  ...extra,
})

const run = async (action: () => Promise<PlayerView | unknown>): Promise<void> => {
  await action()
}

function renderLog(publicLog: readonly LogEntryDto[], privateLog: readonly LogEntryDto[] = []) {
  vi.spyOn(api, 'publicLog').mockResolvedValue([...publicLog])
  vi.spyOn(api, 'privateLog').mockResolvedValue([...privateLog])
  vi.spyOn(api, 'pendingUndos').mockResolvedValue([])
  return render(<LogPanel gameId="game-1" busy={false} run={run} reloadCount={0} />)
}

describe('LogPanel undo on the public tab', () => {
  it('offers Ask for undo on a public line the server marks canUndo, and asks through the existing vote', async () => {
    const ask = vi.spyOn(api, 'initiateUndo').mockResolvedValue({} as PlayerView)
    renderLog([
      entry('line-1', 'Alice used Chivalry: spent 1 Incense and gained 5 culture', {
        assistedActionId: 'req-1',
        canUndo: true,
      }),
    ])

    fireEvent.click(await screen.findByRole('button', { name: 'Ask for undo' }))

    await waitFor(() => expect(ask).toHaveBeenCalledWith('game-1', 'line-1'))
  })

  it('offers no button on public lines the server did not mark, or that are already undone', async () => {
    renderLog([
      entry('line-1', 'Alice drew a card'),
      entry('line-2', "Alice's Chivalry was undone", { assistedActionId: 'req-1', canUndo: false }),
    ])

    await screen.findByText('Alice drew a card')

    expect(screen.queryByRole('button', { name: 'Ask for undo' })).toBeNull()
  })

  it('keeps the private tab as it was: the button there still follows canUndo', async () => {
    renderLog([], [entry('private-1', 'Alice drew Pottery', { canUndo: true })])

    fireEvent.click(screen.getByRole('button', { name: 'Private' }))

    expect(await screen.findByRole('button', { name: 'Ask for undo' })).toBeTruthy()
  })

  it('disables the button while another write runs', async () => {
    vi.spyOn(api, 'publicLog').mockResolvedValue([
      entry('line-1', 'Alice used Chivalry', { assistedActionId: 'req-1', canUndo: true }),
    ])
    vi.spyOn(api, 'privateLog').mockResolvedValue([])
    vi.spyOn(api, 'pendingUndos').mockResolvedValue([])
    render(<LogPanel gameId="game-1" busy={true} run={run} reloadCount={0} />)

    const button = (await screen.findByRole('button', { name: 'Ask for undo' })) as HTMLButtonElement

    expect(button.disabled).toBe(true)
  })
})

const cardsView = (cards: readonly { itemId: string; name: string; targets: readonly { logId: string; text: string; blocked: string | null }[] }[]) =>
  ({ id: 'game-1', rev: 12, you: { playerId: 'a' }, cancellations: { responseCards: cards } }) as unknown as PlayerView
const twainView = (targets: readonly { logId: string; text: string; blocked: string | null }[]) =>
  cardsView([{ itemId: 'twain', name: 'Mark Twain', targets }])

describe('LogPanel cancel mode', () => {
  const lines = [entry('a', 'Bob devoted a city'), entry('b', 'Bob drew a card'), entry('c', 'Bob built a wall')]
  const targets = [
    { logId: 'a', text: 'Bob devoted a city', blocked: null },
    { logId: 'c', text: 'Bob built a wall', blocked: 'Your own action' },
  ]

  function renderMode(view: PlayerView) {
    vi.spyOn(api, 'publicLog').mockResolvedValue([...lines])
    vi.spyOn(api, 'privateLog').mockResolvedValue([])
    vi.spyOn(api, 'pendingUndos').mockResolvedValue([])
    return render(<LogPanel gameId="game-1" busy={false} run={run} reloadCount={0} view={view} />)
  }

  it('offers no Cancel button until a cancellation card started the mode', async () => {
    renderMode(twainView(targets))
    await screen.findByText('Bob devoted a city')
    expect(screen.queryByRole('button', { name: /^Cancel/ })).toBeNull()
  })

  it('puts a red Cancel button only on actions the card can cancel, and cancels at once from it', async () => {
    const send = vi.spyOn(api, 'cancellation').mockResolvedValue({} as PlayerView)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderMode(twainView(targets))
    await screen.findByText('Bob devoted a city')
    act(() => startCancelPick({ itemId: 'twain', name: 'Mark Twain' }))
    expect(screen.getByText(/Cancel with Mark Twain/)).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: /^Cancel:/ })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.className).toContain('danger')
    fireEvent.click(buttons[0] as HTMLElement)
    await waitFor(() => expect(send).toHaveBeenCalledWith(
      'game-1', { logId: 'a', itemId: 'twain' }, 12, expect.any(String),
    ))
    // One action, one cancellation: the mode is over
    expect(getCancelPick()).toBeNull()
  })

  it('does nothing when the player declines the confirmation', async () => {
    const send = vi.spyOn(api, 'cancellation').mockResolvedValue({} as PlayerView)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderMode(twainView(targets))
    await screen.findByText('Bob devoted a city')
    act(() => startCancelPick({ itemId: 'twain', name: 'Mark Twain' }))
    fireEvent.click(screen.getByRole('button', { name: /^Cancel:/ }))
    expect(send).not.toHaveBeenCalled()
    expect(getCancelPick()).not.toBeNull()
  })

  it('stops the mode with Stop, and when the card is gone', async () => {
    const { rerender } = renderMode(twainView(targets))
    await screen.findByText('Bob devoted a city')
    act(() => startCancelPick({ itemId: 'twain', name: 'Mark Twain' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(getCancelPick()).toBeNull()
    act(() => startCancelPick({ itemId: 'twain', name: 'Mark Twain' }))
    rerender(<LogPanel gameId="game-1" busy={false} run={run} reloadCount={0} view={cardsView([])} />)
    await waitFor(() => expect(getCancelPick()).toBeNull())
    expect(screen.queryByRole('button', { name: /^Cancel:/ })).toBeNull()
  })

  it('puts a Protect button for King straight on the cancellation line, without a mode', async () => {
    const send = vi.spyOn(api, 'cancellation').mockResolvedValue({} as PlayerView)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderMode(cardsView([{ itemId: 'king', name: 'Dr. Martin Luther King', targets: [{ logId: 'c', text: 'Bob built a wall', blocked: null }] }]))
    await screen.findByText('Bob devoted a city')
    expect(screen.getAllByRole('button', { name: /^Protect with King:/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Protect with King: Bob built a wall' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(
      'game-1', { logId: 'c', itemId: 'king' }, 12, expect.any(String),
    ))
  })
})

describe('LogPanel undo vote', () => {
  const waiting = [{ id: 'u1', username: 'Bob', message: 'Bob built a wall', votesRequired: 2, votesCast: 1 }]

  it('reminds once per page load, with a link that scrolls to the vote', async () => {
    vi.spyOn(api, 'publicLog').mockResolvedValue([])
    vi.spyOn(api, 'privateLog').mockResolvedValue([])
    vi.spyOn(api, 'pendingUndos').mockResolvedValue(waiting)
    const scroll = vi.fn()
    stubScroll(scroll)
    const { rerender } = render(<><ToastRegion /><LogPanel gameId="game-1" busy={false} run={run} reloadCount={0} /></>)
    expect(await screen.findByText('An undo is waiting for your vote.')).toBeTruthy()
    rerender(<><ToastRegion /><LogPanel gameId="game-1" busy={false} run={run} reloadCount={1} /></>)
    await waitFor(() => expect(api.pendingUndos).toHaveBeenCalledTimes(2))
    expect(screen.getAllByText('An undo is waiting for your vote.')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Go to vote' }))
    expect(scroll).toHaveBeenCalled()
    expect(screen.queryByText('An undo is waiting for your vote.')).toBeNull()
  })

  it('does not remind a spectator, who cannot vote', async () => {
    vi.spyOn(api, 'publicLog').mockResolvedValue([])
    vi.spyOn(api, 'privateLog').mockResolvedValue([])
    const pending = vi.spyOn(api, 'pendingUndos').mockResolvedValue(waiting)
    const spectator = { id: 'game-1', rev: 1, you: null } as unknown as PlayerView
    render(<><ToastRegion /><LogPanel gameId="game-1" busy={false} run={run} reloadCount={0} view={spectator} /></>)
    await waitFor(() => expect(pending).toHaveBeenCalled())
    await screen.findByRole('button', { name: 'Yes' })
    expect(screen.queryByText('An undo is waiting for your vote.')).toBeNull()
  })

  it('does not remind when nothing waits, and colours the vote green when something does', async () => {
    vi.spyOn(api, 'publicLog').mockResolvedValue([])
    vi.spyOn(api, 'privateLog').mockResolvedValue([])
    const pending = vi.spyOn(api, 'pendingUndos').mockResolvedValue([])
    const { rerender } = render(<><ToastRegion /><LogPanel gameId="game-1" busy={false} run={run} reloadCount={0} /></>)
    await waitFor(() => expect(pending).toHaveBeenCalled())
    expect(screen.queryByText(/waiting for your vote\./)).toBeNull()
    pending.mockResolvedValue(waiting)
    rerender(<><ToastRegion /><LogPanel gameId="game-1" busy={false} run={run} reloadCount={1} /></>)
    const yes = await screen.findByRole('button', { name: 'Yes' })
    expect(yes.className).toContain('success')
    expect(yes.closest('ul')?.className).toContain('vote-needed')
  })
})
