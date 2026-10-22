// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBoard } from '@civ/engine'

import { ApiError, api } from '../lib/api.js'
import type { BuildChoice, CityBuildOptions, CityProduction, PlayerView } from '../lib/api.js'
import { AssistedActionsPanel, resetPendingRequestIds } from './AssistedActions.js'
import { BoardView } from './BoardView.js'
import type { PickSquares } from './BoardView.js'
import { BuildBar, BuildPicker } from './BuildPicker.js'
import { OPTIONS_CHANGED, SQUARE_GONE, useBuildFlow } from './buildFlow.js'
import type { Run } from './GameView.js'

/** Opens the category an item is under, when the picker shows buttons for them, and chooses it. */
function choose(name: string): void {
  if (screen.queryByRole('button', { name: `Choose ${name}` }) === null) {
    const category = /figure$/.test(name) ? 'Figures' : /unit$/.test(name) ? 'Units' : /^The /.test(name) ? 'Wonders' : 'Buildings'
    fireEvent.click(within(screen.getByRole('group', { name: /^What .* can build$/ })).getByRole('button', { name: category }))
  }
  fireEvent.click(screen.getByRole('button', { name: `Choose ${name}` }))
}

/** A build request that never gets an answer: the tap on a square has sent it, and the bar waits. */
function holdBuild(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(api, 'build').mockImplementation(() => new Promise<PlayerView>(() => undefined))
}

