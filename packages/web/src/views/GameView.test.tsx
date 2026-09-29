// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '@civ/engine'

import { api } from '../lib/api.js'
import type { GameRevisionSummary, PlayerDto, PlayerView } from '../lib/api.js'
import {
  AUTO_REFRESH_MS,
  GameView,
  activePlayerOf,
  chatAuthorsOf,
  HandItem,
  gameMenuGate,
  loadAfterKnownRevision,
  reloadIfRevisionChanged,
} from './GameView.js'

vi.mock('./BoardView.js', () => ({ BoardView: () => <div data-testid="board" /> }))
vi.mock('./ChatPanel.js', () => ({ ChatPanel: () => <section><h2>Chat</h2></section> }))
vi.mock('./LogPanel.js', () => ({ LogPanel: () => <section><h2>Log</h2></section> }))
vi.mock('./OpponentHandPanel.js', () => ({ OpponentHandPanel: () => <section><h2>Other players' hands</h2></section> }))
vi.mock('./RevealedPanel.js', () => ({ RevealedPanel: () => <section><h2>Revealed</h2></section> }))
vi.mock('./SocialPolicyPanel.js', () => ({ SocialPolicyPanel: () => <section><h2>Social policy</h2></section> }))
vi.mock('./StatusPanel.js', () => ({ StatusPanel: () => <section><h2>Player status</h2></section> }))
vi.mock('./TechPanel.js', () => ({ TechPanel: () => <section><h2>Techs</h2></section> }))
vi.mock('./TurnPanel.js', () => ({ TurnPanel: () => <section><h2>Turn orders</h2></section> }))
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
    })
    expect(gameMenuGate({ you: you(), active: false }, false, false)?.withdrawDisabled).toBe(true)
  })

  it('offers both, to the game creator', () => {
    expect(gameMenuGate({ you: you({ gameCreator: true }), active: true }, false, false)).toEqual({
      canWithdraw: true,
      withdrawDisabled: false,
      canDelete: true,
      deleteDisabled: false,
    })
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
    })
  })

  it('disables both while an action is already in flight', () => {
    expect(gameMenuGate({ you: you(), active: true }, false, true)).toEqual({
      canWithdraw: true,
      withdrawDisabled: true,
      canDelete: false,
      deleteDisabled: true,
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

describe('primary game panel order', () => {
  it('shows Draw immediately after the board and before the responsive Log and Chat pair', async () => {
    localStorage.setItem('civ.autoRefresh', 'false')
    const view = {
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
    } as unknown as PlayerView
    vi.spyOn(api, 'game').mockResolvedValue(view)
    vi.spyOn(api, 'revisions').mockResolvedValue([])

    const { container } = render(
      <GameView
        gameId="game-1"
        player={{ username: 'viewer' } as unknown as PlayerDto}
        onUnauthorized={vi.fn()}
        onDeleted={vi.fn()}
        onWithdrawn={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Draw' })).toBeTruthy())

    const board = screen.getByTestId('board')
    const panelStack = container.querySelector('.panel-stack')
    const draw = screen.getByRole('heading', { name: 'Draw' }).closest('section')
    const log = screen.getByRole('heading', { name: 'Log' }).closest('section')
    const chat = screen.getByRole('heading', { name: 'Chat' }).closest('section')
    const hand = screen.getByRole('heading', { name: 'Your hand (0)' }).closest('section')
    const logChatPair = log?.parentElement

    expect(board.nextElementSibling).toBe(panelStack)
    const turnOrders = screen.getByRole('heading', { name: 'Turn orders' }).closest('section')

    expect(board.nextElementSibling).toBe(panelStack)
    expect(panelStack?.children[0]).toBe(draw)
    // Turn orders comes right after Draw (issue #206)
    expect(panelStack?.children[1]).toBe(turnOrders)
    expect(panelStack?.children[2]).toBe(logChatPair)
    expect(logChatPair?.classList.contains('panel-pair')).toBe(true)
    expect(Array.from(logChatPair?.children ?? [])).toEqual([log, chat])
    expect(panelStack?.children[3]).toBe(hand)
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
  yourTurn: false,
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
    activeTurn: activeUsername === null ? null : { username: activeUsername, phase: 'SOT' },
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
        [seat('s3s3', { civilization: greeks, color: 'Green', yourTurn: true })],
        's3s3',
      ),
    )

    expect(chipTexts(container)).toEqual(['Greeks', 'Green'])
    const chips = container.querySelector('.header-chips')
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.textContent).toBe("s3s3's turn — start of turn phase")
    // Chips first, title straight after them in the same row
    expect(chips?.nextElementSibling).toBe(title)
    expect(container.textContent).not.toContain('Romans')
  })

  it('shows the viewer\'s own chips on their turn', async () => {
    const container = await renderHeader(
      headerView(
        seat('viewer', { civilization: { name: 'Romans' }, color: 'Red', yourTurn: true }),
        [seat('s3s3', { civilization: greeks, color: 'Green' })],
        'viewer',
      ),
    )
    expect(chipTexts(container)).toEqual(['Romans', 'Red'])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Your turn')
  })

  it('has no civ chip while the civilization is not revealed', async () => {
    const container = await renderHeader(
      headerView(seat('viewer'), [seat('s3s3', { color: 'Blue', yourTurn: true })], 's3s3'),
    )
    expect(chipTexts(container)).toEqual(['Blue'])
    expect(container.querySelector('.tag.revealed')).toBeNull()
  })

  it('has no chips at all before anyone has a turn, colour or civ', async () => {
    const container = await renderHeader(headerView(null, [seat('s3s3')], null))
    expect(container.querySelector('.header-chips')).toBeNull()
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

  it('falls back to the seat flagged yourTurn when the active turn names nobody', () => {
    const view = headerView(seat('viewer'), [seat('s3s3', { yourTurn: true })], 'someone-who-left')
    expect(activePlayerOf(view)?.username).toBe('s3s3')
  })
})

describe('HandPanel groups items by kind (issue #190 follow-up)', () => {
  it('renders group headings in old-civ-web bucket order, not draw order', async () => {
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
      />,
    )

    await waitFor(() => expect(screen.getByText('Culture A')).toBeTruthy())

    const hand = screen.getByRole('heading', { name: 'Your hand (5)' }).closest('section')
    const sequence = Array.from(
      hand?.querySelectorAll('.item-group-heading h4, li.card strong') ?? [],
    ).map((node) => node.textContent)
    expect(sequence).toEqual([
      'Items', 'Wonder A',
      'Units', 'Infantry 1.3',
      'Culture Cards', 'Culture A',
      'Huts', 'Hut: Hut A',
      'Villages', 'Village: Village A',
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
