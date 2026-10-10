// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { TradeOffersPanel } from './TradeOffersPanel.js'

vi.mock('../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.js')>()),
  api: {
    sendTradeOffer: vi.fn(),
    transitionTradeOffer: vi.fn(),
    counterTradeOffer: vi.fn(),
  },
}))

const sendTradeOffer = vi.mocked(api.sendTradeOffer)
const transitionTradeOffer = vi.mocked(api.transitionTradeOffer)
const counterTradeOffer = vi.mocked(api.counterTradeOffer)

const seat = (playerId: string, username: string, playernumber: number) => ({
  playerId,
  username,
  color: null,
  civilization: null,
  playernumber,
  yourTurn: false,
  playerTurns: [],
})

const offer = (overrides: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  senderId: 'alice',
  senderUsername: 'Alice',
  recipientId: 'bob',
  recipientUsername: 'Bob',
  terms: 'two trade for one wheat',
  turnNumber: 4,
  phase: 'TRADE',
  status: 'pending',
  parentOfferId: null,
  createdAt: null,
  resolvedAt: null,
  logId: 'log-1',
  ...overrides,
})

const view = (overrides: Record<string, unknown> = {}): PlayerView => ({
  rev: 17,
  you: seat('alice', 'Alice', 1),
  opponents: [seat('bob', 'Bob', 2)],
  tradeOffers: [],
  ...overrides,
} as unknown as PlayerView)

const run = async (action: () => Promise<unknown>): Promise<void> => { await action() }

beforeEach(() => {
  localStorage.removeItem('civ.panel.trade-offers')
  sendTradeOffer.mockResolvedValue(view())
  transitionTradeOffer.mockResolvedValue(view())
  counterTradeOffer.mockResolvedValue(view())
})

afterEach(() => cleanup())

describe('TradeOffersPanel', () => {
  it('keeps negotiation in its own section and submits an offer', async () => {
    render(<TradeOffersPanel gameId="game" view={view()} busy={false} readOnly={false} run={run} />)

    expect(screen.getByRole('heading', { name: 'Trade offers' })).toBeTruthy()
    expect(screen.getByText(/Acceptance records the agreement/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trade offers' }))
    fireEvent.change(screen.getByLabelText('Terms'), { target: { value: ' two trade for wheat ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send offer' }))

    expect(sendTradeOffer).toHaveBeenCalledWith('game', 'bob', 'two trade for wheat', expect.any(String), 17)
    await waitFor(() => expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe(''))
  })

  it('shows recipient controls and sends a counteroffer', async () => {
    render(<TradeOffersPanel gameId="game" view={view({
      you: seat('bob', 'Bob', 2),
      opponents: [seat('alice', 'Alice', 1)],
      tradeOffers: [offer()],
    })} busy={false} readOnly={false} run={run} />)

    fireEvent.click(screen.getByRole('button', { name: 'Counter' }))
    fireEvent.change(screen.getByLabelText('Counteroffer terms'), { target: { value: 'one trade for two wheat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send counteroffer' }))

    expect(counterTradeOffer).toHaveBeenCalledWith('game', 'offer-1', 'one trade for two wheat', expect.any(String), 17)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(transitionTradeOffer).toHaveBeenCalledWith('game', 'offer-1', 'accept', expect.any(String), 17)
  })

  it('routes decline and withdraw to the selected offer', async () => {
    render(<TradeOffersPanel gameId="game" view={view({
      you: seat('bob', 'Bob', 2),
      opponents: [seat('alice', 'Alice', 1)],
      tradeOffers: [offer()],
    })} busy={false} readOnly={false} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'decline', expect.any(String), 17)

    cleanup()
    render(<TradeOffersPanel gameId="game" view={view({ tradeOffers: [offer()] })} busy={false} readOnly={false} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'withdraw', expect.any(String), 17)
  })

  it('keeps an unsent offer draft when the view refreshes', async () => {
    const result = render(<TradeOffersPanel gameId="game" view={view()} busy={false} readOnly={false} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trade offers' }))
    fireEvent.change(screen.getByLabelText('Terms'), { target: { value: 'save this draft' } })

    await act(async () => {
      result.rerender(<TradeOffersPanel gameId="game" view={view({ rev: 18 })} busy={false} readOnly={false} run={run} />)
    })

    expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe('save this draft')
  })

  it('does not offer editing controls to a spectator', () => {
    render(<TradeOffersPanel gameId="game" view={view({ you: null, tradeOffers: [offer()] })} busy={false} readOnly run={run} />
      )
    expect(screen.getByText('two trade for one wheat')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send offer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})
