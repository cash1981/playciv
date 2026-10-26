// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

const noEstimate = { current: 0, cities: 0, collected: false, ceiling: 27, total: 0, set: true }

const seat = (username: string, playernumber: number, overrides: Record<string, unknown> = {}) => ({
  playerId: `id-${username}`,
  username,
  color: null,
  civilization: null,
  playernumber,
  yourTurn: false,
  stats: { trade: 5 },
  cities: [],
  tradeEstimate: noEstimate,
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
    activeTurn: { turnNumber: 4, waitingFor: [] },
    opponents: options.opponents ?? [seat('Bob', 2, { color: 'Blue' })],
    tradeOffers: options.tradeOffers ?? [],
  } as unknown as PlayerView
}

const tradeOffer = (overrides: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  senderId: 'id-Alice',
  senderUsername: 'Alice',
  recipientIds: ['id-Bob'],
  recipientUsernames: ['Bob'],
  open: false,
  responses: [],
  chosenId: null,
  chosenUsername: null,
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


afterEach(() => {
  try {
    localStorage.clear()
  } catch {
    // nothing to clear
  }
})

describe('the Trade box', () => {
  const renderBox = (view: PlayerView, readOnly = false) =>
    render(<TradeCollected gameId="game" view={view} busy={false} readOnly={readOnly} run={run} />)
  const city = (pieceId: string, label: string, outskirts: number, squares: readonly [string, number][] = []) => ({
    pieceId,
    label,
    trade: {
      outskirts,
      detail: squares.map(([square, amount]) => ({ square, source: 'map icon', amount, blockaded: false })),
      notes: ['Not a complete count: only the printed icons.'],
    },
  })
  const estimateOf = (overrides: Record<string, unknown> = {}) => ({
    current: 5, cities: 5, collected: false, ceiling: 27, total: 10, set: false, ...overrides,
  })
  /** Trade 5 in the status panel and not set this turn, with a guess of 10 from the current trade and the cities. */
  const guessing = (extra: Record<string, unknown> = {}, estimate: Record<string, unknown> = {}) =>
    makeView({
      you: seat('Alice', 1, {
        tradeEstimate: estimateOf(estimate),
        cities: [city('a', 'Capital B2', 3, [['A1', 1], ['A2', 1], ['A3', 1]]), city('b', 'City F6', 2)],
        ...extra,
      }),
    })
  const box = (): HTMLInputElement => screen.getByLabelText('Trade') as HTMLInputElement

  it('is one Trade number, with no estimate line and no Add button', () => {
    renderBox(guessing())
    expect(box()).toBeTruthy()
    expect(screen.queryByText(/Estimate for this phase/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull()
  })

  it('starts from the guess while the trade is not set this turn, and says it is not saved yet', () => {
    renderBox(guessing())
    expect(box().value).toBe('10')
    expect(screen.getByText('Not saved yet')).toBeTruthy()
    expect(setPlayerStat).not.toHaveBeenCalled()
  })

  it('saves the guess when the field is left, then shows the saved number', async () => {
    const { rerender } = renderBox(guessing())
    fireEvent.blur(box())
    expect(setPlayerStat).toHaveBeenCalledWith('game', 'id-Alice', 'trade', 10)
    // the game now holds 10 and knows it was set
    await act(async () => {
      rerender(<TradeCollected gameId="game" view={guessing({ stats: { trade: 10 } }, { set: true })} busy={false} readOnly={false} run={run} />)
    })
    expect(box().value).toBe('10')
    expect(screen.queryByText('Not saved yet')).toBeNull()
  })

  it('sends a number the game already holds when it was not set this turn, so it counts as set', () => {
    renderBox(guessing({ stats: { trade: 10 } }))
    fireEvent.blur(box())
    expect(setPlayerStat).toHaveBeenCalledWith('game', 'id-Alice', 'trade', 10)
  })

  it('says it is not saved yet when the guess equals the number but the trade has not been set', () => {
    renderBox(guessing({ stats: { trade: 10 } }))
    expect(screen.getByText('Not saved yet')).toBeTruthy()
  })

  it('Escape puts the guess back and saves nothing', () => {
    renderBox(guessing())
    fireEvent.change(box(), { target: { value: '12' } })
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(box().value).toBe('10')
    expect(setPlayerStat).not.toHaveBeenCalled()
  })

  it('saves what the viewer types instead of the guess', () => {
    renderBox(guessing())
    fireEvent.change(box(), { target: { value: '12' } })
    fireEvent.blur(box())
    expect(setPlayerStat).toHaveBeenCalledWith('game', 'id-Alice', 'trade', 12)
  })

  it('shows the saved number, not the guess, once the trade is set this turn, wherever it was set', () => {
    renderBox(guessing({}, { set: true }))
    expect(box().value).toBe('5')
    expect(screen.queryByText('Not saved yet')).toBeNull()
    // leaving the field without a change saves nothing, so a number set in the Status panel is never overwritten
    fireEvent.blur(box())
    expect(setPlayerStat).not.toHaveBeenCalled()
  })

  it('follows a number changed elsewhere while the viewer is not typing', async () => {
    const { rerender } = renderBox(guessing({}, { set: true }))
    await act(async () => {
      rerender(<TradeCollected gameId="game" view={guessing({ stats: { trade: 12 } }, { set: true })} busy={false} readOnly={false} run={run} />)
    })
    expect(box().value).toBe('12')
  })

  it('keeps what was typed when the save fails, and still says it is not saved', async () => {
    setPlayerStat.mockRejectedValueOnce(new Error('network down'))
    render(<TradeCollected gameId="game" view={guessing()} busy={false} readOnly={false} run={quietRun} />)
    fireEvent.change(box(), { target: { value: '12' } })
    await act(async () => { fireEvent.blur(box()) })
    expect(box().value).toBe('12')
    expect(screen.getByText('Not saved yet')).toBeTruthy()
  })

  it('does not save an invalid number or one above the trade track, and goes back to what it was', () => {
    renderBox(guessing())
    for (const bad of ['x', '-1', '1.5', '28']) {
      fireEvent.change(box(), { target: { value: bad } })
      fireEvent.blur(box())
    }
    expect(setPlayerStat).not.toHaveBeenCalled()
    expect(box().value).toBe('10')
  })

  it('stops at 25 for the Japanese', () => {
    renderBox(guessing({}, { ceiling: 25, total: 5 }))
    fireEvent.change(box(), { target: { value: '26' } })
    fireEvent.blur(box())
    expect(setPlayerStat).not.toHaveBeenCalled()
    fireEvent.change(box(), { target: { value: '25' } })
    fireEvent.blur(box())
    expect(setPlayerStat).toHaveBeenCalledWith('game', 'id-Alice', 'trade', 25)
  })

  it('is read-only while replaying', () => {
    renderBox(guessing(), true)
    expect(box().disabled).toBe(true)
  })

  it('explains the guess behind a ?, with each part, each city and the notes once', () => {
    renderBox(guessing())
    fireEvent.click(screen.getByRole('button', { name: 'Help: How the trade is guessed' }))
    expect(screen.getByText('Trade so far: 5')).toBeTruthy()
    expect(screen.getByText('Trade around your cities: 5')).toBeTruthy()
    expect(screen.getByText('Guess: 10, at most 27')).toBeTruthy()
    expect(screen.getByText('Capital B2: 3 (A1 1, A2 1, A3 1)')).toBeTruthy()
    expect(screen.getByText('City F6: 2')).toBeTruthy()
    expect(screen.getAllByText('Not a complete count: only the printed icons.')).toHaveLength(1)
  })

  it('shows the collected trade and says the cities are not counted again', () => {
    renderBox(guessing({ stats: { trade: 9 } }, { current: 4, collected: true, total: 9, set: true }))
    expect(box().value).toBe('9')
    expect(screen.queryByText('Not saved yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: How the trade was counted' }))
    expect(screen.getByText('Trade so far: 4')).toBeTruthy()
    expect(screen.getByText('Trade around your cities: 5')).toBeTruthy()
    expect(screen.getByText('Collected: 9, at most 27')).toBeTruthy()
    expect(screen.getByText(/does not count it again/)).toBeTruthy()
  })

  it('draws nothing for a viewer who is not a player', () => {
    const { container } = renderBox(makeView({ you: null }))
    expect(container.textContent).toBe('')
  })
})

describe('trade offers', () => {
  /** The panel is folded until there is a deal; this opens it. */
  const unfold = async (): Promise<void> => {
    await click(screen.getByRole('button', { name: /Trade offers/ }))
  }
  const pick = async (name: string): Promise<void> => {
    await click(screen.getByLabelText(name))
  }

  describe('folding', () => {
    it('is folded away when there is no deal this turn, and says so', async () => {
      await renderPanel(makeView())
      const toggle = screen.getByRole('button', { name: /Trade offers/ })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.textContent).toContain('Turn 4 · no deals')
      await unfold()
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
    })

    it('is open when there is a deal this turn', async () => {
      await renderPanel(makeView({ tradeOffers: [tradeOffer()] }))
      expect(screen.getByRole('button', { name: /Trade offers/ }).getAttribute('aria-expanded')).toBe('true')
    })

    it('opens by itself when the first deal of the turn arrives', async () => {
      const { rerender } = await renderPanel(makeView())
      await act(async () => {
        rerender(<TradeOffers gameId="game" view={makeView({ tradeOffers: [tradeOffer()] })} busy={false} readOnly={false} run={run} />)
      })
      expect(screen.getByRole('button', { name: /Trade offers/ }).getAttribute('aria-expanded')).toBe('true')
    })

    it('folds again when a new turn starts without a deal', async () => {
      const { rerender } = await renderPanel(makeView({ tradeOffers: [tradeOffer()] }))
      expect(screen.getByRole('button', { name: /Trade offers/ }).getAttribute('aria-expanded')).toBe('true')
      await act(async () => {
        rerender(
          <TradeOffers
            gameId="game"
            view={{ ...makeView({ tradeOffers: [tradeOffer()] }), activeTurn: { turnNumber: 5, waitingFor: [] } } as unknown as PlayerView}
            busy={false}
            readOnly={false}
            run={run}
          />,
        )
      })
      const toggle = screen.getByRole('button', { name: /Trade offers/ })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.textContent).toContain('Turn 5 · no deals')
    })

    it('shows only the deals of this turn, however many are accepted from before', async () => {
      await renderPanel(
        makeView({
          tradeOffers: [
            tradeOffer({ id: 'old', terms: 'last turn wheat', turnNumber: 3, status: 'accepted' }),
            tradeOffer({ id: 'now', terms: 'this turn silk', turnNumber: 4 }),
          ],
        }),
      )
      expect(screen.queryByText('last turn wheat')).toBeNull()
      expect(screen.getByText('this turn silk')).toBeTruthy()
    })
  })

  it('explains that accepting records agreement but does not transfer resources', async () => {
    await renderPanel(makeView())
    await unfold()
    const note = screen.getByText(/Accepting records that you agreed to the terms/i).textContent
    expect(note).toContain('It does not transfer resources')
    expect(note).toContain('legal trade window')
  })

  it('submits free-text terms to the chosen player and clears the draft after success', async () => {
    await renderPanel(makeView())
    await unfold()
    await pick('Bob')
    await type('Terms', ' two trade for one wheat ')
    await click(screen.getByRole('button', { name: 'Send offer' }))

    expect(sendTradeOffer).toHaveBeenCalledWith('game', { recipientIds: ['id-Bob'] }, 'two trade for one wheat', expect.any(String), 17)
    expect((screen.getByLabelText('Terms') as HTMLTextAreaElement).value).toBe('')
  })

  it('needs a recipient and some terms before it sends', async () => {
    await renderPanel(makeView())
    await unfold()
    await type('Terms', 'two trade')
    expect((screen.getByRole('button', { name: 'Send offer' }) as HTMLButtonElement).disabled).toBe(true)
    await pick('Bob')
    expect((screen.getByRole('button', { name: 'Send offer' }) as HTMLButtonElement).disabled).toBe(false)
    await type('Terms', '   ')
    expect((screen.getByRole('button', { name: 'Send offer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends one deal to two of three players', async () => {
    await renderPanel(
      makeView({ opponents: [seat('Bob', 2), seat('Chul', 3), seat('Itchi', 4)] }),
    )
    await unfold()
    await pick('Bob')
    await pick('Itchi')
    await type('Terms', 'two trade for a wheat')
    await click(screen.getByRole('button', { name: 'Send offer' }))
    expect(sendTradeOffer).toHaveBeenCalledWith('game', { recipientIds: ['id-Bob', 'id-Itchi'] }, 'two trade for a wheat', expect.any(String), 17)
  })

  it('sends an open deal to everyone, and then the players cannot be picked one by one', async () => {
    await renderPanel(makeView({ opponents: [seat('Bob', 2), seat('Chul', 3)] }))
    await unfold()
    await pick('Everyone (an open deal)')
    expect((screen.getByLabelText('Bob') as HTMLInputElement).disabled).toBe(true)
    await type('Terms', 'a wheat for anything')
    await click(screen.getByRole('button', { name: 'Send offer' }))
    expect(sendTradeOffer).toHaveBeenCalledWith('game', { open: true }, 'a wheat for anything', expect.any(String), 17)
  })

  it('keeps an unsent draft when the view refreshes', async () => {
    const { rerender } = await renderPanel(makeView())
    await unfold()
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
    expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'withdraw', expect.any(String), 17, undefined)

    cleanup()
    await renderPanel(bobView())
    await click(screen.getByRole('button', { name: 'Accept' }))
    expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'accept', expect.any(String), 17, undefined)

    cleanup()
    await renderPanel(bobView())
    await click(screen.getByRole('button', { name: 'Decline' }))
    expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'decline', expect.any(String), 17, undefined)
  })

  it('sends a linked counteroffer from the intended offer row', async () => {
    await renderPanel(bobView())
    await click(screen.getByRole('button', { name: 'Counter' }))
    await type('Counteroffer terms', 'one trade for two wheat')
    await click(screen.getByRole('button', { name: 'Send counteroffer' }))

    expect(counterTradeOffer).toHaveBeenCalledWith('game', 'offer-1', 'one trade for two wheat', expect.any(String), 17)
  })

  describe('a deal that went to several players', () => {
    const several = (overrides: Record<string, unknown> = {}) =>
      tradeOffer({
        recipientIds: ['id-Bob', 'id-Chul'],
        recipientUsernames: ['Bob', 'Chul'],
        ...overrides,
      })
    const chulView = (offer: Record<string, unknown>): PlayerView =>
      makeView({
        you: seat('Chul', 3, { playerTurns: [] }),
        opponents: [seat('Alice', 1), seat('Bob', 2)],
        tradeOffers: [offer],
      })

    it('names everyone it went to, or everyone for an open deal', async () => {
      await renderPanel(makeView({ tradeOffers: [several()] }))
      expect(screen.getByText('Offer · Alice → Bob and Chul')).toBeTruthy()
      cleanup()
      await renderPanel(makeView({ tradeOffers: [tradeOffer({ open: true, recipientIds: ['id-Bob', 'id-Chul'], recipientUsernames: ['Bob', 'Chul'] })] }))
      expect(screen.getByText('Offer · Alice → everyone')).toBeTruthy()
      expect(screen.getByRole('region', { name: 'Open deal from Alice' })).toBeTruthy()
    })

    it('lets a recipient accept, which only says they would, and shows what they answered', async () => {
      await renderPanel(chulView(several()))
      const accept = screen.getByRole('button', { name: 'Accept' })
      expect(accept.getAttribute('title')).toContain('The sender chooses')
      await click(accept)
      expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'accept', expect.any(String), 17, undefined)

      cleanup()
      await renderPanel(chulView(several({ responses: [{ playerId: 'id-Chul', username: 'Chul', action: 'accept' }] })))
      expect(screen.getByText('You accepted')).toBeTruthy()
      expect(screen.getByText('Chul accepted')).toBeTruthy()
    })

    it('gives the sender a Choose button for each player who accepted, and none for one who declined', async () => {
      await renderPanel(
        makeView({
          opponents: [seat('Bob', 2), seat('Chul', 3)],
          tradeOffers: [
            several({
              responses: [
                { playerId: 'id-Bob', username: 'Bob', action: 'decline' },
                { playerId: 'id-Chul', username: 'Chul', action: 'accept' },
              ],
            }),
          ],
        }),
      )
      expect(screen.queryByRole('button', { name: 'Choose Bob' })).toBeNull()
      await click(screen.getByRole('button', { name: 'Choose Chul' }))
      expect(transitionTradeOffer).toHaveBeenLastCalledWith('game', 'offer-1', 'choose', expect.any(String), 17, 'id-Chul')
    })

    it('offers no Choose for a player who has left the game', async () => {
      await renderPanel(
        makeView({
          opponents: [seat('Bob', 2)],
          tradeOffers: [
            several({
              responses: [
                { playerId: 'id-Bob', username: 'Bob', action: 'accept' },
                { playerId: 'id-Chul', username: 'id-Chul', action: 'accept' },
              ],
            }),
          ],
        }),
      )
      expect(screen.getByRole('button', { name: 'Choose Bob' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Choose id-Chul/ })).toBeNull()
    })

    it('says who the deal was made with, once it is', async () => {
      await renderPanel(makeView({ tradeOffers: [several({ status: 'accepted', chosenId: 'id-Chul', chosenUsername: 'Chul' })] }))
      expect(screen.getByText('Made with Chul')).toBeTruthy()
      expect(screen.queryByRole('button', { name: /^Choose / })).toBeNull()
    })
  })

  it('treats an open deal with a single recipient as a plain offer: Accept makes the deal, no Choose', async () => {
    await renderPanel(
      makeView({
        you: seat('Bob', 2, { playerTurns: [] }),
        opponents: [seat('Alice', 1)],
        tradeOffers: [tradeOffer({ open: true })],
      }),
    )
    expect(screen.getByRole('button', { name: 'Accept' }).getAttribute('title')).toBe('Agree to the terms')
    cleanup()
    await renderPanel(makeView({ tradeOffers: [tradeOffer({ open: true, responses: [{ playerId: 'id-Bob', username: 'Bob', action: 'accept' }] })] }))
    expect(screen.queryByRole('button', { name: /^Choose / })).toBeNull()
  })

  it('shows a counteroffer in the thread of the offer it answers', async () => {
    await renderPanel(
      makeView({
        tradeOffers: [
          tradeOffer({ status: 'countered' }),
          tradeOffer({
            id: 'offer-2',
            senderId: 'id-Bob',
            senderUsername: 'Bob',
            recipientIds: ['id-Alice'],
            recipientUsernames: ['Alice'],
            terms: 'one trade for two wheat',
            parentOfferId: 'offer-1',
          }),
          tradeOffer({ id: 'offer-3', terms: 'a separate deal with Chul', recipientIds: ['id-Chul'], recipientUsernames: ['Chul'] }),
        ],
      }),
    )
    const threads = screen.getAllByRole('region')
    expect(threads).toHaveLength(2)
    expect(within(threads[0]!).getByText('Counteroffer · Bob → Alice')).toBeTruthy()
    expect(within(threads[1]!).getByText('a separate deal with Chul')).toBeTruthy()
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
      await unfold()
      await pick('Bob')
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
      await unfold()
      await pick('Bob')
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
    await unfold()
    await pick('Bob')
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
