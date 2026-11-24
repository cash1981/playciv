// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { MapPickerContext } from './mapPick.js'
import type { MapPicker } from './mapPick.js'
import { goToPanel } from './PhaseSummary.js'
import { SetupPanel } from './SetupPanel.js'

vi.mock('./PhaseSummary.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./PhaseSummary.js')>()),
  goToPanel: vi.fn(),
}))

beforeEach(() => {
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.mocked(goToPanel).mockClear()
})

type You = NonNullable<PlayerView['you']>
type Setup = NonNullable<You['setup']>
type Step = Setup['steps'][number]
type Item = Step['items'][number]

type PickCell = { column: number; row: number; label: string }
type PickRequest = { title: string; cells: readonly PickCell[]; describeCell?: (cell: PickCell) => string }

/** A board picker whose picks the test answers: `pick(label)` taps a square, `escape()` is Escape on the board. */
function boardPicker() {
  const open: Array<(cell: PickCell | null) => void> = []
  const begin = vi.fn(
    (_request: PickRequest) =>
      new Promise<PickCell | null>((resolve) => {
        open.push(resolve)
      }),
  )
  const cancel = vi.fn(() => open.pop()?.(null))
  const picker = { begin, cancel } as unknown as MapPicker
  const request = (): PickRequest => {
    const last = begin.mock.calls.at(-1)?.[0]
    if (last === undefined) throw new Error('no pick is open')
    return last
  }
  return {
    picker,
    begin,
    cancel,
    request,
    labels: (): string[] => request().cells.map((cell) => cell.label),
    describe: (label: string): string => {
      const current = request()
      const cell = current.cells.find((candidate) => candidate.label === label)
      if (cell === undefined || current.describeCell === undefined) throw new Error(`no square ${label}`)
      return current.describeCell(cell)
    },
    pick: async (label: string) => {
      const cell = request().cells.find((candidate) => candidate.label === label)
      if (cell === undefined) throw new Error(`no square ${label}`)
      await act(async () => open.pop()?.(cell))
    },
    escape: () => act(async () => open.pop()?.(null)),
  }
}

const sq = (column: number, row: number, label: string, extra: Record<string, unknown> = {}) => ({ column, row, label, ...extra })

function stepOf(id: Step['id'], label: string, extra: Partial<Step> = {}): Step {
  return { id, label, status: 'todo', reason: '', squares: [], canUndo: false, undoReason: null, items: [], ...extra }
}

function itemOf(id: Item['id'], label: string, extra: Partial<Item> = {}): Item {
  return { id, label, status: 'todo', reason: `Place the ${id}.`, squares: [], canUndo: false, ...extra }
}

const CAPITAL_SQUARES = [sq(2, 2, 'C3'), sq(3, 2, 'D3'), sq(2, 3, 'C4')]

/** A Chinese player at the start: nothing placed, the capital can go on three squares. */
function chineseSteps(): Step[] {
  return [
    stepOf('capital', 'Capital', { reason: 'Place your walled capital on one of the four central squares of your starting tile.', squares: CAPITAL_SQUARES }),
    stepOf('figures', 'Figures', {
      status: 'blocked',
      reason: 'Place your capital first.',
      items: [
        itemOf('army', 'Army', { status: 'blocked', reason: 'Place your capital first.' }),
        itemOf('scout', 'Scout', { status: 'blocked', reason: 'Place your capital first.' }),
      ],
    }),
    stepOf('policy', 'Social policy', { reason: 'Choose your starting social policy in the Social policy panel.' }),
    stepOf('trade', 'Starting trade', { status: 'blocked', reason: 'Place your capital first.' }),
    stepOf('government', 'Government', { status: 'auto', reason: 'Chinese start with Despotism.' }),
  ]
}

const GATE = 'Finish your setup before Start of Turn can be marked done: still to do: capital, figures, social policy, starting trade. Open the Setup tab.'