beforeEach(() => {
  localStorage.setItem('civ.panel.actions', 'true')
  resetPendingRequestIds()
  vi.spyOn(api, 'boardAssets').mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.actions')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

// --- fixtures ---------------------------------------------------------------

const LIBRARY: BuildChoice = {
  assetId: 'buildings/library',
  item: { kind: 'building', assetId: 'buildings/library' },
  placement: 'square',
  label: 'Library',
  cost: 6,
  tradeToPay: 0,
  squares: [
    { column: 3, row: 4, label: 'D5' },
    { column: 4, row: 4, label: 'E5' },
  ],
}

const HARBOR: BuildChoice = {
  assetId: 'buildings/harbor',
  item: { kind: 'building', assetId: 'buildings/harbor' },
  placement: 'square',
  label: 'Harbor',
  cost: 5,
  tradeToPay: 3,
  squares: [{ column: 2, row: 3, label: 'C4' }],
}

const COLOSSUS: BuildChoice = {
  assetId: 'wonders/colossus',
  item: { kind: 'wonder', assetId: 'wonders/colossus' },
  placement: 'square',
  label: 'The Colossus',
  cost: 10,
  costNote: '15 without Metalworking',
  tradeToPay: 0,
  squares: [{ column: 3, row: 4, label: 'D5' }],
}

const BATTLE_NOTE = 'An enemy figure stands here. Placing the army here is not automated: resolve any battle or loot by hand.'

const ARMY: BuildChoice = {
  assetId: 'figures/redarmy',
  item: { kind: 'army' },
  placement: 'square',
  label: 'Army figure',
  cost: 4,
  tradeToPay: 0,
  squares: [
    { column: 3, row: 4, label: 'D5' },
    { column: 4, row: 4, label: 'E5', note: BATTLE_NOTE },
  ],
}

const SCOUT: BuildChoice = {
  assetId: 'figures/redscout',
  item: { kind: 'scout' },
  placement: 'square',
  label: 'Scout figure',
  cost: 6,
  tradeToPay: 0,
  // D5 is also a square of the army, so one square can be told apart only by the item
  squares: [{ column: 3, row: 4, label: 'D5' }],
}

const INFANTRY: BuildChoice = {
  assetId: 'units/infantry',
  item: { kind: 'unit', unitType: 'infantry' },
  placement: 'none',
  label: 'Infantry unit',
  cost: 5,
  tradeToPay: 0,
  squares: [],
}

const MOUNTED: BuildChoice = {
  assetId: 'units/mounted',
  item: { kind: 'unit', unitType: 'mounted' },
  placement: 'none',
  label: 'Mounted unit',
  cost: 7,
  tradeToPay: 3,
  squares: [],
}

function options(overrides: Partial<CityBuildOptions> = {}): CityBuildOptions {
  return {
    cityPieceId: 'city-1',
    label: 'Capital D5',
    status: 'ready',
    reason: 'Ready to build.',
    production: 4,
    productionSource: 'estimate',
    choices: [LIBRARY, HARBOR],
    unavailable: [
      { assetId: 'buildings/market', item: { kind: 'building', assetId: 'buildings/market' }, label: 'Market', reason: 'Needs the Currency tech.' },
      { assetId: 'buildings/granary', item: { kind: 'building', assetId: 'buildings/granary' }, label: 'Granary', reason: 'No legal square: D4 is forest.' },
    ],
    ...overrides,
  }
}

function cityProduction(overrides: Partial<CityProduction> = {}): CityProduction {
  return {
    pieceId: 'city-1',
    label: 'Capital D5',
    outskirts: 4,
    outskirtsDetail: [],
    modifiers: [],
    buildingProgram: false,
    estimate: 4,
    withBuildingProgram: null,
    override: null,
    effective: 4,
    notes: [],
    ...overrides,
  }
}

function viewOf(
  build: readonly CityBuildOptions[] | undefined,
  extra: { rev?: number; spectator?: boolean; theirs?: readonly CityProduction[] } = {},
): PlayerView {
  return {
    rev: extra.rev ?? 7,
    you: extra.spectator === true
      ? null
      : {
          playerId: 'me',
          username: 'Alice',
          cities: [cityProduction()],
          ...(build === undefined ? {} : { buildOptions: build }),
        },
    opponents: [{ playerId: 'them', username: 'Bob', cities: extra.theirs ?? [] }],
  } as unknown as PlayerView
}

// --- the picker on its own ----------------------------------------------------

describe('BuildPicker', () => {
  const renderPicker = (city: CityBuildOptions, props: { note?: string; message?: string; busy?: boolean } = {}) => {
    const onChoose = vi.fn()
    const onClose = vi.fn()
    render(
      <BuildPicker
        city={city}
        note={props.note ?? null}
        message={props.message ?? null}
        busy={props.busy ?? false}
        onChoose={onChoose}
        onClose={onClose}
      />,
    )
    return { onChoose, onClose }
  }

  it('lists each choice with its cost and the trade it pays, and no count of squares', () => {
    renderPicker(options())
    const list = screen.getByRole('list', { name: 'Buildings Capital D5 can build' })
    const [library, harbor] = within(list).getAllByRole('listitem')
    expect(library?.textContent).toContain('Library')
    expect(library?.textContent).toContain('Cost 6')
    expect(library?.textContent).not.toContain('trade')
    expect(harbor?.textContent).toContain('Cost 5, pays 3 trade')
    // How many squares there are is noise: the squares are on the board when one is picked.
    expect(library?.textContent).not.toMatch(/square/i)
    expect(harbor?.textContent).not.toMatch(/square/i)
  })

  it.each([
    ['override', 'Production override: 4.'],
    ['building-program', 'Production 4, with the Building Program.'],
    ['estimate', 'Production 4, estimate.'],
  ] as const)('says where the production figure comes from: %s', (source, line) => {
    renderPicker(options({ productionSource: source }))
    expect(screen.getByText(line)).toBeTruthy()
  })

  it('keeps the reasons for the other buildings in a popup behind Why not the others', () => {
    renderPicker(options())
    const link = screen.getByRole('button', { name: 'Why not the others (2)' })
    expect(link.getAttribute('aria-haspopup')).toBe('dialog')
    // Nothing of the reasons is on the page until the link is pressed.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.textContent).not.toContain('Needs the Currency tech.')

    fireEvent.click(link)
    const dialog = screen.getByRole('dialog', { name: 'Capital D5: why not the others' })
    const reasons = within(dialog).getByRole('list')
    expect(reasons.textContent).toContain('Market: Needs the Currency tech.')
    expect(reasons.textContent).toContain('Granary: No legal square: D4 is forest.')

    // Close and Escape both put it away and give focus back to the link.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(link)
    fireEvent.click(link)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says plainly when nothing can be built, and points at the reasons and at setting production by hand', () => {
    renderPicker(options({ choices: [] }))
    expect(screen.queryByRole('list', { name: 'Buildings Capital D5 can build' })).toBeNull()
    expect(screen.getByText(/Nothing can be built in this city right now/).textContent).toMatch(
      /Why not the others.*set the city.s production by hand/s,
    )
    expect(screen.getByRole('button', { name: 'Why not the others (2)' })).toBeTruthy()
  })

  it('shows the reason instead of a list when the phase is wrong', () => {
    renderPicker(options({ status: 'wrong-phase', reason: 'Only in your open City Management phase.', choices: [], unavailable: [] }))
    expect(screen.getByText('Only in your open City Management phase.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Choose/ })).toBeNull()
  })

  it('hands the chosen building to the caller', () => {
    const { onChoose, onClose } = renderPicker(options())
    choose('Harbor')
    expect(onChoose).toHaveBeenCalledWith(HARBOR)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables the choices while busy and shows what the flow went back with', () => {
    renderPicker(options(), { busy: true, note: OPTIONS_CHANGED, message: 'The square was taken.' })
    expect((screen.getByRole('button', { name: 'Choose Library' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(OPTIONS_CHANGED)).toBeTruthy()
    expect(screen.getByText('The square was taken.')).toBeTruthy()
  })
})

// --- the Build button -------------------------------------------------------

/** The page as GameView wires it: Your actions, the Cities panel, the bar and the board share one flow. */
interface Handle {
  setView: (view: PlayerView) => void
}

const board = createBoard()

function Harness({
  initial,
  readOnly = false,
  refresh,
  handle,
}: {
  readonly initial: PlayerView
  readonly readOnly?: boolean
  /** The view GameView's reload would bring after an action. */
  readonly refresh?: () => PlayerView
  readonly handle?: Handle
}): React.JSX.Element {
  const [view, setView] = useState(initial)
  if (handle !== undefined) handle.setView = setView
  const flow = useBuildFlow(readOnly ? null : (view.you?.buildOptions ?? null))
  // GameView's run: do the action, then reload. A failure is shown by the caller here.
  const run: Run = async (action) => {
    await action()
    if (refresh !== undefined) setView(refresh())
  }
  const plan = flow.plan
  const pickSquares: PickSquares | undefined =
    plan === null
      ? undefined
      : { itemLabel: plan.label, cells: plan.squares, selected: plan.target, onPick: flow.pick, onCancel: flow.clear }
  return (
    <>
      <AssistedActionsPanel gameId="g1" view={view} busy={false} readOnly={readOnly} run={run} build={flow} />
      <BuildBar gameId="g1" view={view} flow={flow} busy={false} run={run} />
      <BoardView
        gameId="g1"
        board={board}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        readOnly={readOnly}
        youId="me"
        run={run}
        {...(pickSquares === undefined ? {} : { pickSquares })}
      />
    </>
  )
}

const buildButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Build in Capital D5' }) as HTMLButtonElement
const bar = (): HTMLElement => screen.getByRole('group', { name: 'Build' })
const confirm = (): HTMLButtonElement => within(bar()).getByRole('button', { name: /^Confirm/ }) as HTMLButtonElement
const overlays = (): HTMLElement[] => screen.queryAllByRole('button', { name: /^Place / })

describe('the Build button in Your actions', () => {
  it('is on the viewer’s own city and opens the picker', () => {
    render(<Harness initial={viewOf([options()])} />)
    expect(buildButton().disabled).toBe(false)
    expect(screen.queryByRole('region', { name: 'Build in Capital D5' })).toBeNull()
    fireEvent.click(buildButton())
    expect(screen.getByRole('region', { name: 'Build in Capital D5' })).toBeTruthy()
    // Both the button and its picker are in Your actions, not in the Cities panel.
    const panel = screen.getByRole('heading', { name: 'Your actions' }).closest('section') as HTMLElement
    expect(panel.contains(buildButton())).toBe(true)
    expect(panel.contains(screen.getByRole('region', { name: 'Build in Capital D5' }))).toBe(true)
    expect(buildButton().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(buildButton())
    expect(screen.queryByRole('region', { name: 'Build in Capital D5' })).toBeNull()
  })

  it('is disabled with the reason as text when it is the wrong phase', () => {
    const reason = 'Only available during your open City Management phase.'
    render(<Harness initial={viewOf([options({ status: 'wrong-phase', reason, choices: [], unavailable: [] })])} />)
    expect(buildButton().disabled).toBe(true)
    const text = screen.getByText(reason)
    expect(buildButton().getAttribute('aria-describedby')).toBe(text.id)
  })

  it('is missing on an opponent’s city, for a spectator, in a replay and without a flow', () => {
    const theirs = cityProduction({ pieceId: 'city-9', label: 'City H9' })
    // Even if an opponent's city id were among the options, only the viewer's own cards get the button.
    const { unmount } = render(
      <Harness initial={viewOf([options({ cityPieceId: 'city-9', label: 'City H9' })], { theirs: [theirs] })} />,
    )
    // The opponent's city is not listed anywhere on the page, so it has no button either.
    expect(screen.queryByText('City H9')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    unmount()

    const spectator = render(<Harness initial={viewOf(undefined, { spectator: true, theirs: [theirs] })} />)
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    spectator.unmount()

    // A replayed view has the options blanked, and the panel is read only.
    const replay = render(<Harness initial={viewOf([])} readOnly />)
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    replay.unmount()

    render(<AssistedActionsPanel gameId="g1" view={viewOf([options()])} busy={false} readOnly={false} run={async () => undefined} />)
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
  })
})

// --- picking a square and confirming ------------------------------------------

describe('square picking and Confirm', () => {
  const startHarbor = (): void => {
    fireEvent.click(buildButton())
    choose('Harbor')
  }
  const startLibrary = (): void => {
    fireEvent.click(buildButton())
    choose('Library')
  }

  it('has no square buttons until a choice is made', () => {
    render(<Harness initial={viewOf([options()])} />)
    expect(overlays()).toHaveLength(0)
    fireEvent.click(buildButton())
    expect(overlays()).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()
  })

  it('choosing shows the squares and a bar with the item, city, cost and trade, and no Confirm', () => {
    render(<Harness initial={viewOf([options()])} />)
    startHarbor()
    expect(overlays().map((button) => button.getAttribute('aria-label'))).toEqual(['Place Harbor on C4'])
    expect(bar().textContent).toContain('Build Harbor in Capital D5')
    expect(bar().textContent).toContain('Cost 5')
    expect(bar().textContent).toContain('Pays 3 trade')
    expect(bar().textContent).toContain('Tap a highlighted square on the board to place it.')
    expect(within(bar()).queryByRole('button', { name: /^Confirm/ })).toBeNull()
    // The picker has done its job and is gone.
    expect(screen.queryByRole('region', { name: 'Build in Capital D5' })).toBeNull()
  })

  const boardPanel = (): HTMLElement => {
    const panel = document.getElementById('game-board')
    if (panel === null) throw new Error('board panel missing')
    return panel
  }
  const recordScrolls = (): { element: Element; options: ScrollIntoViewOptions | undefined; margin: string }[] => {
    const scrolled: { element: Element; options: ScrollIntoViewOptions | undefined; margin: string }[] = []
    Element.prototype.scrollIntoView = function (this: Element, scrollOptions?: boolean | ScrollIntoViewOptions) {
      scrolled.push({
        element: this,
        options: typeof scrollOptions === 'object' ? scrollOptions : undefined,
        margin: this instanceof HTMLElement ? this.style.scrollMarginTop : '',
      })
    }
    return scrolled
  }

  it('focuses the bar without scrolling the page by itself, so it does not fight the board scroll', () => {
    const scrolled = recordScrolls()
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    expect(scrolled.some((entry) => entry.element === bar())).toBe(false)
    expect(document.activeElement).toBe(bar())
  })

  it('scrolls the page to the board panel once when picking starts, smoothly unless reduced motion is asked for', () => {
    const scrolled = recordScrolls()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { unmount } = render(<Harness initial={viewOf([options()])} />)
    expect(scrolled).toHaveLength(0)
    startLibrary()
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]?.element).toBe(boardPanel())
    expect(scrolled[0]?.options).toEqual({ behavior: 'smooth', block: 'start' })
    expect(boardPanel().classList.contains('build-picking')).toBe(true)
    // Focus stays on the bar, so Tab goes on to the squares.
    expect(document.activeElement).toBe(bar())
    unmount()

    scrolled.length = 0
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]?.options).toEqual({ behavior: 'auto', block: 'start' })
  })

  it('stops the board below the measured height of the bar, and leaves no inline margin behind', () => {
    const scrolled = recordScrolls()
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { height: this.classList.contains('build-bar') ? 181.2 : 0 } as DOMRect
    })
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]?.margin).toBe('194px')
    expect(boardPanel().style.scrollMarginTop).toBe('')
  })

  it('does not scroll the page again on a refresh that keeps the plan, when the square is chosen, or when picking ends', () => {
    const handle: Handle = { setView: () => undefined }
    const scrolled = recordScrolls()
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    startLibrary()
    expect(scrolled).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))
    act(() => handle.setView(viewOf([options()], { rev: 9 })))
    expect(overlays()).toHaveLength(2)
    expect(scrolled).toHaveLength(1)

    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel' }))
    expect(overlays()).toHaveLength(0)
    expect(scrolled).toHaveLength(1)
    expect(boardPanel().classList.contains('build-picking')).toBe(false)

    // Picking again is a new start.
    startLibrary()
    expect(scrolled).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(scrolled).toHaveLength(2)
  })

  it('places the piece with the tap on a square, which sends the build; the squares are real buttons a keyboard can reach', () => {
    const send = holdBuild()
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    const [d5] = overlays()
    if (d5 === undefined) throw new Error('squares missing')
    expect(d5.tagName).toBe('BUTTON')
    d5.focus()
    expect(document.activeElement).toBe(d5)
    expect(d5.getAttribute('aria-pressed')).toBe('false')
    expect(send).not.toHaveBeenCalled()

    fireEvent.click(d5)
    expect(d5.getAttribute('aria-pressed')).toBe('true')
    expect(bar().textContent).toContain('Square D5')
    expect(send).toHaveBeenCalledTimes(1)
    // The tap is the request: no Confirm to press while it is out
    expect(within(bar()).queryByRole('button', { name: /^Confirm/ })).toBeNull()
  })

  it('sends exactly one build request with the payload, no rush when no trade is due, then clears', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on E5' }))
    // A second tap on the same square is no new pick
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on E5' }))

    await waitFor(() => expect(screen.queryByRole('group', { name: 'Build' })).toBeNull())
    expect(send).toHaveBeenCalledTimes(1)
    const [gameId, requestId, rev, payload] = send.mock.calls[0] ?? []
    expect(gameId).toBe('g1')
    expect(typeof requestId).toBe('string')
    expect(rev).toBe(7)
    expect(payload).toEqual({
      cityPieceId: 'city-1',
      item: { kind: 'building', assetId: 'buildings/library' },
      target: { column: 4, row: 4 },
    })
    expect(payload).not.toHaveProperty('rush')
    expect(overlays()).toHaveLength(0)
  })

  it('pays the rush with the tap when trade is due', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([options()])} />)
    startHarbor()
    fireEvent.click(screen.getByRole('button', { name: 'Place Harbor on C4' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[3]).toEqual({
      cityPieceId: 'city-1',
      item: { kind: 'building', assetId: 'buildings/harbor' },
      target: { column: 2, row: 3 },
      rush: true,
    })
  })

  it('Cancel and Escape leave everything as it was and send nothing', () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([options()])} />)

    startLibrary()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()
    expect(overlays()).toHaveLength(0)

    startLibrary()
    expect(overlays()).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()
    expect(overlays()).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('Escape in a text field belongs to the field', () => {
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    const field = screen.getByRole('textbox', { name: /^Production override/ })
    field.focus()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(overlays()).toHaveLength(2)
  })

  it('shows the server’s message in the bar and keeps the plan when the choice is still offered', async () => {
    vi.spyOn(api, 'build').mockRejectedValue(new ApiError(422, 'BUILD_REFUSED', 'That square was taken a moment ago.'))
    render(<Harness initial={viewOf([options()])} refresh={() => viewOf([options()], { rev: 8 })} />)
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That square was taken a moment ago.')
    expect(bar().contains(alert)).toBe(true)
    // Still planning: squares and the chosen one are as they were, and Confirm is there to try it again.
    expect(overlays()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Place Library on D5' }).getAttribute('aria-pressed')).toBe('true')
    expect(confirm().disabled).toBe(false)
  })

  it('drops the plan and goes back to the picker with the reason when the refusal took the choice away', async () => {
    vi.spyOn(api, 'build').mockRejectedValue(new ApiError(422, 'BUILD_REFUSED', 'Supply of Library is used up.'))
    const fresh = viewOf([options({ choices: [HARBOR], unavailable: [{ assetId: 'buildings/library', item: { kind: 'building', assetId: 'buildings/library' }, label: 'Library', reason: 'No Library left in the supply.' }] })], { rev: 8 })
    render(<Harness initial={viewOf([options()])} refresh={() => fresh} />)
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))

    await waitFor(() => expect(overlays()).toHaveLength(0))
    expect((await screen.findByRole('alert')).textContent).toBe('Supply of Library is used up.')
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
    // The picker is open again with fresh choices.
    const picker = screen.getByRole('region', { name: 'Build in Capital D5' })
    expect(within(picker).queryByRole('button', { name: 'Choose Library' })).toBeNull()
    expect(within(picker).getByRole('button', { name: 'Choose Harbor' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to the picker' })).toBeTruthy()
  })

  it('reuses the request id after a lost answer and keeps the plan', async () => {
    const send = vi
      .spyOn(api, 'build')
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({} as PlayerView)
    render(<Harness initial={viewOf([options()])} refresh={() => viewOf([options()], { rev: 8 })} />)
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))
    await screen.findByRole('alert')
    expect(overlays()).toHaveLength(2)

    fireEvent.click(confirm())
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Build' })).toBeNull())
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[1]).toBe(send.mock.calls[0]?.[1])
  })

  it('gives another square a new request id and the same square the id it had', async () => {
    const send = vi.spyOn(api, 'build').mockRejectedValue(new Error('Failed to fetch'))
    render(<Harness initial={viewOf([options()])} refresh={() => viewOf([options()], { rev: 8 })} />)
    startLibrary()
    const press = async (label: string, calls: number): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: label }))
      await waitFor(() => expect(send).toHaveBeenCalledTimes(calls))
      await screen.findByRole('alert')
    }
    await press('Place Library on D5', 1)
    await press('Place Library on E5', 2)
    await press('Place Library on D5', 3)

    const ids = send.mock.calls.map((call) => call[1])
    expect(ids[1]).not.toBe(ids[0])
    expect(ids[2]).toBe(ids[0])
  })

  it('says nothing and sends nothing when the same press is already on its way', async () => {
    let answer: (view: PlayerView) => void = () => undefined
    const send = vi.spyOn(api, 'build').mockImplementation(
      () => new Promise<PlayerView>((resolve) => { answer = resolve }),
    )
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))
    expect(send).toHaveBeenCalledTimes(1)

    // Cancel and choose the same square again while the first request has no answer.
    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel' }))
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))
    await act(async () => { await Promise.resolve() })

    expect(send).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Nothing was built.')).toBeNull()
    expect(confirm().disabled).toBe(false)
    await act(async () => { answer({} as PlayerView) })
  })
})

