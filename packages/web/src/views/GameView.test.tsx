// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '@civ/engine'

import { useIsBusy } from '../lib/activity.js'
import { ApiError, api } from '../lib/api.js'
import type { GameRevisionSummary, PlayerDto, PlayerView } from '../lib/api.js'
import type { GameMenuActions } from './Navigation.js'
import { BOARD_PANEL_ID } from './PhaseSummary.js'
import {
  AUTO_REFRESH_MS,
  BattlePanel,
  GameView,
  activePlayerOf,
  chatAuthorsOf,
  HandItem,
  gameMenuGate,
  winnerCandidatesOf,
  loadAfterKnownRevision,
  reloadIfRevisionChanged,
} from './GameView.js'

vi.mock('./BoardView.js', () => ({
  BoardView: ({ viewerIsRussia, pickSquares }: { viewerIsRussia?: boolean; pickSquares?: { cells: readonly unknown[] } }) => (
    <section
      id={BOARD_PANEL_ID}
      tabIndex={-1}
      data-testid="board"
      data-viewer-is-russia={String(viewerIsRussia)}
      data-pick-count={pickSquares === undefined ? 'off' : String(pickSquares.cells.length)}
    />
  ),
}))
// Only the panel is replaced; the helpers GameView uses stay real
vi.mock('./ChatOrdersPanel.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ChatOrdersPanel.js')>()),
  ChatOrdersPanel: () => <section><h2>Chat and orders</h2></section>,
}))
vi.mock('./LogPanel.js', () => ({ LogPanel: () => <section><h2>Log</h2></section> }))
vi.mock('./OpponentHandPanel.js', () => ({ OpponentHandPanel: () => <section><h2>Other players' hands</h2></section> }))
vi.mock('./RevealedPanel.js', () => ({ RevealedPanel: () => <section><h2>Revealed</h2></section> }))
vi.mock('./SocialPolicyPanel.js', () => ({ SocialPolicyPanel: () => <section><h2>Social policy</h2></section> }))
vi.mock('./StatusPanel.js', () => ({ StatusPanel: () => <section><h2>Player status</h2></section> }))
vi.mock('./TechPanel.js', () => ({ TechPanel: () => <section><h2>Techs</h2></section> }))
vi.mock('./WondersPanel.js', () => ({ WondersPanel: () => <section><h2>Wonders</h2></section> }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The reload only reads `rev`, so the rest of the view is irrelevant here. */
const viewAt = (rev: number): PlayerView => ({ rev }) as unknown as PlayerView

const revisionsUpTo = (revision: number): readonly GameRevisionSummary[] =>
  [{ revision }] as unknown as readonly GameRevisionSummary[]

const you = (overrides: Partial<PlayerView['you']> = {}): PlayerView['you'] =>
  ({ playerId: 'p1', gameCreator: false, ...overrides }) as unknown as PlayerView['you']

describe('gameMenuGate', () => {
  it('offers nothing while the game has not loaded yet', () => {
    expect(gameMenuGate(null, false, false)).toBeNull()
  })

  it('offers nothing to a plain spectator', () => {
    expect(gameMenuGate({ you: null, active: true }, false, false)).toBeNull()
  })

  it('offers Withdraw only, disabled once the game has ended, to an ordinary player', () => {
    expect(gameMenuGate({ you: you(), active: true }, false, false)).toEqual({
      canWithdraw: true,
      withdrawDisabled: false,
      canDelete: false,
      deleteDisabled: false,
      canEnd: false,
      endDisabled: false,
    })
    expect(gameMenuGate({ you: you(), active: false }, false, false)?.withdrawDisabled).toBe(true)
  })

  it('offers both, to the game creator', () => {
    expect(gameMenuGate({ you: you({ gameCreator: true }), active: true }, false, false)).toEqual({
      canWithdraw: true,
      withdrawDisabled: false,
      canDelete: true,
      deleteDisabled: false,
      canEnd: true,
      endDisabled: false,
    })
  })

  it('offers End game to the creator and an admin, never to another player or a spectator', () => {
    expect(gameMenuGate({ you: you({ gameCreator: true }), active: true }, false, false)?.canEnd).toBe(true)
    expect(gameMenuGate({ you: you(), active: true }, true, false)?.canEnd).toBe(true)
    // An admin who never joined has `you === null` and still gets it.
    expect(gameMenuGate({ you: null, active: true }, true, false)?.canEnd).toBe(true)
    expect(gameMenuGate({ you: you(), active: true }, false, false)?.canEnd).toBe(false)
    expect(gameMenuGate({ you: null, active: true }, false, false)).toBeNull()
  })

  it('hides End game once the game has ended, even for the creator and an admin', () => {
    expect(gameMenuGate({ you: you({ gameCreator: true }), active: false }, false, false)?.canEnd).toBe(false)
    expect(gameMenuGate({ you: null, active: false }, true, false)?.canEnd).toBe(false)
  })

  // The regression this pins: an admin who is not a player in the game (`you`
  // is `null`) must still get Delete — old-civ-web's own "Admin settings"
  // dropdown gated Delete on the admin flag alone, never on membership. An
  // admin has no hand to withdraw, so Withdraw stays absent.
  it('offers Delete but not Withdraw to an admin who never joined', () => {
    // `withdrawDisabled` only reflects busy/game-active state; the button is
    // never rendered at all for this viewer, gated by `canWithdraw` instead.
    expect(gameMenuGate({ you: null, active: true }, true, false)).toEqual({
      canWithdraw: false,
      withdrawDisabled: false,
      canDelete: true,
      deleteDisabled: false,
      canEnd: true,
      endDisabled: false,
    })
  })

  it('disables the actions while an action is already in flight', () => {
    expect(gameMenuGate({ you: you(), active: true }, false, true)).toEqual({
      canWithdraw: true,
      withdrawDisabled: true,
      canDelete: false,
      deleteDisabled: true,
      canEnd: false,
      endDisabled: true,
    })
  })
})

describe('game auto-refresh', () => {
  // The human asked for 10 s specifically ("setter auto refresh til 10
  // sekunder"); the toggle was introduced at 30 s (issue #63). This fails if
  // the interval is changed back without a decision.
  it('checks the live game every 10 seconds', () => {
    expect(AUTO_REFRESH_MS).toBe(10_000)
  })

  it('checks only the marker and skips a full reload when unchanged', async () => {
    const readRevision = vi.fn(async () => 7)
    const reload = vi.fn(async () => true)
    expect(await reloadIfRevisionChanged(readRevision, () => 7, reload)).toBe(false)
    expect(readRevision).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads after the marker changes', async () => {
    const reload = vi.fn(async () => true)
    expect(await reloadIfRevisionChanged(async () => 8, () => 7, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('loadAfterKnownRevision', () => {
  it('skips the revision list when the live revision has not moved', async () => {
    const loadRevisions = vi.fn(async () => revisionsUpTo(7))
    const loadView = vi.fn(async () => viewAt(7))

    const result = await loadAfterKnownRevision(loadRevisions, loadView, 7)

    expect(result.revisions).toBeNull()
    expect(loadRevisions).not.toHaveBeenCalled()
    expect(loadView).toHaveBeenCalledTimes(1)
  })

  it('reads the consistent history pair when the live revision has moved', async () => {
    const revisions = revisionsUpTo(8)
    const loadRevisions = vi.fn(async () => revisions)
    const loadView = vi.fn(async () => viewAt(8))

    const result = await loadAfterKnownRevision(loadRevisions, loadView, 7)

    expect(result.revisions).toBe(revisions)
    expect(loadRevisions).toHaveBeenCalledTimes(1)
    // History is read first (#70), so the view is read a second time here.
    expect(loadView).toHaveBeenCalledTimes(2)
  })

  it('still pairs a revision that moved without a new revision, like a private note', async () => {
    // A private note advances `rev` but writes no revision, so the newest
    // revision is older than the view. The pair must still be accepted.
    const revisions = revisionsUpTo(3)
    const loadRevisions = vi.fn(async () => revisions)
    const loadView = vi.fn(async () => viewAt(4))

    const result = await loadAfterKnownRevision(loadRevisions, loadView, 3)

    expect(result.revisions).toBe(revisions)
    expect(loadRevisions).toHaveBeenCalledTimes(1)
  })
})

const base = {
  itemNumber: 1,
  description: null,
  used: false,
  hidden: true,
  ownerId: 'player-me',
  type: null,
} as const

const run = async (action: () => Promise<unknown>): Promise<void> => {
  await action()
}

const orderView = (overrides: Record<string, unknown> = {}): PlayerView =>
  ({
    rev: 1,
    name: 'Panel order test',
    active: true,
    winner: null,
    activeTurn: null,
    you: null,
    opponents: [],
    board: {},
    boardAreas: [],
    numOfPlayers: 2,
    battle: null,
    battleSummary: [],
    ...overrides,
  }) as unknown as PlayerView

const renderOrder = async (view: PlayerView, player: PlayerDto | null = { username: 'viewer' } as unknown as PlayerDto) => {
  localStorage.setItem('civ.autoRefresh', 'false')
  vi.spyOn(api, 'game').mockResolvedValue(view)
  vi.spyOn(api, 'revisions').mockResolvedValue([])
  const rendered = render(
    <GameView
      gameId="game-1"
      player={player}
      onUnauthorized={vi.fn()}
      onDeleted={vi.fn()}
      onWithdrawn={vi.fn()}
      onEnded={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Draw' })).toBeTruthy())
  return rendered
}

/** The page top to bottom: each panel heading, and the board, after the header's own title. */
const pageOrder = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('h1, h2, [data-testid="board"]'))
    .slice(1)
    // A collapsible heading ends with its open or closed sign
    .map((element) => (element.getAttribute('data-testid') === 'board' ? 'Board' : (element.textContent ?? '').replace(/[−+]$/, '')))

describe('primary game panel order', () => {
  // Changed on purpose (#260): the board no longer follows the header directly.
  // It was header, board, Draw, Chat and orders, Log, Your hand, and so on.
  it('runs Your actions, the board, Your cards, Draw, the tech tree, chat, the rest, then the log and the revealed feed', async () => {
    const view = orderView({
      you: {
        playerId: 'p1',
        username: 'viewer',
        items: [],
        pendingRewards: [],
        availableActions: [{ action: 'cultureAdvance', label: 'Culture', status: 'ready', reason: 'Ready' }],
      },
    })
    const { container } = await renderOrder(view)

    expect(pageOrder(container)).toEqual([
      'Your actions',
      'Board',
      'Your hand (0)',
      'Draw',
      'Techs',
      'Chat and orders',
      "Other players' hands",
      'Battle',
      'Social policy',
      'Player status',
      'Cities (0)',
      'Wonders',
      'Log',
      'Revealed',
    ])
  })

  it('has Your cards directly under the board, and no Your actions panel when there is nothing to show', async () => {
    const { container } = await renderOrder(orderView())
    const board = screen.getByTestId('board')
    const panelStack = container.querySelector('.panel-stack')
    const hand = screen.getByRole('heading', { name: 'Your hand (0)' }).closest('section')

    expect(board.nextElementSibling).toBe(panelStack)
    expect(panelStack?.children[0]).toBe(hand)
    expect(screen.queryByRole('heading', { name: 'Your actions' })).toBeNull()
  })

  it('leaves the chat panel out for a spectator without an account, and its shortcut with it', async () => {
    const { container } = await renderOrder(orderView(), null)
    expect(pageOrder(container)).not.toContain('Chat and orders')
    expect(screen.getByRole('navigation', { name: 'Go to' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull()
  })
})

describe('game page shortcuts', () => {
  const scrolled: Element[] = []

  beforeEach(() => {
    scrolled.length = 0
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
  })

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('scrolls the board into view and focuses it', async () => {
    await renderOrder(orderView())
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    expect(scrolled).toEqual([screen.getByTestId('board')])
    expect(document.activeElement).toBe(screen.getByTestId('board'))
  })

  it('scrolls Your cards into view and focuses its heading button', async () => {
    await renderOrder(orderView())
    fireEvent.click(screen.getByRole('button', { name: 'Your cards' }))
    const heading = screen.getByRole('heading', { name: 'Your hand (0)' })
    expect(scrolled).toEqual([heading.closest('section')])
    expect(document.activeElement).toBe(heading.querySelector('button'))
  })
})

const seat = (
  username: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  playerId: `id-${username}`,
  username,
  color: null,
  civilization: null,
  cities: [],
  ...overrides,
})

const headerView = (
  youSeat: Record<string, unknown> | null,
  opponents: readonly Record<string, unknown>[],
  activeUsername: string | null,
): PlayerView =>
  ({
    rev: 1,
    name: 'Header test',
    active: true,
    winner: null,
    activeTurn:
      activeUsername === null
        ? null
        : { playerId: `id-${activeUsername}`, username: activeUsername, turnNumber: 1, phase: 'SOT', waitingFor: [{ username: activeUsername, phase: 'SOT' }] },
    you: youSeat,
    opponents,
    board: {},
    boardAreas: [],
    numOfPlayers: 2,
    battle: null,
    battleSummary: [],
  }) as unknown as PlayerView

async function renderHeader(view: PlayerView): Promise<HTMLElement> {
  localStorage.setItem('civ.autoRefresh', 'false')
  vi.spyOn(api, 'game').mockResolvedValue(view)
  vi.spyOn(api, 'revisions').mockResolvedValue([])
  const { container } = render(
    <GameView
      gameId="game-1"
      player={{ username: 'viewer' } as unknown as PlayerDto}
      onUnauthorized={vi.fn()}
      onDeleted={vi.fn()}
      onWithdrawn={vi.fn()}
      onEnded={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy())
  return container
}

describe('game header chips (issue #206)', () => {
  const greeks = { name: 'Greeks' }
  const chipTexts = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll('.header-chips .tag')).map((tag) => tag.textContent?.trim() ?? '')

  it('shows the active opponent\'s civ, then colour, before the title, not the viewer\'s', async () => {
    const container = await renderHeader(
      headerView(
        seat('viewer', { civilization: { name: 'Romans' }, color: 'Red' }),
        [seat('s3s3', { civilization: greeks, color: 'Green' })],
        's3s3',
      ),
    )

    expect(chipTexts(container)).toEqual(['Greeks', 'Green'])
    const chips = container.querySelector('.header-chips')
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe("Turn 1 · s3s3's turn — start of turn phase")
    // Chips first, title straight after them in the same row
    expect(chips?.nextElementSibling).toBe(title)
    expect(container.textContent).not.toContain('Romans')
  })

  it('shows the viewer\'s own chips on their turn', async () => {
    const container = await renderHeader(
      headerView(
        seat('viewer', { civilization: { name: 'Romans' }, color: 'Red' }),
        [seat('s3s3', { civilization: greeks, color: 'Green' })],
        'viewer',
      ),
    )
    expect(chipTexts(container)).toEqual(['Romans', 'Red'])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Your turn')
  })

  it('has no civ chip while the civilization is not revealed', async () => {
    const container = await renderHeader(
      headerView(seat('viewer'), [seat('s3s3', { color: 'Blue' })], 's3s3'),
    )
    expect(chipTexts(container)).toEqual(['Blue'])
    expect(container.querySelector('.tag.revealed')).toBeNull()
  })

  it('has no chips at all before anyone has a turn, colour or civ', async () => {
    const container = await renderHeader(headerView(null, [seat('s3s3')], null))
    expect(container.querySelector('.header-chips')).toBeNull()
  })
})

describe('the white army is offered to Russia only (issue #204)', () => {
  const flag = async (civilization: { name: string } | null): Promise<string | null> => {
    await renderHeader(headerView(seat('viewer', { civilization }), [seat('s3s3')], null))
    return screen.getByTestId('board').getAttribute('data-viewer-is-russia')
  }

  it('tells the board the viewer is Russia only when their civ is the Russians', async () => {
    expect(await flag({ name: 'Russians' })).toBe('true')
  })

  it('does not for another civ, or before the civ is revealed', async () => {
    expect(await flag({ name: 'Romans' })).toBe('false')
    cleanup()
    expect(await flag(null)).toBe('false')
  })
})

describe('End game wiring', () => {
  const seatNo = (username: string, playernumber: number, overrides: Record<string, unknown> = {}) =>
    seat(username, { playernumber, ...overrides })

  it('lists every seat by username in seat order, and nothing else about them', () => {
    const view = headerView(
      seatNo('viewer', 2, { gameCreator: true, secretHandCard: 'TOP-SECRET-CARD' }),
      [seatNo('s3s3', 3), seatNo('ola', 1)],
      null,
    )
    const names = winnerCandidatesOf(view)
    expect(names).toEqual(['ola', 'viewer', 's3s3'])
    expect(JSON.stringify(names)).not.toContain('TOP-SECRET-CARD')
  })

  it('is just the opponents for a spectator', () => {
    expect(winnerCandidatesOf(headerView(null, [seatNo('s3s3', 2), seatNo('ola', 1)], null))).toEqual(['ola', 's3s3'])
  })

  const renderWithMenu = async (
    view: PlayerView,
    role: 'user' | 'admin',
    onEnded: () => void = vi.fn(),
  ): Promise<() => GameMenuActions | null> => {
    localStorage.setItem('civ.autoRefresh', 'false')
    vi.spyOn(api, 'game').mockResolvedValue(view)
    vi.spyOn(api, 'revisions').mockResolvedValue([])
    const latest: { current: GameMenuActions | null } = { current: null }
    render(
      <GameView
        gameId="game-1"
        player={{ username: 'viewer', role } as unknown as PlayerDto}
        onUnauthorized={vi.fn()}
        onDeleted={vi.fn()}
        onWithdrawn={vi.fn()}
        onEnded={onEnded}
        onGameActions={(actions) => { latest.current = actions }}
      />,
    )
    await waitFor(() => expect(latest.current).not.toBeNull())
    return () => latest.current
  }

  const creatorView = (): PlayerView =>
    headerView(
      seatNo('viewer', 1, { gameCreator: true }),
      [seatNo('s3s3', 2), seatNo('ola', 3)],
      null,
    )

  it('hands the menu the End game gate and the winner list', async () => {
    const menu = await renderWithMenu(creatorView(), 'user')
    expect(menu()?.canEnd).toBe(true)
    expect(menu()?.endDisabled).toBe(false)
    expect(menu()?.endPlayers).toEqual(['viewer', 's3s3', 'ola'])
  })

  it('does not offer End game to a player who is not the creator', async () => {
    const view = headerView(seatNo('viewer', 1), [seatNo('s3s3', 2, { gameCreator: true })], null)
    const menu = await renderWithMenu(view, 'user')
    expect(menu()?.canEnd).toBe(false)
  })

  it('does not offer End game once the game has ended', async () => {
    const menu = await renderWithMenu({ ...creatorView(), active: false }, 'user')
    expect(menu()?.canEnd).toBe(false)
  })

  it('ends the game with the chosen winner and leaves the game', async () => {
    const endGame = vi.spyOn(api, 'endGame').mockResolvedValue(creatorView())
    const onEnded = vi.fn()
    const menu = await renderWithMenu(creatorView(), 'user', onEnded)

    menu()?.onEnd('s3s3')

    await waitFor(() => expect(endGame).toHaveBeenCalledTimes(1))
    expect(endGame).toHaveBeenCalledWith('game-1', 's3s3')
    await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1))
  })

  it('tells the global spinner the game is busy from the click until the reload is done (issue #225)', async () => {
    let finish: (view: PlayerView) => void = () => {}
    vi.spyOn(api, 'endGame').mockReturnValue(new Promise<PlayerView>((resolve) => { finish = resolve }))
    const menu = await renderWithMenu(creatorView(), 'user')
    const busy = renderHook(() => useIsBusy())
    expect(busy.result.current).toBe(false)

    act(() => menu()?.onEnd('s3s3'))
    await waitFor(() => expect(busy.result.current).toBe(true))

    await act(async () => { finish(creatorView()) })
    await waitFor(() => expect(busy.result.current).toBe(false))
  })

  it('stays on the game when ending it fails', async () => {
    vi.spyOn(api, 'endGame').mockRejectedValue(new Error('boom'))
    const onEnded = vi.fn()
    const menu = await renderWithMenu(creatorView(), 'user', onEnded)

    menu()?.onEnd(undefined)

    await screen.findByText('boom')
    expect(onEnded).not.toHaveBeenCalled()
  })

  it('ends the game without a winner argument for No winner', async () => {
    const endGame = vi.spyOn(api, 'endGame').mockResolvedValue(creatorView())
    const menu = await renderWithMenu(creatorView(), 'admin')

    menu()?.onEnd(undefined)

    await waitFor(() => expect(endGame).toHaveBeenCalledTimes(1))
    expect(endGame).toHaveBeenCalledWith('game-1')
  })
})

describe('chatAuthorsOf and activePlayerOf (issue #206)', () => {
  it('maps every seat by username and leaves an unrevealed civilization null', () => {
    const view = headerView(
      seat('viewer', { civilization: { name: 'Romans' }, color: 'Red' }),
      [seat('s3s3', { color: 'Green' })],
      null,
    )
    expect(chatAuthorsOf(view)).toEqual(
      new Map([
        ['viewer', { civilization: 'Romans', color: 'Red' }],
        ['s3s3', { civilization: null, color: 'Green' }],
      ]),
    )
  })

  it('finds the holder of the active turn among the seats, the viewer included', () => {
    const view = headerView(seat('viewer'), [seat('s3s3')], 's3s3')
    expect(activePlayerOf(view)?.username).toBe('s3s3')
    expect(activePlayerOf(headerView(seat('viewer'), [seat('s3s3')], 'viewer'))?.username).toBe('viewer')
  })

  it('names nobody when the active turn belongs to someone who left, or there is none', () => {
    expect(activePlayerOf(headerView(seat('viewer'), [seat('s3s3')], 'someone-who-left'))).toBeUndefined()
    expect(activePlayerOf(headerView(seat('viewer'), [seat('s3s3')], null))).toBeUndefined()
  })
})

describe('HandPanel groups items by kind (issue #190 follow-up)', () => {
  it('orders hand cards by old-civ-web bucket, not draw order, with no headings', async () => {
    localStorage.setItem('civ.autoRefresh', 'false')
    const village: Item = { ...base, id: 'village-1', sheetName: 'VILLAGES', kind: 'village', name: 'Village A' }
    const hut: Item = { ...base, id: 'hut-1', sheetName: 'HUTS', kind: 'hut', name: 'Hut A' }
    const culture: Item = { ...base, id: 'culture-1', sheetName: 'CULTURE_1', kind: 'cultureI', name: 'Culture A' }
    // Exercises the `default` arm of `bucketFor`: a wonder (falls into the
    // catch-all "Items" bucket, along with tech/city-state/social policy) and
    // an infantry unit (the "Units" bucket) — both deleted from
    // RevealedPanel.test.tsx by this same change, so covered here instead.
    const wonder: Item = {
      ...base, id: 'wonder-1', sheetName: 'ANCIENT_WONDERS', kind: 'wonder', name: 'Wonder A', type: 'Ancient',
    }
    const infantry: Item = {
      ...base, id: 'infantry-1', sheetName: 'INFANTRY', kind: 'infantry',
      attack: 1, health: 3, level: 0, killed: false, inBattle: false,
    }
    // Draw order (as stored in `you.items`) is village, hut, culture, wonder,
    // infantry; the fixed old-client bucket order (Items, Units, Culture
    // Cards, Huts, Villages) reorders that into wonder, infantry, culture,
    // hut, village.
    const view = {
      rev: 1,
      name: 'Hand grouping test',
      active: true,
      winner: null,
      activeTurn: null,
      you: { items: [village, hut, culture, wonder, infantry] },
      opponents: [],
      board: {},
      boardAreas: [],
      numOfPlayers: 2,
      battle: null,
      battleSummary: [],
    } as unknown as PlayerView
    vi.spyOn(api, 'game').mockResolvedValue(view)
    vi.spyOn(api, 'revisions').mockResolvedValue([])

    render(
      <GameView
        gameId="game-1"
        player={{ username: 'viewer' } as unknown as PlayerDto}
        onUnauthorized={vi.fn()}
        onDeleted={vi.fn()}
        onWithdrawn={vi.fn()}
        onEnded={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Culture A')).toBeTruthy())

    const hand = screen.getByRole('heading', { name: 'Your hand (5)' }).closest('section')
    const sequence = Array.from(
      hand?.querySelectorAll('li.card strong') ?? [],
    ).map((node) => node.textContent)
    expect(hand?.querySelectorAll('.item-group-heading')).toHaveLength(0)
    expect(hand?.querySelectorAll('ul.card-grid > li')).toHaveLength(5)
    expect(sequence).toEqual([
      'Wonder A',
      'Infantry 1.3',
      'Culture A',
      'Hut: Hut A',
      'Village: Village A',
    ])
  })
})

/**
 * New in this port — see the pyramid-reposition task brief. "Place in tech
 * pyramid" must appear only for Sir Isaac Newton, by exact name match, never
 * for any other Great Person.
 */
describe('HandItem: place a Great Person in the tech pyramid (#168 follow-up)', () => {
  const newton: Item = {
    ...base,
    id: 'gp-newton',
    sheetName: 'GREAT_PERSON',
    kind: 'greatperson',
    name: 'Sir Isaac Newton',
    type: 'Scientist',
  }

  const otherGreatPerson: Item = {
    ...base,
    id: 'gp-other',
    sheetName: 'GREAT_PERSON',
    kind: 'greatperson',
    name: 'Louis Pasteur',
    type: 'Scientist',
  }

  it('shows the control only for Sir Isaac Newton, by exact name match', () => {
    const { unmount } = render(
      <HandItem item={newton} gameId="g" busy={false} run={run} opponents={[]} />,
    )
    expect(screen.getByRole('button', { name: 'Place in tech pyramid' })).toBeTruthy()
    unmount()

    render(<HandItem item={otherGreatPerson} gameId="g" busy={false} run={run} opponents={[]} />)
    expect(screen.queryByRole('button', { name: 'Place in tech pyramid' })).toBeNull()
  })

  it('calls placeGreatPersonInPyramid with the item id and the chosen row', () => {
    const place = vi.spyOn(api, 'placeGreatPersonInPyramid').mockResolvedValue({} as PlayerView)
    render(<HandItem item={newton} gameId="game-1" busy={false} run={run} opponents={[]} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Pyramid row for Sir Isaac Newton' }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Place in tech pyramid' }))

    expect(place).toHaveBeenCalledWith('game-1', 'gp-newton', 3)
  })

  it('defaults the chosen row to 1', () => {
    const place = vi.spyOn(api, 'placeGreatPersonInPyramid').mockResolvedValue({} as PlayerView)
    render(<HandItem item={newton} gameId="game-1" busy={false} run={run} opponents={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Place in tech pyramid' }))

    expect(place).toHaveBeenCalledWith('game-1', 'gp-newton', 1)
  })
})

describe('a Great Person card whose tokens are blockaded (issue #241)', () => {
  const general: Item = {
    ...base,
    id: 'gp-general',
    sheetName: 'GREAT_PERSON',
    kind: 'greatperson',
    name: 'Sun Tzu',
    type: 'General',
  }

  it('shows a Blockaded tag and a struck-through card, and keeps the card usable', () => {
    const { container } = render(
      <HandItem item={general} gameId="g" busy={false} run={run} opponents={[]} blockaded />,
    )
    expect(screen.getByText('Blockaded')).toBeTruthy()
    expect(container.querySelector('li.card.card-blockaded')).not.toBeNull()
    // A marker, not a lock: discarding is still offered.
    expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows nothing extra on a card that is not blockaded', () => {
    const { container } = render(
      <HandItem item={general} gameId="g" busy={false} run={run} opponents={[]} />,
    )
    expect(screen.queryByText('Blockaded')).toBeNull()
    expect(container.querySelector('.card-blockaded')).toBeNull()
  })

  it('marks only the cards whose type is in the viewer’s blockaded types', async () => {
    localStorage.setItem('civ.autoRefresh', 'false')
    const scientist: Item = { ...general, id: 'gp-sci', name: 'Marie Curie', type: 'Scientist' }
    const view = {
      rev: 1,
      name: 'Blockade hand test',
      active: true,
      winner: null,
      activeTurn: null,
      you: { items: [general, scientist], blockadedGreatPersonTypes: ['General'] },
      opponents: [],
      board: {},
      boardAreas: [],
      blockadedPieceIds: [],
      numOfPlayers: 2,
      battle: null,
      battleSummary: [],
    } as unknown as PlayerView
    vi.spyOn(api, 'game').mockResolvedValue(view)
    vi.spyOn(api, 'revisions').mockResolvedValue([])

    render(
      <GameView
        gameId="game-1"
        player={{ username: 'viewer' } as unknown as PlayerDto}
        onUnauthorized={vi.fn()}
        onDeleted={vi.fn()}
        onWithdrawn={vi.fn()}
        onEnded={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText(/Sun Tzu/)).toBeTruthy())
    const hand = screen.getByRole('heading', { name: 'Your hand (2)' }).closest('section')
    expect(hand?.querySelectorAll('.card-blockaded')).toHaveLength(1)
    expect(hand?.querySelector('.card-blockaded')?.textContent).toContain('Sun Tzu')
    expect(hand?.querySelectorAll('.tag.blockaded')).toHaveLength(1)
  })
})

describe('the game page (issue #215)', () => {
  const chatSeat = (username: string, playernumber: number, overrides: Record<string, unknown> = {}) =>
    seat(username, { playernumber, ...overrides })

  /** Alice (the viewer) and Bob; `upUsername` is who the timeline says is up. */
  const chatView = (
    upUsername: string,
    overrides: Record<string, unknown> = {},
    youOverrides: Record<string, unknown> = {},
  ): PlayerView => {
    const you = chatSeat('Alice', 1, { color: 'Red', ...youOverrides })
    const bob = chatSeat('Bob', 2, { color: 'Blue' })
    return {
      ...headerView(you, [bob], upUsername),
      activeTurn: {
        playerId: `id-${upUsername}`,
        username: upUsername,
        turnNumber: 4,
        phase: 'CM',
        startPlayer: 'Bob',
        waitingFor: [
          { username: 'Alice', phase: 'CM' },
          { username: 'Bob', phase: 'SOT' },
        ],
      },
      ...overrides,
    } as unknown as PlayerView
  }

  const renderGame = async (
    view: PlayerView,
    role: 'user' | 'admin' = 'user',
    signedIn = true,
  ): Promise<void> => {
    localStorage.setItem('civ.autoRefresh', 'false')
    vi.spyOn(api, 'game').mockResolvedValue(view)
    vi.spyOn(api, 'revisions').mockResolvedValue([])
    render(
      <GameView
        gameId="game-1"
        player={signedIn ? ({ username: 'Alice', role } as unknown as PlayerDto) : null}
        onUnauthorized={vi.fn()}
        onDeleted={vi.fn()}
        onWithdrawn={vi.fn()}
        onEnded={vi.fn()}
      />,
    )
    await screen.findByRole('heading', { level: 1 })
  }

  const drawButton = (label: string): HTMLButtonElement =>
    screen.getByRole('button', { name: label }) as HTMLButtonElement

  describe('the page', () => {
    it('shows the timeline and says whose turn it is and the phase', async () => {
      await renderGame(chatView('Bob'))

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        "Turn 4 · Bob's turn — city management phase",
      )
      expect(screen.getByRole('heading', { name: 'Chat and orders' })).toBeTruthy()
      // The log stays
      expect(screen.getByRole('heading', { name: 'Log' })).toBeTruthy()
      expect(screen.getByRole('list', { name: 'Turn progress' }).textContent).toContain('BobSOT')
    })

    it('has no End turn or Take the turn buttons, because there is no baton', async () => {
      await renderGame(chatView('Alice'))

      expect(screen.queryByText('End turn')).toBeNull()
      expect(screen.queryByText('Take the turn')).toBeNull()
    })

    it('shows a signed-out spectator the log but not the timeline, which needs a player', async () => {
      await renderGame({ ...chatView('Bob'), you: null } as unknown as PlayerView, 'user', false)

      expect(screen.queryByRole('heading', { name: 'Chat and orders' })).toBeNull()
      expect(screen.getByRole('heading', { name: 'Log' })).toBeTruthy()
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Turn 4')
    })

    describe('an ended game', () => {
      const ended = (winner: string | null): PlayerView =>
        ({ ...chatView('Bob'), active: false, winner }) as unknown as PlayerView

      it('names the winner in the title, and claims nobody is up or waiting', async () => {
        await renderGame(ended('Alice'))

        const title = screen.getByRole('heading', { level: 1 }).textContent
        expect(title).toBe('Alice won the game')
        expect(title).not.toContain('Nobody is up')
        expect(title).not.toContain("Bob's turn")
        // The winner is not repeated in a second tag
        expect(screen.queryByText('Alice won')).toBeNull()
        expect(screen.getByText('ended')).toBeTruthy()
        expect(screen.queryByRole('list', { name: 'Turn progress' })).toBeNull()
        expect(screen.queryByRole('group', { name: 'Phase summary' })).toBeNull()
      })

      it('says the game ended when nobody won, with no second tag saying the same', async () => {
        await renderGame(ended(null))

        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Game ended')
        expect(screen.queryByText('ended')).toBeNull()
        expect(screen.queryByRole('list', { name: 'Turn progress' })).toBeNull()
      })

      it('shows no civ or colour chips for whoever was up when it ended', async () => {
        await renderGame(ended('Alice'))
        expect(document.querySelector('.header-chips')).toBeNull()
      })

      it('still draws the title of a running game from the active turn', async () => {
        await renderGame({ ...chatView('Bob'), active: true } as unknown as PlayerView)
        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain("Bob's turn")
      })
    })
  })

  describe('drawing out of turn', () => {
    it('asks first, and sends the confirmation only after Yes', async () => {
      const draw = vi.spyOn(api, 'draw').mockResolvedValue(chatView('Bob'))
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await renderGame(chatView('Bob'))

      fireEvent.click(drawButton('Civ'))

      expect(confirm).toHaveBeenCalledExactlyOnceWith('It is not your turn. Bob is up. Draw anyway?')
      await waitFor(() => expect(draw).toHaveBeenCalledExactlyOnceWith('game-1', 'CIV', true))
    })

    it('sends nothing after No', async () => {
      const draw = vi.spyOn(api, 'draw').mockResolvedValue(chatView('Bob'))
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      await renderGame(chatView('Bob'))

      fireEvent.click(drawButton('Civ'))

      expect(window.confirm).toHaveBeenCalledOnce()
      // Let a stray call settle before asserting there was none
      await Promise.resolve()
      expect(draw).not.toHaveBeenCalled()
    })

    it('covers wonders too, which the server draws through the same route', async () => {
      const draw = vi.spyOn(api, 'draw').mockResolvedValue(chatView('Bob'))
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await renderGame(chatView('Bob'))

      fireEvent.click(drawButton('Ancient wonder'))

      await waitFor(() => expect(draw).toHaveBeenCalledExactlyOnceWith('game-1', 'ANCIENT_WONDERS', true))
    })

    it('does not ask, or send the flag, when the viewer is the one who is up', async () => {
      const draw = vi.spyOn(api, 'draw').mockResolvedValue(chatView('Alice'))
      const confirm = vi.spyOn(window, 'confirm')
      await renderGame(chatView('Alice'))

      fireEvent.click(drawButton('Civ'))

      await waitFor(() => expect(draw).toHaveBeenCalledExactlyOnceWith('game-1', 'CIV'))
      expect(confirm).not.toHaveBeenCalled()
    })

    it('shows the normal error when the server still says NOT_YOUR_TURN', async () => {
      vi.spyOn(api, 'draw').mockRejectedValue(new ApiError(409, 'NOT_YOUR_TURN', 'Player is not on turn'))
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await renderGame(chatView('Bob'))

      fireEvent.click(drawButton('Civ'))

      expect(await screen.findByText('Player is not on turn')).toBeTruthy()
    })

    it('leaves Draw disabled for a spectator and does not promise a question', async () => {
      await renderGame({ ...chatView('Bob'), you: null } as unknown as PlayerView, 'user', false)
      expect(drawButton('Civ').disabled).toBe(true)
      expect(screen.queryByText(/You will be asked/)).toBeNull()
      expect(screen.getByText('Only players can draw.')).toBeTruthy()
    })

    it('tells a player out of turn that they will be asked', async () => {
      await renderGame(chatView('Bob'))
      expect(screen.getByText('It is not your turn. You will be asked before you draw.')).toBeTruthy()
    })
  })
})

describe('the ended-battle banner', () => {
  const endedView = (youId: string | null, battleUndo: unknown = { endedBy: 'me' }): PlayerView =>
    ({
      rev: 7,
      you: youId === null ? null : { playerId: youId, battlehand: [], barbarians: [], items: [] },
      opponents: [{ playerId: 'other', username: 'Karandras1' }],
      battle: null,
      battleUndo,
      battleSummary: [],
    }) as unknown as PlayerView

  const renderPanel = (view: PlayerView, busy = false) => {
    const result = render(<BattlePanel gameId="game-1" busy={busy} run={run} view={view} />)
    fireEvent.click(result.getByText('Battle'))
    return result
  }

  it('shows after End battle, with an Undo button for the player who ended it', () => {
    const undo = vi.spyOn(api, 'undoEndBattle').mockResolvedValue(endedView('me', null))
    const { container, getByText } = renderPanel(endedView('me'))

    const banner = container.querySelector('.battle-ended-banner')
    expect(banner?.textContent).toContain('Battle ended')
    fireEvent.click(getByText('Undo'))
    // The current revision goes with it, like every other arena action
    expect(undo).toHaveBeenCalledWith('game-1', 7)
  })

  it('shows to everyone else too, but without an Undo button', () => {
    const { container, queryByText } = renderPanel(endedView('other', { endedBy: 'me' }))
    expect(container.querySelector('.battle-ended-banner')?.textContent).toContain('Battle ended')
    expect(queryByText('Undo')).toBeNull()
  })

  it('names the player who ended it for the others, and offers a spectator no Undo', () => {
    const { container, queryByText } = renderPanel(endedView(null, { endedBy: 'other' }))
    expect(container.querySelector('.battle-ended-banner')?.textContent).toContain('by Karandras1')
    expect(queryByText('Undo')).toBeNull()
  })

  it('is absent when there is nothing to undo', () => {
    const { container } = renderPanel(endedView('me', null))
    expect(container.querySelector('.battle-ended-banner')).toBeNull()
  })

  it('is absent while a battle is running', () => {
    const running = {
      ...endedView('me'),
      battle: {
        attacker: { playerId: 'me', kind: 'player' },
        defender: { playerId: 'other', kind: 'player' },
        turn: 'attacker', arena: [], departedUnits: [],
      },
    } as unknown as PlayerView
    const { container } = renderPanel(running)
    expect(container.querySelector('.battle-ended-banner')).toBeNull()
  })

  it('does not offer Undo while another action is running', () => {
    const { getByText } = renderPanel(endedView('me'), true)
    expect((getByText('Undo') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the Build flow in the game page', () => {
  const library = {
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
  const city = {
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
  }
  const buildOptions = [
    {
      cityPieceId: 'city-1',
      label: 'Capital D5',
      status: 'ready',
      reason: 'Ready to build.',
      production: 4,
      productionSource: 'estimate',
      choices: [library],
      unavailable: [],
    },
  ]
  const viewWith = (overrides: Record<string, unknown> = {}): PlayerView =>
    orderView({
      you: { playerId: 'p1', username: 'viewer', items: [], pendingRewards: [], cities: [city], buildOptions },
      ...overrides,
    })

  beforeEach(() => localStorage.setItem('civ.panel.cities', 'true'))
  afterEach(() => localStorage.removeItem('civ.panel.cities'))

  it('puts the board in pick mode after a choice and takes it out on Cancel', async () => {
    await renderOrder(viewWith())
    expect(screen.getByTestId('board').getAttribute('data-pick-count')).toBe('off')
    fireEvent.click(screen.getByRole('button', { name: 'Build in Capital D5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose Library' }))
    expect(screen.getByTestId('board').getAttribute('data-pick-count')).toBe('2')
    expect(screen.getByRole('group', { name: 'Build' }).textContent).toContain('Build Library in Capital D5')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('board').getAttribute('data-pick-count')).toBe('off')
    expect(screen.queryByRole('group', { name: 'Build' })).toBeNull()
  })

  it('shows the confirm bar for a unit and leaves the board out of pick mode', async () => {
    const infantry = {
      assetId: 'units/infantry',
      item: { kind: 'unit', unitType: 'infantry' },
      placement: 'none',
      label: 'Infantry unit',
      cost: 4,
      tradeToPay: 0,
      squares: [],
    }
    const withUnit = [{ ...buildOptions[0], choices: [library, infantry] }]
    await renderOrder(
      viewWith({ you: { playerId: 'p1', username: 'viewer', items: [], pendingRewards: [], cities: [city], buildOptions: withUnit } }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build in Capital D5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose Infantry unit' }))
    expect(screen.getByRole('group', { name: 'Build' }).textContent).toContain('Build an infantry unit in Capital D5')
    expect((within(screen.getByRole('group', { name: 'Build' })).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
    // Nothing to pick: the board gets no squares
    expect(screen.getByTestId('board').getAttribute('data-pick-count')).toBe('0')
  })

  it('has no Build button once the game is locked, and none for a spectator', async () => {
    const locked = await renderOrder(viewWith({ active: false }))
    expect(screen.getByRole('heading', { name: 'Cities (1)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    locked.unmount()

    // A spectator's view has no `you`, so there are no cards of their own and no options.
    await renderOrder(orderView(), null)
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
  })
})

describe('the city actions in the game page', () => {
  const city = {
    pieceId: 'city-1',
    label: 'Capital B3',
    outskirts: 4,
    outskirtsDetail: [],
    modifiers: [],
    buildingProgram: false,
    estimate: 4,
    withBuildingProgram: null,
    override: null,
    effective: 4,
    notes: [],
  }
  const cityActions = [
    {
      cityPieceId: 'city-1',
      label: 'Capital B3',
      startBuildingProgram: { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker: false },
    },
  ]
  const upgradeOptions = [
    {
      basicAssetId: 'buildings/granary',
      upgradedAssetId: 'buildings/aqueduct',
      basicLabel: 'Granary',
      upgradedLabel: 'Aqueduct',
      label: 'Granary to Aqueduct',
      count: 1,
      squares: [{ column: 0, row: 0, label: 'A1' }],
    },
  ]
  const viewWith = (overrides: Record<string, unknown> = {}): PlayerView =>
    orderView({
      you: {
        playerId: 'p1',
        username: 'viewer',
        items: [],
        pendingRewards: [],
        cities: [city],
        cityActions,
        upgradeOptions,
      },
      ...overrides,
    })

  beforeEach(() => localStorage.setItem('civ.panel.cities', 'true'))
  afterEach(() => localStorage.removeItem('civ.panel.cities'))

  it('shows the Start button and the Upgrades block to a player in a live game', async () => {
    await renderOrder(viewWith())
    expect(screen.getByRole('button', { name: 'Start Building Program in Capital B3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upgrade Granary to Aqueduct (1)' })).toBeTruthy()
  })

  it('shows neither once the game is locked, and neither to a spectator', async () => {
    const locked = await renderOrder(viewWith({ active: false }))
    expect(screen.getByRole('heading', { name: 'Cities (1)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start Building Program/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
    locked.unmount()

    await renderOrder(orderView(), null)
    expect(screen.queryByRole('button', { name: /Start Building Program/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
  })
})