function viewWith(steps: readonly Step[], blocksTurn: string | null = GATE, extra: Record<string, unknown> = {}): PlayerView {
  return {
    rev: 6,
    active: true,
    you: {
      playerId: 'me',
      username: 'Alice',
      stats: { trade: 1 },
      tradeEstimate: { current: 1, cities: 3, collected: false, ceiling: 27, total: 4, set: false },
      pendingRewards: [],
      setup: { steps, blocksTurn },
      ...extra,
    },
    opponents: [],
    activeTurn: null,
  } as unknown as PlayerView
}

const run: Run = async (action) => {
  try {
    await action()
  } catch {
    /* GameView shows the failure in the real app */
  }
}

function renderPanel(view: PlayerView, board = boardPicker(), props: { busy?: boolean; readOnly?: boolean } = {}) {
  const ui = (next: PlayerView, nextProps = props) => (
    <MapPickerContext.Provider value={board.picker}>
      <SetupPanel gameId="g1" view={next} busy={nextProps.busy ?? false} readOnly={nextProps.readOnly ?? false} run={run} />
    </MapPickerContext.Provider>
  )
  const result = render(ui(view))
  return { board, ...result, update: (next: PlayerView, nextProps?: { busy?: boolean; readOnly?: boolean }) => result.rerender(ui(next, nextProps)) }
}