describe('Back to the picker', () => {
  it('opens Your actions first when it was collapsed after the Build started', async () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Library')
    const toggle = document.querySelector<HTMLElement>('[aria-controls="actions-content"]')
    if (toggle === null) throw new Error('Your actions toggle missing')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    // The choice goes away: the flow is back at the picker, inside the collapsed panel.
    act(() => handle.setView(viewOf([options({ choices: [HARBOR] })], { rev: 9 })))
    const picker = document.getElementById('build-picker')
    if (picker === null) throw new Error('picker missing')
    expect(picker.closest('[hidden]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the picker' }))
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'))
    expect(picker.closest('[hidden]')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(picker))
  })

  it('leaves an open Your actions as it is and goes straight to the picker', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Library')
    act(() => handle.setView(viewOf([options({ choices: [HARBOR] })], { rev: 9 })))

    fireEvent.click(screen.getByRole('button', { name: 'Back to the picker' }))
    expect(document.querySelector('[aria-controls="actions-content"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(document.getElementById('build-picker'))
  })
})

// --- refreshes ------------------------------------------------------------------

describe('a refresh while planning', () => {
  it('keeps the plan and the chosen square when the options are the same', () => {
    holdBuild()
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Library')
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))

    // New objects, a new revision, the same options: what auto refresh brings.
    act(() => handle.setView(viewOf([options()], { rev: 9 })))
    expect(overlays()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Place Library on D5' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('drops the plan with a note when the choice is no longer offered, and reopens the picker', () => {
    holdBuild()
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Library')
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))

    act(() => handle.setView(viewOf([options({ choices: [HARBOR] })], { rev: 9 })))
    expect(overlays()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
    expect(screen.getByRole('region', { name: 'Build in Capital D5' })).toBeTruthy()
  })

  it('drops the plan when the city is gone or no longer ready', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Library')

    act(() => handle.setView(viewOf([options({ status: 'wrong-phase', reason: 'Not now.', choices: [], unavailable: [] })], { rev: 9 })))
    expect(overlays()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
  })

  it('drops the plan with a note when its city is no longer in the options at all', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Library')
    expect(overlays().length).toBeGreaterThan(0)

    act(() => handle.setView(viewOf([], { rev: 9 })))
    expect(overlays()).toHaveLength(0)
    expect(screen.queryByRole('region', { name: 'Build in Capital D5' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
  })

  it('closes an open picker with a note when its city is no longer in the options', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    expect(screen.getByRole('region', { name: 'Build in Capital D5' })).toBeTruthy()

    act(() => handle.setView(viewOf([], { rev: 9 })))
    expect(screen.queryByRole('region', { name: 'Build in Capital D5' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
  })

  it('keeps the plan but forgets a chosen square that is no longer legal', () => {
    holdBuild()
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Library')
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))

    act(() => handle.setView(viewOf([options({ choices: [{ ...LIBRARY, squares: [LIBRARY.squares[1] as BuildChoice['squares'][number]] }, HARBOR] })], { rev: 9 })))
    expect(overlays().map((button) => button.getAttribute('aria-label'))).toEqual(['Place Library on E5'])
    expect(screen.getByRole('status').textContent).toBe(SQUARE_GONE)
    expect(within(bar()).queryByRole('button', { name: /^Confirm/ })).toBeNull()
  })

  it('takes a changed cost from the fresh options', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Library')
    expect(bar().textContent).not.toContain('Pays')

    act(() => handle.setView(viewOf([options({ choices: [{ ...LIBRARY, tradeToPay: 6 }, HARBOR] })], { rev: 9 })))
    expect(bar().textContent).toContain('Pays 6 trade')
  })

  it('clears everything when the viewer can no longer build, as in a replay', () => {
    const { rerender } = render(<Harness initial={viewOf([options()])} />)
    fireEvent.click(buildButton())
    choose('Library')
    expect(overlays()).toHaveLength(2)

    rerender(<Harness initial={viewOf([options()])} readOnly />)
    expect(overlays()).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()
  })
})

