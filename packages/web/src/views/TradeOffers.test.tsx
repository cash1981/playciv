// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { TradeCollected, TradeOffers } from './TradeOffers.js'

vi.mock('../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api.js')>()),
  api: {
    sendTradeOffer: vi.fn(),
    transitionTradeOffer: vi.fn(),
    counterTradeOffer: vi.fn(),
    setPlayerStat: vi.fn(),
  },
}))

const sendTradeOffer = vi.mocked(api.sendTradeOffer)
const transitionTradeOffer = vi.mocked(api.transitionTradeOffer)
const counterTradeOffer = vi.mocked(api.counterTradeOffer)
const setPlayerStat = vi.mocked(api.setPlayerStat)

const run = async (action: () => Promise<unknown>): Promise<void> => {
  await action()
}

/** Like the game page's run: a failed request is shown there, not thrown at the panel. */
const quietRun = async (action: () => Promise<unknown>): Promise<void> => {
  try {
    await action()
  } catch {
    // the page shows the error
  }
}

const seat = (username: string, playernumber: number, overrides: Record<string, unknown> = {}) => ({
  playerId: `id-${username}`,
  username,
  color: null,
  civilization: null,
  playernumber,
  yourTurn: false,
  stats: { trade: 5 },
  ...overrides,
})

interface ViewOptions {
  readonly you?: Record<string, unknown> | null
  readonly opponents?: readonly Record<string, unknown>[]
  readonly tradeOffers?: readonly Record<string, unknown>[]
}

function makeView(options: ViewOptions = {}): PlayerView {
  return {
    rev: 17,
    you: options.you === undefined ? seat('Alice', 1) : options.you,
    opponents: options.opponents ?? [seat('Bob', 2, { color: 'Blue' })],
    tradeOffers: options.tradeOffers ?? [],
  } as unknown as PlayerView
}