const row = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-step="${id}"]`)
  if (found === null) throw new Error(`no row ${id}`)
  return found
}
/** The status tag in the head of the row itself, not of the figures inside it. */
const rowStatus = (id: string): string | null | undefined => row(id).querySelector(':scope > .setup-step-head .tag')?.textContent
const button = (name: RegExp | string, within_?: HTMLElement): HTMLButtonElement =>
  within(within_ ?? document.body).getByRole('button', { name }) as HTMLButtonElement

describe('the rows of the checklist', () => {
  it('has one row per step the engine lists, in its order, each with its status and reason', () => {
    renderPanel(viewWith(chineseSteps()))

    const names = [...document.querySelectorAll('.setup-step-name')].map((heading) => heading.textContent)
    expect(names).toEqual(['Capital', 'Figures', 'Social policy', 'Starting trade', 'Government'])
    expect(rowStatus('capital')).toBe('To do')
    expect(within(row('capital')).getByText(/walled capital on one of the four central squares/)).toBeTruthy()
    expect(rowStatus('figures')).toBe('Blocked')
    expect(rowStatus('trade')).toBe('Blocked')
    expect(rowStatus('policy')).toBe('To do')
    expect(rowStatus('government')).toBe('Automatic')
    expect(within(row('government')).getByText('Chinese start with Despotism.')).toBeTruthy()
  })

  it('lists each figure as an item of the figures row with its own status and reason', () => {
    renderPanel(
      viewWith([
        stepOf('figures', 'Figures', {
          items: [
            itemOf('army', 'Army', { status: 'done', reason: 'Army is on the map.', canUndo: true }),
            itemOf('scout', 'Scout', { squares: [sq(1, 1, 'B2')] }),
            itemOf('white', 'White army (Russians)', { status: 'blocked', reason: 'No square in the outskirts of your capital can take the white army.' }),
          ],
        }),
      ]),
    )

    const items = [...row('figures').querySelectorAll<HTMLElement>('[data-figure]')]
    expect(items.map((item) => item.dataset['figure'])).toEqual(['army', 'scout', 'white'])
    expect(within(items[0] as HTMLElement).getByText('Done')).toBeTruthy()
    expect(within(items[1] as HTMLElement).getByText('To do')).toBeTruthy()
    expect(within(items[2] as HTMLElement).getByText('Blocked')).toBeTruthy()
    expect(within(items[2] as HTMLElement).getByText(/No square in the outskirts/)).toBeTruthy()
    // A blocked figure cannot be placed; a done one is taken back, not placed
    expect(button('Place White army (Russians)', items[2]).disabled).toBe(true)
    expect(within(items[0] as HTMLElement).queryByRole('button', { name: /^Place/ })).toBeNull()
    expect(button('Undo Army', items[0]).disabled).toBe(false)
  })

  it('states why End turn is held back, or that setup is complete, in the summary', () => {
    const held = renderPanel(viewWith(chineseSteps()))
    expect(screen.getByRole('status').textContent).toBe(GATE)
    held.unmount()

    renderPanel(viewWith([stepOf('government', 'Government', { status: 'auto', reason: 'x' })], null))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/Setup is complete/)).toBeTruthy()
  })

  it('shows nothing for a player without a setup', () => {
    const view = viewWith(chineseSteps())
    const { container } = renderPanel({ ...view, you: { ...(view.you as You), setup: null } } as PlayerView)
    expect(container.textContent).toBe('')
  })

  it('disables every button while busy or read-only', () => {
    const busy = renderPanel(viewWith(chineseSteps()), boardPicker(), { busy: true })
    expect(button('Place capital').disabled).toBe(true)
    busy.unmount()
    renderPanel(viewWith(chineseSteps()), boardPicker(), { readOnly: true })
    expect(button('Place capital').disabled).toBe(true)
  })

  it('disables the pick buttons when the page has no map to pick on', () => {
    render(<SetupPanel gameId="g1" view={viewWith(chineseSteps())} busy={false} readOnly={false} run={run} />)
    expect(button('Place capital').disabled).toBe(true)
  })
})

describe('placing the capital on the map', () => {
  it('opens the map pick with the squares the engine lists and sends the square that is picked', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board } = renderPanel(viewWith(chineseSteps()))

    fireEvent.click(button('Place capital'))
    expect(board.begin).toHaveBeenCalledTimes(1)
    expect(board.request().title).toBe('your capital')
    expect(board.labels()).toEqual(['C3', 'D3', 'C4'])
    expect(board.describe('D3')).toBe('Place your capital on D3')
    // Nothing is sent by opening the pick
    expect(setup).not.toHaveBeenCalled()

    await board.pick('D3')

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    const [gameId, body, requestId, rev] = setup.mock.calls[0] ?? []
    expect(gameId).toBe('g1')
    expect(body).toEqual({ step: 'capital', column: 3, row: 2 })
    expect(typeof requestId).toBe('string')
    expect(rev).toBe(6)
  })

  it('sends nothing when the pick is cancelled, and the same button starts again', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board } = renderPanel(viewWith(chineseSteps()))

    fireEvent.click(button('Place capital'))
    await board.escape()

    expect(setup).not.toHaveBeenCalled()
    fireEvent.click(button('Place capital'))
    expect(board.begin).toHaveBeenCalledTimes(2)
  })

  it('offers Cancel pick while the map pick is open, and cancelling closes it', async () => {
    const { board } = renderPanel(viewWith(chineseSteps()))

    fireEvent.click(button('Place capital'))
    expect(screen.queryByRole('button', { name: 'Place capital' })).toBeNull()
    fireEvent.click(button('Cancel pick'))

    expect(board.cancel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(button('Place capital').disabled).toBe(false))
  })

  it('closes a pick that is still open when the panel goes away', () => {
    const { board, unmount } = renderPanel(viewWith(chineseSteps()))
    fireEvent.click(button('Place capital'))
    expect(board.cancel).not.toHaveBeenCalled()
    unmount()
    expect(board.cancel).toHaveBeenCalledTimes(1)
  })

  it('does not close a pick that has been answered when the panel goes away', async () => {
    vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board, unmount } = renderPanel(viewWith(chineseSteps()))
    fireEvent.click(button('Place capital'))
    await board.pick('C3')
    unmount()
    expect(board.cancel).not.toHaveBeenCalled()
  })

  it('checks the picked square against the current view: one that is gone is not sent', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board, update } = renderPanel(viewWith(chineseSteps()))

    fireEvent.click(button('Place capital'))
    // A refresh arrives while the pick is open: D3 is no longer a legal square
    const steps = chineseSteps()
    steps[0] = { ...(steps[0] as Step), squares: [sq(2, 2, 'C3')] }
    update(viewWith(steps))
    await board.pick('D3')

    expect(setup).not.toHaveBeenCalled()
    expect(screen.getByText('That square is no longer available. Pick again.')).toBeTruthy()
    // The button starts again; nothing reopened by itself
    expect(board.begin).toHaveBeenCalledTimes(1)
    expect(button('Place capital').disabled).toBe(false)
  })

  it('sends the revision of the latest view, not the one the pick was opened on', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board, update } = renderPanel(viewWith(chineseSteps()))

    fireEvent.click(button('Place capital'))
    update({ ...viewWith(chineseSteps()), rev: 9 } as PlayerView)
    await board.pick('C3')

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[3]).toBe(9)
  })

  it('sends nothing when the page became busy while the pick was open', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board, update } = renderPanel(viewWith(chineseSteps()))

    fireEvent.click(button('Place capital'))
    update(viewWith(chineseSteps()), { busy: true })
    await board.pick('C3')

    expect(setup).not.toHaveBeenCalled()
    expect(screen.getByText('The game was busy and the square was not sent. Pick again.')).toBeTruthy()
  })

  it('does not reopen the pick after a refused send, and the button is there to start again', async () => {
    const setup = vi.spyOn(api, 'setup').mockRejectedValue(new ApiError(409, 'SETUP_REFUSED', 'The capital cannot stand on C3.'))
    const { board } = renderPanel(viewWith(chineseSteps()))

    fireEvent.click(button('Place capital'))
    await board.pick('C3')
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))

    await waitFor(() => expect(button('Place capital').disabled).toBe(false))
    expect(board.begin).toHaveBeenCalledTimes(1)
    // A second try is a new press with a new pick, and the refused request id is spent
    fireEvent.click(button('Place capital'))
    await board.pick('C3')
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(2))
    expect(setup.mock.calls[1]?.[2]).not.toBe(setup.mock.calls[0]?.[2])
  })

  it('moves a placed capital: Move re-picks from the squares the engine lists and sends the new one', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const steps = chineseSteps()
    steps[0] = stepOf('capital', 'Capital', {
      status: 'done',
      reason: 'Your walled capital is on C3.',
      squares: [sq(3, 2, 'D3'), sq(2, 3, 'C4')],
      canUndo: true,
    })
    const { board } = renderPanel(viewWith(steps))

    expect(screen.queryByRole('button', { name: 'Place capital' })).toBeNull()
    fireEvent.click(button('Move capital'))
    expect(board.labels()).toEqual(['D3', 'C4'])
    expect(board.describe('C4')).toBe('Move your capital to C4')
    await board.pick('C4')

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ step: 'capital', column: 2, row: 3 })
  })

  it('takes the capital back with Undo, and says why it cannot while other steps need it', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const steps = chineseSteps()
    steps[0] = stepOf('capital', 'Capital', { status: 'done', reason: 'Your walled capital is on C3.', canUndo: true })
    const free = renderPanel(viewWith(steps))
    fireEvent.click(button('Undo capital'))
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ undo: true, step: 'capital' })
    free.unmount()

    const held = chineseSteps()
    held[0] = stepOf('capital', 'Capital', {
      status: 'done',
      reason: 'Your walled capital is on C3.',
      canUndo: false,
      undoReason: 'Take back the figures first.',
    })
    renderPanel(viewWith(held))
    expect(screen.queryByRole('button', { name: 'Undo capital' })).toBeNull()
    expect(within(row('capital')).getByText('Undo unavailable: Take back the figures first.')).toBeTruthy()
  })
})

describe('the Indian metropolis', () => {
  // The four central squares C3 D3 / C4 D4: the left square east, the upper square south, as the engine lists the pairs
  const PAIRS = [
    sq(2, 2, 'C3 and D3', { direction: 'east', covers: 'C3 and D3' }),
    sq(2, 2, 'C3 and C4', { direction: 'south', covers: 'C3 and C4' }),
    sq(3, 2, 'D3 and D4', { direction: 'south', covers: 'D3 and D4' }),
    sq(2, 3, 'C4 and D4', { direction: 'east', covers: 'C4 and D4' }),
  ]
  const steps = (squares = PAIRS): Step[] => [
    stepOf('capital', 'Capital', { reason: 'Place your metropolis on one of the four central squares of your starting tile.', squares }),
  ]

  it('picks the first square, then the one it also covers, and sends the anchor square with its direction', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board } = renderPanel(viewWith(steps()))

    fireEvent.click(button('Place capital'))
    expect(board.request().title).toBe('the first square of your metropolis')
    expect(board.labels()).toEqual(['C3', 'D3', 'C4', 'D4'])
    expect(board.describe('D3')).toContain('Start your metropolis on D3')

    // D3 is the second square of C3's pair and the anchor of its own: two ways to go
    await board.pick('D3')
    expect(board.begin).toHaveBeenCalledTimes(2)
    expect(board.request().title).toContain('D3')
    expect(board.labels().sort()).toEqual(['C3', 'D4'])
    expect(board.describe('C3')).toBe('Place your metropolis on C3 and D3')
    expect(board.describe('D4')).toBe('Place your metropolis on D3 and D4')
    expect(setup).not.toHaveBeenCalled()

    await board.pick('C3')

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    // The pair C3 and D3 is the one anchored on C3 going east, whichever square was tapped first
    expect(setup.mock.calls[0]?.[1]).toEqual({ step: 'capital', column: 2, row: 2, direction: 'east' })
  })

  it('sends the anchor and direction of the pair that was chosen when the second square is the anchor', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board } = renderPanel(viewWith(steps()))

    fireEvent.click(button('Place capital'))
    await board.pick('D3')
    await board.pick('D4')

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ step: 'capital', column: 3, row: 2, direction: 'south' })
  })

  it('asks no second question when the first square can only go one way, and says which two squares it covers', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    // The lower right square is water: only the top pair is left
    const { board } = renderPanel(viewWith(steps([PAIRS[0] as (typeof PAIRS)[number]])))

    fireEvent.click(button('Place capital'))
    expect(board.labels()).toEqual(['C3', 'D3'])
    expect(board.describe('D3')).toBe('Place your metropolis on C3 and D3')
    await board.pick('D3')

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(board.begin).toHaveBeenCalledTimes(1)
    expect(setup.mock.calls[0]?.[1]).toEqual({ step: 'capital', column: 2, row: 2, direction: 'east' })
  })

  it('sends nothing when the pair is no longer offered after the picks', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board, update } = renderPanel(viewWith(steps()))

    fireEvent.click(button('Place capital'))
    await board.pick('D3')
    update(viewWith(steps([PAIRS[1] as (typeof PAIRS)[number]])))
    await board.pick('D4')

    expect(setup).not.toHaveBeenCalled()
    expect(screen.getByText('That square is no longer available. Pick again.')).toBeTruthy()
  })

  it('moves a placed metropolis through the same two picks', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const placed: Step[] = [
      stepOf('capital', 'Capital', { status: 'done', reason: 'Your metropolis is on C3 and D3.', canUndo: true, squares: [PAIRS[2] as (typeof PAIRS)[number], PAIRS[3] as (typeof PAIRS)[number]] }),
    ]
    const { board } = renderPanel(viewWith(placed))

    fireEvent.click(button('Move capital'))
    expect(board.labels()).toEqual(['D3', 'D4', 'C4'])
    // C4 belongs to one pair only, so its describe names both squares
    expect(board.describe('C4')).toBe('Move your metropolis to C4 and D4')
    await board.pick('C4')

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ step: 'capital', column: 2, row: 3, direction: 'east' })
  })
})

describe('the figures', () => {
  const figureSteps = (): Step[] => [
    stepOf('figures', 'Figures', {
      items: [
        itemOf('army', 'Army', { squares: [sq(1, 1, 'B2'), sq(2, 1, 'C2')] }),
        itemOf('scout', 'Scout', { squares: [sq(3, 1, 'D2')] }),
        itemOf('white', 'White scout (Spanish)', { squares: [sq(2, 4, 'C5')] }),
      ],
    }),
  ]

  it.each([
    ['Army', 'army', 'C2', { column: 2, row: 1 }],
    ['Scout', 'scout', 'D2', { column: 3, row: 1 }],
    ['White scout (Spanish)', 'white', 'C5', { column: 2, row: 4 }],
  ])('places the %s on the square that is picked, one figure per press', async (label, figure, square, cell) => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board } = renderPanel(viewWith(figureSteps()))

    fireEvent.click(button(`Place ${label}`))
    expect(board.request().title).toBe(`your ${label}`)
    expect(board.describe(square)).toBe(`Place your ${label} on ${square}`)
    await board.pick(square)

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ step: 'figure', figure, ...cell })
  })

  it('takes a placed figure back by naming which one', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    renderPanel(
      viewWith([
        stepOf('figures', 'Figures', {
          items: [itemOf('army', 'Army', { status: 'done', reason: 'Army is on the map.', canUndo: true }), itemOf('scout', 'Scout', { status: 'done', reason: 'Scout is on the map.' })],
        }),
      ]),
    )

    expect(screen.queryByRole('button', { name: 'Undo Scout' })).toBeNull()
    fireEvent.click(button('Undo Army'))

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ undo: true, step: 'figure', figure: 'army' })
  })

  it('does not pick for a figure that is already on the map', () => {
    renderPanel(viewWith([stepOf('figures', 'Figures', { status: 'done', items: [itemOf('army', 'Army', { status: 'done' })] })]))
    expect(screen.queryByRole('button', { name: /^Place/ })).toBeNull()
  })
})

describe('the social policy', () => {
  it('links to the Social policy panel, where the chooser is, and sends nothing itself', () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const choose = vi.spyOn(api, 'chooseSocialPolicy').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith(chineseSteps()))

    fireEvent.click(button('Choose in Social policy', row('policy')))

    expect(goToPanel).toHaveBeenCalledExactlyOnceWith('social-policy', true)
    expect(setup).not.toHaveBeenCalled()
    expect(choose).not.toHaveBeenCalled()
  })

  it('shows the row as done once the player has a policy', () => {
    renderPanel(viewWith([stepOf('policy', 'Social policy', { status: 'done', reason: 'You have a social policy.' })]))
    expect(rowStatus('policy')).toBe('Done')
    expect(within(row('policy')).getByText('You have a social policy.')).toBeTruthy()
  })
})

describe('the starting trade', () => {
  it('shows the amount that will be added and counts it with a body that carries no amount', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([stepOf('trade', 'Starting trade', { reason: 'Count the trade icons in the outskirts of your capital.' })]))

    // 1 trade now and 3 icons around the capital, held to a ceiling of 27
    const count = button('Count trade (+3)')
    fireEvent.click(count)

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ step: 'trade' })
  })

  it('holds the amount to the trade track', () => {
    renderPanel(
      viewWith([stepOf('trade', 'Starting trade')], GATE, {
        stats: { trade: 26 },
        tradeEstimate: { current: 26, cities: 5, collected: false, ceiling: 27, total: 27, set: false },
      }),
    )
    expect(button('Count trade (+1)')).toBeTruthy()
  })

  it('is disabled with its reason while the capital is missing, and undone with Undo once counted', async () => {
    const blocked = renderPanel(viewWith([stepOf('trade', 'Starting trade', { status: 'blocked', reason: 'Place your capital first.' })]))
    expect(button(/^Count trade/).disabled).toBe(true)
    expect(screen.getByText('Place your capital first.')).toBeTruthy()
    blocked.unmount()

    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([stepOf('trade', 'Starting trade', { status: 'done', reason: '3 trade was counted around your capital.', canUndo: true })]))
    expect(screen.queryByRole('button', { name: /^Count trade/ })).toBeNull()
    fireEvent.click(button('Undo starting trade'))
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ undo: true, step: 'trade' })
  })
})

describe('the American great person', () => {
  const POLICY_FIRST = 'Choose your social policy first: Organized Religion would draw a second great person card.'

  it('draws through the assisted action, with no arguments', async () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue({} as PlayerView)
    const withArgs = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([stepOf('greatPerson', 'Great person', { reason: 'Draw 1 great person card and keep one.' })]))

    fireEvent.click(button('Draw great person'))

    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    const [gameId, action, requestId, rev] = perform.mock.calls[0] ?? []
    expect([gameId, action, typeof requestId, rev]).toEqual(['g1', 'setupGreatPerson', 'string', 6])
    expect(withArgs).not.toHaveBeenCalled()
  })

  it('is blocked with the reason and a link to the Social policy panel until the policy is chosen and revealed', () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([stepOf('greatPerson', 'Great person', { status: 'blocked', reason: POLICY_FIRST })]))

    expect(screen.getByText(POLICY_FIRST)).toBeTruthy()
    expect(button('Draw great person').disabled).toBe(true)
    fireEvent.click(button('Go to Social policy'))
    expect(goToPanel).toHaveBeenCalledExactlyOnceWith('social-policy', true)
    expect(perform).not.toHaveBeenCalled()
  })

  it('leaves the choice of the card to the box above the tabs while a card to keep is waiting, and names no card itself', () => {
    const waiting = viewWith(
      [stepOf('greatPerson', 'Great person', { reason: 'Choose which great person card to keep.' })],
      GATE,
      { pendingRewards: [{ id: 'gp-1', kind: 'greatPerson', level: 1, step: 0, keep: 1, candidates: [{ id: 'i1', kind: 'greatperson', name: 'Hatshepsut Secret' }] }] },
    )
    renderPanel(waiting)

    expect(screen.queryByRole('button', { name: 'Draw great person' })).toBeNull()
    expect(within(row('greatPerson')).getByText('Choose which great person card to keep.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Hatshepsut Secret')
  })

  it('names no great person before one is drawn', () => {
    renderPanel(viewWith([stepOf('greatPerson', 'Great person', { reason: 'Draw 1 great person card and keep one.' })]))
    expect(document.body.textContent).not.toMatch(/Hatshepsut|Hammurabi|Pythagoras|Confucius|Aristotle/)
  })

  it('shows the undo vote as the way back once drawn, with no Undo button', () => {
    renderPanel(
      viewWith([
        stepOf('greatPerson', 'Great person', {
          status: 'done',
          reason: 'You have drawn your great person; place its marker by hand.',
          undoReason: 'A drawn great person is taken back by an undo vote on its log line.',
        }),
      ]),
    )
    expect(screen.queryByRole('button', { name: /Draw great person|Undo/ })).toBeNull()
    expect(within(row('greatPerson')).getByText(/Undo unavailable: A drawn great person is taken back by an undo vote/)).toBeTruthy()
  })
})

describe("Egypt's wonder", () => {
  it('is placed on a square picked on the map and taken back with Undo', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    const { board } = renderPanel(viewWith([stepOf('wonder', "Egypt's wonder", { squares: [sq(4, 4, 'E5'), sq(5, 4, 'F5')] })]))

    fireEvent.click(button("Place Egypt's wonder"))
    expect(board.labels()).toEqual(['E5', 'F5'])
    await board.pick('F5')
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ step: 'wonder', column: 5, row: 4 })
  })

  it('shows a placed wonder with Undo and no Place button', async () => {
    const setup = vi.spyOn(api, 'setup').mockResolvedValue({} as PlayerView)
    renderPanel(viewWith([stepOf('wonder', "Egypt's wonder", { status: 'done', reason: 'Pyramids is on E5.', canUndo: true })]))

    expect(screen.queryByRole('button', { name: /^Place/ })).toBeNull()
    fireEvent.click(button("Undo Egypt's wonder"))
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1))
    expect(setup.mock.calls[0]?.[1]).toEqual({ undo: true, step: 'wonder' })
  })

  it('is blocked with its reason before the capital is placed', () => {
    renderPanel(viewWith([stepOf('wonder', "Egypt's wonder", { status: 'blocked', reason: 'Place your capital first.' })]))
    expect(button("Place Egypt's wonder").disabled).toBe(true)
  })
})

describe('the government', () => {
  it('is shown as an automatic row with no button', () => {
    renderPanel(viewWith([stepOf('government', 'Government', { status: 'auto', reason: 'Greeks start with Democracy.' })]))
    expect(within(row('government')).getByText('Greeks start with Democracy.')).toBeTruthy()
    expect(within(row('government')).queryAllByRole('button')).toHaveLength(0)
  })
})