// --- figures and units ----------------------------------------------------------

const ALL_KINDS = (): CityBuildOptions => options({ choices: [LIBRARY, ARMY, SCOUT, INFANTRY, MOUNTED] })

describe('the picker groups', () => {
  const renderPicker = (city: CityBuildOptions) =>
    render(<BuildPicker city={city} note={null} message={null} busy={false} onChoose={() => undefined} onClose={() => undefined} />)
  const headings = (): string[] => screen.queryAllByRole('heading', { level: 6 }).map((heading) => heading.textContent ?? '')
  const categories = (): string[] =>
    within(screen.getByRole('group', { name: 'What Capital D5 can build' }))
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
  const open = (category: string): void => {
    fireEvent.click(within(screen.getByRole('group', { name: 'What Capital D5 can build' })).getByRole('button', { name: category }))
  }
  const names = (list: string): (string | null | undefined)[] =>
    within(screen.getByRole('list', { name: list }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('strong')?.textContent)

  it('opens with a button for each kind, in that order, and lists nothing until one is pressed', () => {
    renderPicker(ALL_KINDS())
    expect(categories()).toEqual(['Buildings', 'Figures', 'Units'])
    expect(screen.queryByRole('button', { name: /^Choose/ })).toBeNull()
    expect(headings()).toEqual([])
  })

  it('shows the list of a kind when its button is pressed, and Back returns to the buttons', () => {
    renderPicker(ALL_KINDS())
    open('Buildings')
    expect(headings()).toEqual(['Buildings'])
    expect(names('Buildings Capital D5 can build')).toEqual(['Library'])
    expect(screen.queryByRole('group', { name: 'What Capital D5 can build' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(categories()).toEqual(['Buildings', 'Figures', 'Units'])
    open('Figures')
    expect(headings()).toEqual(['Figures (placed on the map)'])
    expect(names('Figures Capital D5 can build')).toEqual(['Army figure', 'Scout figure'])
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    open('Units')
    expect(names('Units Capital D5 can build')).toEqual(['Infantry unit', 'Mounted unit'])
  })

  it('moves focus into the list that was opened, and back to its button on Back', () => {
    renderPicker(ALL_KINDS())
    open('Figures')
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Figures' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'What Capital D5 can build' })).getByRole('button', { name: 'Figures' }))
  })

  it('has no button for a kind that has nothing in it, and shows a kind that is alone at once', () => {
    const { unmount } = renderPicker(options({ choices: [LIBRARY] }))
    expect(headings()).toEqual(['Buildings'])
    expect(screen.queryByRole('group', { name: 'What Capital D5 can build' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    unmount()

    const units = renderPicker(options({ choices: [INFANTRY] }))
    expect(headings()).toEqual(['Units'])
    expect(screen.queryByRole('list', { name: 'Buildings Capital D5 can build' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Figures Capital D5 can build' })).toBeNull()
    units.unmount()

    const two = renderPicker(options({ choices: [INFANTRY, ARMY] }))
    expect(categories()).toEqual(['Figures', 'Units'])
    two.unmount()
  })

  it('falls back to the buttons when the opened kind is no longer offered', () => {
    const view = renderPicker(ALL_KINDS())
    open('Figures')
    view.rerender(
      <BuildPicker city={options({ choices: [LIBRARY, INFANTRY] })} note={null} message={null} busy={false} onChoose={() => undefined} onClose={() => undefined} />,
    )
    expect(categories()).toEqual(['Buildings', 'Units'])
  })

  it('shows cost and trade for a figure and a unit, and nothing else', () => {
    renderPicker(ALL_KINDS())
    open('Figures')
    const [army] = within(screen.getByRole('list', { name: 'Figures Capital D5 can build' })).getAllByRole('listitem')
    expect(army?.textContent).toContain('Cost 4')
    expect(army?.textContent).not.toMatch(/square/i)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    open('Units')
    const [infantry, mounted] = within(screen.getByRole('list', { name: 'Units Capital D5 can build' })).getAllByRole('listitem')
    expect(infantry?.textContent).toContain('Cost 5')
    // "Draws a card in secret" is noise: the bar says what a unit is when it is picked.
    expect(infantry?.textContent).not.toContain('secret')
    expect(infantry?.textContent).not.toMatch(/square/i)
    expect(mounted?.textContent).toContain('Cost 7, pays 3 trade')
  })

  it('explains the figures and units that are not offered under Why not the others', () => {
    renderPicker(
      options({
        choices: [LIBRARY],
        unavailable: [
          { assetId: 'figures/redscout', item: { kind: 'scout' }, label: 'Scout figure', reason: 'All 2 scouts are on the board.' },
          { assetId: 'units/aircraft', item: { kind: 'unit', unitType: 'aircraft' }, label: 'Aircraft unit', reason: 'Aircraft need the Flight tech.' },
        ],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Why not the others (2)' }))
    const reasons = within(screen.getByRole('dialog')).getByRole('list')
    expect(reasons.textContent).toContain('Scout figure: All 2 scouts are on the board.')
    expect(reasons.textContent).toContain('Aircraft unit: Aircraft need the Flight tech.')
  })
})

describe('building a unit', () => {
  const startUnit = (name: string): void => {
    fireEvent.click(buildButton())
    choose(name)
  }

  it('goes straight to the confirm bar: no squares, no board pick, Confirm ready at once', () => {
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startUnit('Infantry unit')
    expect(overlays()).toHaveLength(0)
    expect(document.getElementById('game-board')?.classList.contains('build-picking')).toBe(false)
    expect(bar().textContent).toContain('Build an infantry unit in Capital D5')
    expect(bar().textContent).toContain('Cost 5')
    expect(bar().textContent).toContain('A private card is drawn, nothing is placed on the map.')
    expect(bar().textContent).not.toContain('Tap a highlighted square')
    expect(confirm().disabled).toBe(false)
    expect(confirm().textContent).toBe('Confirm')
    // The picker has done its job and is gone.
    expect(screen.queryByRole('region', { name: 'Build in Capital D5' })).toBeNull()
  })

  it('does not scroll the page to the board for a unit', () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startUnit('Infantry unit')
    expect(scrolled).toHaveLength(0)
  })

  it('sends exactly one request with the unit type and no target, however often Confirm is pressed', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startUnit('Infantry unit')
    fireEvent.click(confirm())
    fireEvent.click(confirm())

    await waitFor(() => expect(screen.queryByRole('group', { name: 'Build' })).toBeNull())
    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0]?.[3]
    expect(payload).toEqual({ cityPieceId: 'city-1', item: { kind: 'unit', unitType: 'infantry' } })
    expect(payload).not.toHaveProperty('target')
    expect(payload).not.toHaveProperty('rush')
  })

  it('agrees to the rush when the unit needs trade, and says so on Confirm', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startUnit('Mounted unit')
    expect(bar().textContent).toContain('Build a mounted unit in Capital D5')
    expect(bar().textContent).toContain('Pays 3 trade')
    expect(confirm().textContent).toBe('Confirm and pay 3 trade')
    fireEvent.click(confirm())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[3]).toEqual({
      cityPieceId: 'city-1',
      item: { kind: 'unit', unitType: 'mounted' },
      rush: true,
    })
  })

  it('Cancel and Escape close the bar and send nothing', () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startUnit('Infantry unit')
    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()

    startUnit('Infantry unit')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('shows the server’s refusal in the bar and keeps the unit ready to try again', async () => {
    vi.spyOn(api, 'build').mockRejectedValue(new ApiError(422, 'BUILD_REFUSED', 'No unit cards left.'))
    render(<Harness initial={viewOf([ALL_KINDS()])} refresh={() => viewOf([ALL_KINDS()], { rev: 8 })} />)
    startUnit('Infantry unit')
    fireEvent.click(confirm())
    expect((await screen.findByRole('alert')).textContent).toBe('No unit cards left.')
    expect(confirm().disabled).toBe(false)
  })
})

describe('building a figure', () => {
  const startFigure = (name: string): void => {
    fireEvent.click(buildButton())
    choose(name)
  }

  const confirmButton = (): HTMLElement | null => within(bar()).queryByRole('button', { name: /^Confirm/ })

  it('an army enters square picking and is placed by the tap on its square, with no Confirm', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startFigure('Army figure')
    expect(overlays().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Place Army figure on D5',
      'Place Army figure on E5, enemy figure there, resolve by hand',
    ])
    expect(bar().textContent).toContain('Build Army figure in Capital D5')
    expect(bar().textContent).toContain('Tap a highlighted square on the board to place it.')
    expect(confirmButton()).toBeNull()
    expect(send).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Place Army figure on D5' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[3]).toEqual({
      cityPieceId: 'city-1',
      item: { kind: 'army' },
      target: { column: 3, row: 4 },
    })
  })

  it('a scout enters square picking and sends its item with the tapped square', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startFigure('Scout figure')
    expect(overlays().map((button) => button.getAttribute('aria-label'))).toEqual(['Place Scout figure on D5'])
    expect(document.getElementById('game-board')?.classList.contains('build-picking')).toBe(true)
    fireEvent.click(overlays()[0] as HTMLElement)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[3]).toEqual({
      cityPieceId: 'city-1',
      item: { kind: 'scout' },
      target: { column: 3, row: 4 },
    })
  })

  it('shows and announces the enemy figure note for a blockaded square, which keeps Confirm', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startFigure('Army figure')
    const plain = screen.getByRole('button', { name: 'Place Army figure on D5' })
    const noted = screen.getByRole('button', { name: 'Place Army figure on E5, enemy figure there, resolve by hand' })
    // Marked by a word on the square and a class, not by colour alone.
    expect(noted.classList.contains('noted')).toBe(true)
    expect(noted.textContent).toContain('Enemy')
    expect(plain.classList.contains('noted')).toBe(false)
    expect(plain.textContent).not.toContain('Enemy')

    // The square with a note is read first: tapping it sends nothing, and Confirm places the army.
    fireEvent.click(noted)
    // role="status" is a live region: a screen reader reads the note out when the square is picked.
    const status = within(bar()).getByRole('status')
    expect(status.textContent).toContain('Note for E5:')
    expect(status.textContent).toContain(BATTLE_NOTE)
    expect(confirm().disabled).toBe(false)
    expect(send).not.toHaveBeenCalled()

    // Another, plain square is placed at once and the note goes with the choice.
    fireEvent.click(plain)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[3]).toMatchObject({ target: { column: 3, row: 4 } })
  })

  it('Confirm places the army on a square with a note', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([ALL_KINDS()])} />)
    startFigure('Army figure')
    fireEvent.click(screen.getByRole('button', { name: 'Place Army figure on E5, enemy figure there, resolve by hand' }))
    fireEvent.click(confirm())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[3]).toEqual({ cityPieceId: 'city-1', item: { kind: 'army' }, target: { column: 4, row: 4 } })
  })

  it('a note that appears on the chosen square after a refresh is shown, and the square is not sent by it', async () => {
    const pending = new Promise<PlayerView>(() => undefined)
    const send = vi.spyOn(api, 'build').mockReturnValue(pending)
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([ALL_KINDS()])} handle={handle} />)
    startFigure('Scout figure')
    fireEvent.click(screen.getByRole('button', { name: 'Place Scout figure on D5' }))
    expect(screen.queryByRole('status')).toBeNull()
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const noted = { ...SCOUT, squares: [{ column: 3, row: 4, label: 'D5', note: 'A note.' }] }
    act(() => handle.setView(viewOf([options({ choices: [LIBRARY, ARMY, noted, INFANTRY] })], { rev: 9 })))
    expect(screen.getByRole('status').textContent).toContain('A note.')
    expect(screen.getByRole('button', { name: 'Place Scout figure on D5, enemy figure there, resolve by hand' })).toBeTruthy()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('after a refusal, Confirm tries the same square again, and the tap is not sent twice', async () => {
    const send = vi.spyOn(api, 'build').mockRejectedValueOnce(new ApiError(422, 'BUILD_REFUSED', 'Not now.')).mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([ALL_KINDS()])} refresh={() => viewOf([ALL_KINDS()], { rev: 8 })} />)
    startFigure('Army figure')
    fireEvent.click(screen.getByRole('button', { name: 'Place Army figure on D5' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Not now.')
    expect(send).toHaveBeenCalledTimes(1)

    fireEvent.click(confirm())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Build' })).toBeNull())
  })

  it('tapping the same square again after a refusal is no new pick, and Confirm is still there', async () => {
    const send = vi.spyOn(api, 'build').mockRejectedValue(new ApiError(422, 'BUILD_REFUSED', 'Not now.'))
    render(<Harness initial={viewOf([ALL_KINDS()])} refresh={() => viewOf([ALL_KINDS()], { rev: 8 })} />)
    startFigure('Army figure')
    const plain = screen.getByRole('button', { name: 'Place Army figure on D5' })
    fireEvent.click(plain)
    await screen.findByRole('alert')
    expect(send).toHaveBeenCalledTimes(1)

    // The tap clears the message, but the square is the same: nothing is sent, and Confirm stays
    fireEvent.click(plain)
    expect(send).toHaveBeenCalledTimes(1)
    expect(confirmButton()).not.toBeNull()
    fireEvent.click(confirm())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  })

  it('a note that disappears from a picked square leaves Confirm to send it, and nothing is sent by itself', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([ALL_KINDS()])} handle={handle} />)
    startFigure('Army figure')
    fireEvent.click(screen.getByRole('button', { name: 'Place Army figure on E5, enemy figure there, resolve by hand' }))
    expect(send).not.toHaveBeenCalled()

    // The enemy figure leaves: the square has no note any more
    const plainArmy = { ...ARMY, squares: [{ column: 3, row: 4, label: 'D5' }, { column: 4, row: 4, label: 'E5' }] }
    act(() => handle.setView(viewOf([options({ choices: [LIBRARY, plainArmy, SCOUT, INFANTRY, MOUNTED] })], { rev: 9 })))
    expect(send).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(confirm())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[3]).toMatchObject({ item: { kind: 'army' }, target: { column: 4, row: 4 } })
  })
})

