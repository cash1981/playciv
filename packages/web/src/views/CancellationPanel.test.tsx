// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CancellationView, PlayerView } from '@civ/engine'
import { api } from '../lib/api.js'
import { CancellationCardControl, CancellationPanel } from './CancellationPanel.js'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const history: CancellationView = {
  floorTurn: 1, sealedThrough: 2, cutoff: 8,
  acknowledgements: [{ playerId: 'a', username: 'Alice', through: 2 }, { playerId: 'b', username: 'Bob', through: 2 }],
  cases: [{
    id: 'case', targetLogId: 'log', version: 2, outcome: 'pending', target: 'Alice devoted a city',
    affected: ['Bob drew a card'], participants: ['a', 'b'], passes: ['b'],
    reactions: [{ id: 'reaction', playerId: 'b', targetId: null, name: 'Mark Twain', protection: false }],
  }],
  responseCards: [{ itemId: 'king', name: 'Dr. Martin Luther King', targets: [], responses: [{ id: null, label: 'Original action' }] }],
}
const view = (cancellations = history, spectator = false) => ({
  id: 'g', active: true, rev: 12, cancellations,
  you: spectator ? null : { playerId: 'a', username: 'Alice', playerTurns: [{ needsRevision: true }] },
  opponents: [{ playerId: 'b', username: 'Bob' }],
}) as unknown as PlayerView
const run = async (action: () => Promise<unknown>) => { await action() }

describe('cancellation panel', () => {
  it('explains order-only flow, the affected history, version and all-player passing', async () => {
    const send = vi.spyOn(api, 'cancellation').mockResolvedValue(view())
    render(<CancellationPanel gameId="g" view={view()} busy={false} run={run} />)
    expect(screen.getByRole('heading', { name: /Gameplay paused/ })).toBeTruthy()
    expect(screen.getByText(/Do not carry out orders/)).toBeTruthy()
    expect(screen.getByText('Bob drew a card')).toBeTruthy()
    expect(screen.getByText(/Waiting for: Alice/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Confirm history through 8' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Pass on version 2' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith('g', { kind: 'pass', caseId: 'case', version: 2 }, 12, expect.any(String)))
  })

  it('sends King protection to the original action, not as a culture counter', async () => {
    const send = vi.spyOn(api, 'cancellation').mockResolvedValue(view())
    render(<CancellationPanel gameId="g" view={view()} busy={false} run={run} />)
    fireEvent.change(screen.getByLabelText('Your response card'), { target: { value: 'king' } })
    fireEvent.change(screen.getByLabelText('Response target'), { target: { value: 'original' } })
    fireEvent.click(screen.getByRole('button', { name: 'Respond' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith('g', {
      kind: 'respond', caseId: 'case', version: 2, itemId: 'king', targetId: null,
    }, 12, expect.any(String)))
  })

  it('submits exactly the visible cutoff and keeps an idempotence ID for retrying the same intent', async () => {
    const send = vi.spyOn(api, 'cancellation').mockResolvedValue(view())
    render(<CancellationPanel gameId="g" view={view({ ...history, cases: [] })} busy={false} run={run} />)
    const button = screen.getByRole('button', { name: 'Confirm history through 8' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1])
    expect(send.mock.calls[0]?.[1]).toEqual({ kind: 'confirm', through: 8 })
  })

  it('makes spectators read-only without response choices', () => {
    render(<CancellationPanel gameId="g" view={view({ ...history, responseCards: [] }, true)} busy={false} run={run} />)
    expect(screen.queryByLabelText('Your response card')).toBeNull()
    expect((screen.getByRole('button', { name: 'Pass on version 2' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('retains the response chain and superseded public descriptions after settlement', () => {
    render(<CancellationPanel gameId="g" view={view({ ...history, cases: history.cases.map((c) => ({ ...c, outcome: 'cancelled' })) })} busy={false} run={run} />)
    expect(screen.getByText('Resolved disputes')).toBeTruthy()
    expect(screen.getByText(/Superseded later history/)).toBeTruthy()
    expect(screen.getByText('Bob drew a card')).toBeTruthy()
    expect(screen.getByText(/Bob: Mark Twain/)).toBeTruthy()
  })

  it('opens a case from a playable card and disables a target removed by a live refresh', async () => {
    const ownHistory = { ...history, cases: [], responseCards: [{
      itemId: 'twain', name: 'Mark Twain', targets: [{ logId: 'log', text: 'Alice devoted a city', blocked: null }], responses: [],
    }] }
    const send = vi.spyOn(api, 'cancellation').mockResolvedValue(view())
    const rendered = render(<CancellationCardControl gameId="g" view={view(ownHistory)} busy={false} run={run} itemId="twain" />)
    fireEvent.change(screen.getByLabelText('Action to cancel'), { target: { value: 'log' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open cancellation' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith('g', { kind: 'open', itemId: 'twain', logId: 'log' }, 12, expect.any(String)))
    rendered.rerender(<CancellationCardControl gameId="g" view={view({ ...ownHistory, responseCards: [] })} busy={false} run={run} itemId="twain" />)
    expect((screen.getByRole('button', { name: 'Open cancellation' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('removes stale response selections after a new version and displays King’s keep-Twain outcome', () => {
    const rendered = render(<CancellationPanel gameId="g" view={view()} busy={false} run={run} />)
    fireEvent.change(screen.getByLabelText('Your response card'), { target: { value: 'king' } })
    fireEvent.change(screen.getByLabelText('Response target'), { target: { value: 'original' } })
    const original = history.cases[0]
    if (original === undefined) throw new Error('missing fixture')
    rendered.rerender(<CancellationPanel gameId="g" view={view({ ...history, responseCards: [], cases: [{
      ...original, version: 3, passes: [], reactions: [...original.reactions, {
        id: 'king', playerId: 'a', targetId: null, name: 'Dr. Martin Luther King', protection: true,
      }],
    }] })} busy={false} run={run} />)
    expect((screen.getByRole('button', { name: 'Respond' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/protection \(Twain stays in hand\)/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pass on version 3' })).toBeTruthy()
  })
})
