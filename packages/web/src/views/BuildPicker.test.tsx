// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBoard } from '@civ/engine'

import { ApiError, api } from '../lib/api.js'
import type { BuildChoice, CityBuildOptions, CityProduction, PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import { BoardView } from './BoardView.js'
import type { PickSquares } from './BoardView.js'
import { BuildBar, BuildPicker } from './BuildPicker.js'
import { OPTIONS_CHANGED, SQUARE_GONE, useBuildFlow } from './buildFlow.js'
import { CitiesPanel } from './CitiesPanel.js'
import type { Run } from './GameView.js'

beforeEach(() => {
  localStorage.setItem('civ.panel.cities', 'true')
  resetPendingRequestIds()
  vi.spyOn(api, 'boardAssets').mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.cities')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

// --- fixtures ---------------------------------------------------------------

const LIBRARY: BuildChoice = {
  assetId: 'buildings/library',
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
  label: 'Harbor',
  cost: 5,
  tradeToPay: 3,
  squares: [{ column: 2, row: 3, label: 'C4' }],
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
      { assetId: 'buildings/market', label: 'Market', reason: 'Needs the Currency tech.' },
      { assetId: 'buildings/granary', label: 'Granary', reason: 'No legal square: D4 is forest.' },
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

  it('lists each choice with its cost, the trade it pays and its number of squares', () => {
    renderPicker(options())
    const list = screen.getByRole('list', { name: 'Buildings Capital D5 can build' })
    const [library, harbor] = within(list).getAllByRole('listitem')
    expect(library?.textContent).toContain('Library')
    expect(library?.textContent).toContain('Cost 6')
    expect(library?.textContent).not.toContain('trade')
    expect(library?.textContent).toContain('2 squares')
    expect(harbor?.textContent).toContain('Cost 5, pays 3 trade')
    expect(harbor?.textContent).toContain('1 square')
    expect(harbor?.textContent).not.toContain('1 squares')
  })

  it.each([
    ['override', 'Production 4, set by hand.'],
    ['building-program', 'Production 4, with the Building Program.'],
    ['estimate', 'Production 4, estimate.'],
  ] as const)('says where the production figure comes from: %s', (source, line) => {
    renderPicker(options({ productionSource: source }))
    expect(screen.getByText(line)).toBeTruthy()
  })

  it('keeps the reasons for the other buildings folded under Why not the others', () => {
    renderPicker(options())
    const details = screen.getByText('Why not the others (2)').closest('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    const reasons = within(details as HTMLElement).getByRole('list', { hidden: true })
    expect(reasons.textContent).toContain('Market: Needs the Currency tech.')
    expect(reasons.textContent).toContain('Granary: No legal square: D4 is forest.')
  })

  it('says plainly when nothing can be built, and points at the reasons and at setting production by hand', () => {
    renderPicker(options({ choices: [] }))
    expect(screen.queryByRole('list', { name: 'Buildings Capital D5 can build' })).toBeNull()
    expect(screen.getByText(/Nothing can be built in this city right now/).textContent).toMatch(
      /Why not the others.*set the city.s production by hand/s,
    )
    expect(screen.getByText('Why not the others (2)')).toBeTruthy()
  })

  it('shows the reason instead of a list when the phase is wrong', () => {
    renderPicker(options({ status: 'wrong-phase', reason: 'Only in your open City Management phase.', choices: [], unavailable: [] }))
    expect(screen.getByText('Only in your open City Management phase.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Choose/ })).toBeNull()
  })

  it('hands the chosen building to the caller', () => {
    const { onChoose, onClose } = renderPicker(options())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Harbor' }))
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

/** The page as GameView wires it: the Cities panel, the bar and the board share one flow. */
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
      <CitiesPanel gameId="g1" view={view} busy={false} readOnly={readOnly} run={run} build={flow} />
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

describe('the Build button in the Cities panel', () => {
  it('is on the viewer’s own city and opens the picker', () => {
    render(<Harness initial={viewOf([options()])} />)
    expect(buildButton().disabled).toBe(false)
    expect(screen.queryByRole('region', { name: 'Build in Capital D5' })).toBeNull()
    fireEvent.click(buildButton())
    expect(screen.getByRole('region', { name: 'Build in Capital D5' })).toBeTruthy()
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
    expect(screen.getByText('City H9')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    unmount()

    const spectator = render(<Harness initial={viewOf(undefined, { spectator: true, theirs: [theirs] })} />)
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    spectator.unmount()

    // A replayed view has the options blanked, and the panel is read only.
    const replay = render(<Harness initial={viewOf([])} readOnly />)
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    replay.unmount()

    render(<CitiesPanel gameId="g1" view={viewOf([options()])} busy={false} readOnly={false} run={async () => undefined} />)
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
  })
})

// --- picking a square and confirming ------------------------------------------

describe('square picking and Confirm', () => {
  const startHarbor = (): void => {
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Harbor' }))
  }
  const startLibrary = (): void => {
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
  }

  it('has no square buttons until a choice is made', () => {
    render(<Harness initial={viewOf([options()])} />)
    expect(overlays()).toHaveLength(0)
    fireEvent.click(buildButton())
    expect(overlays()).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()
  })

  it('choosing shows the squares, a bar with the item, city, cost and trade, and a Confirm that waits for a square', () => {
    render(<Harness initial={viewOf([options()])} />)
    startHarbor()
    expect(overlays().map((button) => button.getAttribute('aria-label'))).toEqual(['Place Harbor on C4'])
    expect(bar().textContent).toContain('Build Harbor in Capital D5')
    expect(bar().textContent).toContain('Cost 5')
    expect(bar().textContent).toContain('Pays 3 trade')
    expect(bar().textContent).toContain('Tap a highlighted square')
    expect(confirm().disabled).toBe(true)
    expect(confirm().textContent).toBe('Confirm and pay 3 trade')
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

  it('selects a square with a click, shows it, and Confirm opens; the squares are real buttons a keyboard can reach', () => {
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    const [d5, e5] = overlays()
    if (d5 === undefined || e5 === undefined) throw new Error('squares missing')
    expect(d5.tagName).toBe('BUTTON')
    d5.focus()
    expect(document.activeElement).toBe(d5)
    expect(d5.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(d5)
    expect(d5.getAttribute('aria-pressed')).toBe('true')
    expect(bar().textContent).toContain('Square D5')
    expect(confirm().disabled).toBe(false)

    fireEvent.click(e5)
    expect(d5.getAttribute('aria-pressed')).toBe('false')
    expect(e5.getAttribute('aria-pressed')).toBe('true')
    expect(bar().textContent).toContain('Square E5')
  })

  it('sends exactly one build request with the payload, no rush when no trade is due, then clears', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([options()])} />)
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on E5' }))
    fireEvent.click(confirm())
    fireEvent.click(confirm())

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

  it('agrees to the rush when trade is due', async () => {
    const send = vi.spyOn(api, 'build').mockResolvedValue({} as PlayerView)
    render(<Harness initial={viewOf([options()])} />)
    startHarbor()
    fireEvent.click(screen.getByRole('button', { name: 'Place Harbor on C4' }))
    fireEvent.click(confirm())
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
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))
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
    const field = screen.getByRole('textbox', { name: /^Production, set by hand/ })
    field.focus()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(overlays()).toHaveLength(2)
  })

  it('shows the server’s message in the bar and keeps the plan when the choice is still offered', async () => {
    vi.spyOn(api, 'build').mockRejectedValue(new ApiError(422, 'BUILD_REFUSED', 'That square was taken a moment ago.'))
    render(<Harness initial={viewOf([options()])} refresh={() => viewOf([options()], { rev: 8 })} />)
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))
    fireEvent.click(confirm())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That square was taken a moment ago.')
    expect(bar().contains(alert)).toBe(true)
    // Still planning: squares, the chosen one and Confirm are as they were.
    expect(overlays()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Place Library on D5' }).getAttribute('aria-pressed')).toBe('true')
    expect(confirm().disabled).toBe(false)
  })

  it('drops the plan and goes back to the picker with the reason when the refusal took the choice away', async () => {
    vi.spyOn(api, 'build').mockRejectedValue(new ApiError(422, 'BUILD_REFUSED', 'Supply of Library is used up.'))
    const fresh = viewOf([options({ choices: [HARBOR], unavailable: [{ assetId: 'buildings/library', label: 'Library', reason: 'No Library left in the supply.' }] })], { rev: 8 })
    render(<Harness initial={viewOf([options()])} refresh={() => fresh} />)
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))
    fireEvent.click(confirm())

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
    fireEvent.click(confirm())
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
      fireEvent.click(confirm())
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
    fireEvent.click(confirm())
    expect(send).toHaveBeenCalledTimes(1)

    // Cancel and choose the same square again while the first request has no answer.
    fireEvent.click(within(bar()).getByRole('button', { name: 'Cancel' }))
    startLibrary()
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))
    fireEvent.click(confirm())
    await act(async () => { await Promise.resolve() })

    expect(send).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('The building was not built.')).toBeNull()
    expect(confirm().disabled).toBe(false)
    await act(async () => { answer({} as PlayerView) })
  })
})

describe('Back to the picker', () => {
  it('opens the Cities panel first when it was collapsed after the Build started', async () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
    const toggle = document.querySelector<HTMLElement>('[aria-controls="cities-content"]')
    if (toggle === null) throw new Error('Cities toggle missing')
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

  it('leaves an open Cities panel as it is and goes straight to the picker', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
    act(() => handle.setView(viewOf([options({ choices: [HARBOR] })], { rev: 9 })))

    fireEvent.click(screen.getByRole('button', { name: 'Back to the picker' }))
    expect(document.querySelector('[aria-controls="cities-content"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(document.getElementById('build-picker'))
  })
})

// --- refreshes ------------------------------------------------------------------

describe('a refresh while planning', () => {
  it('keeps the plan and the chosen square when the options are the same', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))

    // New objects, a new revision, the same options: what auto refresh brings.
    act(() => handle.setView(viewOf([options()], { rev: 9 })))
    expect(overlays()).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Place Library on D5' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('status')).toBeNull()
    expect(confirm().disabled).toBe(false)
  })

  it('drops the plan with a note when the choice is no longer offered, and reopens the picker', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))

    act(() => handle.setView(viewOf([options({ status: 'wrong-phase', reason: 'Not now.', choices: [], unavailable: [] })], { rev: 9 })))
    expect(overlays()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe(OPTIONS_CHANGED)
  })

  it('drops the plan with a note when its city is no longer in the options at all', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
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
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
    fireEvent.click(screen.getByRole('button', { name: 'Place Library on D5' }))

    act(() => handle.setView(viewOf([options({ choices: [{ ...LIBRARY, squares: [LIBRARY.squares[1] as BuildChoice['squares'][number]] }, HARBOR] })], { rev: 9 })))
    expect(overlays().map((button) => button.getAttribute('aria-label'))).toEqual(['Place Library on E5'])
    expect(screen.getByRole('status').textContent).toBe(SQUARE_GONE)
    expect(confirm().disabled).toBe(true)
  })

  it('takes a changed cost from the fresh options', () => {
    const handle: Handle = { setView: () => undefined }
    render(<Harness initial={viewOf([options()])} handle={handle} />)
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
    expect(bar().textContent).not.toContain('Pays')

    act(() => handle.setView(viewOf([options({ choices: [{ ...LIBRARY, tradeToPay: 6 }, HARBOR] })], { rev: 9 })))
    expect(bar().textContent).toContain('Pays 6 trade')
  })

  it('clears everything when the viewer can no longer build, as in a replay', () => {
    const { rerender } = render(<Harness initial={viewOf([options()])} />)
    fireEvent.click(buildButton())
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
    expect(overlays()).toHaveLength(2)

    rerender(<Harness initial={viewOf([options()])} readOnly />)
    expect(overlays()).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()
  })
})