describe('the request key tells the items and squares apart', () => {
  it('reuses the id for the same item and square, and gives another item or square a new one', async () => {
    const send = vi.spyOn(api, 'build').mockRejectedValue(new Error('Failed to fetch'))
    render(<Harness initial={viewOf([ALL_KINDS()])} refresh={() => viewOf([ALL_KINDS()], { rev: 8 })} />)
    const press = async (choice: string, square: string | null, calls: number): Promise<void> => {
      // A rejected press keeps the plan, so Cancel first, then pick the next one.
      const cancel = screen.queryByRole('button', { name: 'Cancel' })
      if (cancel !== null) fireEvent.click(cancel)
      const open = screen.queryByRole('region', { name: 'Build in Capital D5' })
      if (open === null) fireEvent.click(buildButton())
      choose(choice)
      if (square !== null) fireEvent.click(screen.getByRole('button', { name: square }))
      // A figure on a plain square is sent by the tap; a note on the square or a unit needs Confirm.
      const sendIt = within(bar()).queryByRole('button', { name: /^Confirm/ })
      if (sendIt !== null) fireEvent.click(sendIt)
      await waitFor(() => expect(send).toHaveBeenCalledTimes(calls))
      await screen.findByRole('alert')
    }
    // Army and scout both have D5: only the item tells them apart.
    await press('Army figure', 'Place Army figure on D5', 1)
    await press('Scout figure', 'Place Scout figure on D5', 2)
    await press('Army figure', 'Place Army figure on E5, enemy figure there, resolve by hand', 3)
    await press('Infantry unit', null, 4)
    await press('Mounted unit', null, 5)
    await press('Army figure', 'Place Army figure on D5', 6)
    await press('Infantry unit', null, 7)

    const ids = send.mock.calls.map((call) => call[1])
    expect(new Set(ids.slice(0, 5)).size).toBe(5)
    expect(ids[5]).toBe(ids[0])
    expect(ids[6]).toBe(ids[3])
  })
})