const tradeOffer = (overrides: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  senderId: 'id-Alice',
  senderUsername: 'Alice',
  recipientId: 'id-Bob',
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

async function renderPanel(
  view: PlayerView,
  props: { readOnly?: boolean; run?: typeof run } = {},
): Promise<ReturnType<typeof render>> {
  let result: ReturnType<typeof render> | undefined
  await act(async () => {
    result = render(
      <TradeOffers gameId="game" view={view} busy={false} readOnly={props.readOnly ?? false} run={props.run ?? run} />,
    )
  })
  if (result === undefined) throw new Error('panel did not render')
  return result
}

const click = async (element: HTMLElement): Promise<void> => {
  await act(async () => { fireEvent.click(element) })
}

const type = async (label: string, text: string): Promise<void> => {
  await act(async () => { fireEvent.change(screen.getByLabelText(label), { target: { value: text } }) })
}

beforeEach(() => {
  sendTradeOffer.mockResolvedValue(makeView())
  transitionTradeOffer.mockResolvedValue(makeView())
  counterTradeOffer.mockResolvedValue(makeView())
  setPlayerStat.mockResolvedValue(makeView())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('trade around your cities', () => {
  const renderBox = (view: PlayerView, readOnly = false) =>
    render(<TradeCollected gameId="game" view={view} busy={false} readOnly={readOnly} run={run} />)

  it('shows the Status panel trade and writes a new number to it', () => {
    renderBox(makeView())
    const box = screen.getByLabelText('Trade around your cities') as HTMLInputElement
    expect(box.value).toBe('5')
    fireEvent.change(box, { target: { value: '8' } })
    fireEvent.blur(box)
    expect(setPlayerStat).toHaveBeenCalledWith('game', 'id-Alice', 'trade', 8)
  })

  it('does not save an unchanged or invalid number', () => {
    renderBox(makeView())
    const box = screen.getByLabelText('Trade around your cities') as HTMLInputElement
    fireEvent.blur(box)
    fireEvent.change(box, { target: { value: 'x' } })
    fireEvent.blur(box)
    expect(setPlayerStat).not.toHaveBeenCalled()
    expect(box.value).toBe('5')
  })

  it('is read-only while replaying', () => {
    renderBox(makeView(), true)
    expect((screen.getByLabelText('Trade around your cities') as HTMLInputElement).disabled).toBe(true)
  })
})

describe('trade offers', () => {
  it('explains that accepting records agreement but does not transfer resources', async () => {
    await renderPanel(makeView())
    const note = screen.getByText(/Accepting records that you agreed to the terms/i).textContent
    expect(note).toContain('It does not transfer resources')
    expect(note).toContain('legal trade window')
  })

  it('submits free-text terms and clears the draft after success', async () => {
    await renderPanel(makeView())
    await type('Terms', ' two trade for one wheat ')
    await click(screen.getByRole('button', { name: 'Send offer' }))

    expect(sendTradeOffer).toHaveBeenCalledWith('game', 'id-Bob', 'two trade for one wheat', expect.any(String), 17)
    expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps an unsent draft when the view refreshes', async () => {
    const { rerender } = await renderPanel(makeView())
    await type('Terms', 'save this draft')

    await act(async () => {
      rerender(
        <TradeOffers gameId="game" view={{ ...makeView(), rev: 18 }} busy={false} readOnly={false} run={run} />,
      )
    })

    expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe('save this draft')
  })

  it('shows acceptance only for the recipient and withdrawal only for the sender', async () => {
    await renderPanel(makeView({ tradeOffers: [tradeOffer()] }))
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()

    cleanup()
    await renderPanel(makeView({
      you: seat('Bob', 2, { playerTurns: [] }),
      opponents: [seat('Alice', 1)],
      tradeOffers: [tradeOffer()],
    }))
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Counter' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
  })

  it('routes accept, decline, and withdraw with the selected offer and revision', async () => {
    await renderPanel(makeView({ tradeOffers: [tradeOffer()] }))
    await click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'withdraw', expect.any(String), 17)

    cleanup()
    await renderPanel(makeView({
      you: seat('Bob', 2, { playerTurns: [] }),
      opponents: [seat('Alice', 1)],
      tradeOffers: [tradeOffer()],
    }))
    await click(screen.getByRole('button', { name: 'Accept' }))
    expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'accept', expect.any(String), 17)

    cleanup()
    await renderPanel(makeView({
      you: seat('Bob', 2, { playerTurns: [] }),
      opponents: [seat('Alice', 1)],
      tradeOffers: [tradeOffer()],
    }))
    await click(screen.getByRole('button', { name: 'Decline' }))
    expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'decline', expect.any(String), 17)
  })

  it('sends a linked counteroffer from the intended offer row', async () => {
    await renderPanel(makeView({
      you: seat('Bob', 2, { playerTurns: [] }),
      opponents: [seat('Alice', 1)],
      tradeOffers: [tradeOffer()],
    }))
    await click(screen.getByRole('button', { name: 'Counter' }))
    await type('Counteroffer terms', 'one trade for two wheat')
    await click(screen.getByRole('button', { name: 'Send counteroffer' }))

    expect(counterTradeOffer).toHaveBeenCalledWith('game', 'offer-1', 'one trade for two wheat', expect.any(String), 17)
  })

  const bobView = (): PlayerView => makeView({
    you: seat('Bob', 2, { playerTurns: [] }),
    opponents: [seat('Alice', 1)],
    tradeOffers: [tradeOffer()],
  })

  describe('after a response that never arrived', () => {
    const sendButton = (): HTMLElement => screen.getByRole('button', { name: 'Send offer' })
    const terms = (): string => (screen.getByLabelText('Terms') as HTMLTextAreaElement).value

    it('sends the same offer again with the same request id, and keeps the draft meanwhile', async () => {
      sendTradeOffer.mockRejectedValueOnce(new Error('network down'))
      await renderPanel(makeView(), { run: quietRun })
      await type('Terms', 'two trade for one wheat')
      await click(sendButton())
      // The player cannot tell whether the offer arrived, so the words stay
      expect(terms()).toBe('two trade for one wheat')
      await click(sendButton())

      expect(sendTradeOffer).toHaveBeenCalledTimes(2)
      expect(sendTradeOffer.mock.calls[1]?.[3]).toBe(sendTradeOffer.mock.calls[0]?.[3])
      expect(terms()).toBe('')

      // The same words once the first offer is settled make a new offer
      await type('Terms', 'two trade for one wheat')
      await click(sendButton())
      expect(sendTradeOffer).toHaveBeenCalledTimes(3)
      expect(sendTradeOffer.mock.calls[2]?.[3]).not.toBe(sendTradeOffer.mock.calls[0]?.[3])
    })

    it('uses a new request id when the words were changed after the failed send', async () => {
      sendTradeOffer.mockRejectedValueOnce(new Error('network down'))
      await renderPanel(makeView(), { run: quietRun })
      await type('Terms', 'two trade for one wheat')
      await click(sendButton())
      await type('Terms', 'three trade for one wheat')
      await click(sendButton())

      expect(sendTradeOffer).toHaveBeenCalledTimes(2)
      expect(sendTradeOffer.mock.calls[1]?.[3]).not.toBe(sendTradeOffer.mock.calls[0]?.[3])
    })

    it('reuses the request id of an Accept that is pressed again', async () => {
      transitionTradeOffer.mockRejectedValueOnce(new Error('network down'))
      await renderPanel(bobView(), { run: quietRun })
      await click(screen.getByRole('button', { name: 'Accept' }))
      await click(screen.getByRole('button', { name: 'Accept' }))

      expect(transitionTradeOffer).toHaveBeenCalledTimes(2)
      expect(transitionTradeOffer.mock.calls[1]?.[3]).toBe(transitionTradeOffer.mock.calls[0]?.[3])
    })

    it('reuses the request id of a counteroffer that is sent again', async () => {
      counterTradeOffer.mockRejectedValueOnce(new Error('network down'))
      await renderPanel(bobView(), { run: quietRun })
      await click(screen.getByRole('button', { name: 'Counter' }))
      await type('Counteroffer terms', 'one trade for two wheat')
      await click(screen.getByRole('button', { name: 'Send counteroffer' }))
      await click(screen.getByRole('button', { name: 'Send counteroffer' }))

      expect(counterTradeOffer).toHaveBeenCalledTimes(2)
      expect(counterTradeOffer.mock.calls[1]?.[3]).toBe(counterTradeOffer.mock.calls[0]?.[3])
    })
  })

  it('keeps what was typed while the offer was on its way, and clears what was sent', async () => {
    let arrive: (() => void) | undefined
    sendTradeOffer.mockImplementationOnce(() => new Promise((resolve) => { arrive = () => resolve(makeView()) }))
    await renderPanel(makeView())
    await type('Terms', 'first words')
    await click(screen.getByRole('button', { name: 'Send offer' }))
    expect(sendTradeOffer).toHaveBeenCalledTimes(1)
    await type('Terms', 'first words and then more')
    expect(arrive).toBeDefined()
    await act(async () => { arrive?.() })

    expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe('first words and then more')
  })

  it('takes the counter form and the answer buttons away once the viewer can no longer write', async () => {
    const { rerender } = await renderPanel(bobView())
    await click(screen.getByRole('button', { name: 'Counter' }))
    await type('Counteroffer terms', 'one trade for two wheat')

    await act(async () => {
      rerender(
        <TradeOffers gameId="game" view={bobView()} busy={false} readOnly run={run} />,
      )
    })

    expect(screen.queryByLabelText('Counteroffer terms')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send counteroffer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})