describe('a refresh compares choices by item', () => {
  it('keeps the plan when the same item comes back under another list key', () => {
    // The tap sends the army; the request is still out, so the plan stays.
    vi.spyOn(api, 'build').mockReturnValue(new Promise<PlayerView>(() => undefined))
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([ALL_KINDS()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Army figure')
    fireEvent.click(screen.getByRole('button', { name: 'Place Army figure on D5' }))

    // The list key is only a key: the item is what the choice is.
    const recoloured = { ...ARMY, assetId: 'figures/bluearmy' }
    act(() => handle.setView(viewOf([options({ choices: [recoloured] })], { rev: 9 })))
    expect(overlays()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Place Army figure on D5' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('treats a different item under the same list key as another choice and goes back to the picker', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([ALL_KINDS()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Army figure')

    const scoutUnderArmyKey = { ...SCOUT, assetId: ARMY.assetId }
    act(() => handle.setView(viewOf([options({ choices: [scoutUnderArmyKey] })], { rev: 9 })))
    expect(overlays()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
    expect(screen.getByRole('region', { name: 'Build in Capital D5' })).toBeTruthy()
  })

  it('tells two units of different types apart', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([ALL_KINDS()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Infantry unit')

    act(() => handle.setView(viewOf([options({ choices: [MOUNTED] })], { rev: 9 })))
    expect(screen.queryByRole('group', { name: 'Build' })?.textContent ?? '').not.toContain('infantry')
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
  })

  it('keeps a unit plan across a refresh with the same options, and takes a changed cost', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([ALL_KINDS()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Infantry unit')

    act(() => handle.setView(viewOf([ALL_KINDS()], { rev: 9 })))
    expect(bar().textContent).toContain('Build an infantry unit in Capital D5')
    expect(screen.queryByRole('status')).toBeNull()
    expect(confirm().disabled).toBe(false)

    act(() => handle.setView(viewOf([options({ choices: [{ ...INFANTRY, cost: 7, tradeToPay: 6 }] })], { rev: 10 })))
    expect(bar().textContent).toContain('Cost 7')
    expect(bar().textContent).toContain('Pays 6 trade')
    expect(confirm().textContent).toBe('Confirm and pay 6 trade')
  })

  it('drops a unit plan with the note when the unit is no longer offered', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([ALL_KINDS()])} handle={handle} />)
    fireEvent.click(buildButton())
    choose('Infantry unit')

    act(() => handle.setView(viewOf([options({ choices: [LIBRARY] })], { rev: 9 })))
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
    expect(screen.getByRole('region', { name: 'Build in Capital D5' })).toBeTruthy()
  })
})

describe('building a wonder', () => {
  const startWonder = (): void => {
    fireEvent.click(buildButton())
    choose('The Colossus')
  }
  const withWonder = (): CityBuildOptions => options({ choices: [LIBRARY, COLOSSUS, ARMY] })

  it('has its own button between the buildings and the figures, with cost and nothing else', () => {
    render(
      <BuildPicker city={withWonder()} note={null} message={null} busy={false} onChoose={() => undefined} onClose={() => undefined} />,
    )
    const kinds = within(screen.getByRole('group', { name: 'What Capital D5 can build' }))
    expect(kinds.getAllByRole('button').map((button) => button.textContent)).toEqual(['Buildings', 'Wonders', 'Figures'])
    fireEvent.click(kinds.getByRole('button', { name: 'Wonders' }))
    const [colossus] = within(screen.getByRole('list', { name: 'Wonders Capital D5 can build' })).getAllByRole('listitem')
    expect(colossus?.textContent).toContain('The Colossus')
    expect(colossus?.textContent).toContain('Cost 10 (15 without Metalworking)')
    expect(colossus?.textContent).not.toMatch(/square/i)
    // The group says that the cost is only told: other effects add hammers
    expect(screen.getByText('The cost is not checked against the city’s production.')).toBeTruthy()
  })

  it('enters square picking like a building, and is placed by the tap with no Confirm', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([withWonder()])} />)
    startWonder()
    expect(bar().textContent).toContain('Build the Colossus in Capital D5')
    expect(bar().textContent).toContain('Cost 10 (15 without Metalworking)')
    expect(bar().textContent).toContain('Tap a highlighted square on the board to place it.')
    expect(overlays().map((button) => button.getAttribute('aria-label'))).toEqual(['Place The Colossus on D5'])
    expect(within(bar()).queryByRole('button', { name: /^Confirm/ })).toBeNull()

    fireEvent.click(overlays()[0] as HTMLElement)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[3]).toEqual({
      cityPieceId: 'city-1',
      item: { kind: 'wonder', assetId: 'wonders/colossus' },
      target: { column: 3, row: 4 },
    })
  })

  it('tells a wonder and a building of the same asset id apart in the request key and in a refresh', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([withWonder()])} handle={handle} />)
    holdBuild()
    startWonder()
    fireEvent.click(overlays()[0] as HTMLElement)

    // The same asset id as a building is another choice, so the plan goes back to the picker
    const asBuilding = { ...COLOSSUS, item: { kind: 'building', assetId: 'wonders/colossus' } as const }
    act(() => handle.setView(viewOf([options({ choices: [asBuilding] })], { rev: 9 })))
    expect(overlays()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
  })
})
