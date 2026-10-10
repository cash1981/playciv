// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  BOARD_ASSETS,
  SQUARE_SIZE,
  TILE_SQUARES,
  areaBandTop,
  boardWidth,
  createBoard,
  createBoardForPlayers,
  findBoardAsset,
  mapTop,
  slotOrigin,
  tileTerrainGrid,
  wondersArea,
} from '@civ/engine'
import type { Terrain } from '@civ/engine'
import type { BoardAsset, BoardPiece, PlayerView } from '@civ/engine'

import type { GameRevisionView } from '../lib/api.js'
import { api } from '../lib/api.js'

import { BoardPalette, BoardView, fittingBoardZoom, groupBuildings } from './BoardView.js'
import {
  GlobalReplayBar,
  loadConsistentLive,
  loadHistoricalIfCurrent,
  refreshBeforeLive,
} from './GameView.js'

const piece = (assetId: string, id: string): BoardPiece => ({
  id,
  assetId,
  path: 'buildings/academy.png',
  label: 'Academy',
  category: 'building',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  rotation: 0,
  placedBy: null,
})

describe('BoardView zoom', () => {
  it('chooses the largest fitting step and caps automatic zoom at 100%', () => {
    expect(fittingBoardZoom(1000, 1200)).toBe(1)
    expect(fittingBoardZoom(1000, 900)).toBe(0.8)
    expect(fittingBoardZoom(1000, 250)).toBe(0.3)
  })

  it('responds to width changes and leaves manual zoom alone', () => {
    const board = createBoard()
    const { container } = render(
      <BoardView gameId="game" board={board} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} />,
    )
    const scroll = container.querySelector('.board-scroll')
    const frame = container.querySelector('.board-frame')
    const surface = container.querySelector('.board-surface')
    if (!(scroll instanceof HTMLElement) || !(frame instanceof HTMLElement) || !(surface instanceof HTMLElement)) throw new Error('board missing')
    let availableWidth = boardWidth(board) + 100
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => availableWidth })
    fireEvent(window, new Event('resize'))
    expect(surface.style.width).toBe(`${boardWidth(board)}px`)
    expect(parseFloat(frame.style.width)).toBe(parseFloat(surface.style.width) + 28)

    availableWidth = boardWidth(board) * 0.55
    fireEvent(window, new Event('resize'))
    expect(surface.style.width).toBe(`${boardWidth(board) * 0.5}px`)
    expect(parseFloat(frame.style.width)).toBe(parseFloat(surface.style.width) + 28)

    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '1' } })
    expect(surface.style.width).toBe(`${boardWidth(board)}px`)
    availableWidth = boardWidth(board) * 0.38
    fireEvent(window, new Event('resize'))
    expect(surface.style.width).toBe(`${boardWidth(board)}px`)
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: 'auto' } })
    expect(surface.style.width).toBe(`${boardWidth(board) * 0.3}px`)
    cleanup()
  })

  it('uses ResizeObserver when its container changes without a window resize', () => {
    let notifyResize: ResizeObserverCallback | undefined
    const disconnect = vi.fn()
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) { notifyResize = callback }
      observe(): void {}
      disconnect(): void { disconnect() }
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    try {
      const board = createBoard()
      const { container, unmount } = render(
        <BoardView gameId="game" board={board} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} />,
      )
      const scroll = container.querySelector('.board-scroll')
      const surface = container.querySelector('.board-surface')
      if (!(scroll instanceof HTMLElement) || !(surface instanceof HTMLElement)) throw new Error('board missing')
      Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: boardWidth(board) + 100 })
      if (notifyResize === undefined) throw new Error('resize observer missing')
      act(() => notifyResize?.([], {} as ResizeObserver))
      expect(surface.style.width).toBe(`${boardWidth(board)}px`)
      unmount()
      expect(disconnect).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('global replay controls', () => {
  const revisions = [
    {
      gameId: 'game',
      revision: 0,
      createdAt: '2026-09-19T10:00:00.000Z',
      actor: { playerId: 'one', username: 'Alice' },
      publicDescription: 'Game created',
      logIds: [],
    },
    {
      gameId: 'game',
      revision: 1,
      createdAt: '2026-09-19T10:01:00.000Z',
      actor: { playerId: 'two', username: 'Bob' },
      publicDescription: 'Bob joined',
      logIds: ['log-1'],
    },
  ] as const

  it('shows one global Back, Forward and Live timeline', () => {
    const markup = renderToStaticMarkup(
      <GlobalReplayBar
        revisions={revisions}
        selectedRevision={0}
        busy={false}
        onRevision={() => undefined}
        onLive={() => undefined}
      />,
    )
    expect(markup).toContain('Forward')
    expect(markup).toContain('Live')
    expect(markup).toContain('Revision 0')
    expect(markup).toContain('Newer revisions available')
    expect(markup).toContain('Game created')
  })

  it('refreshes the live cache before leaving a historical revision', async () => {
    const events: string[] = []
    await refreshBeforeLive(
      async () => {
        events.push('reload')
        return true
      },
      () => events.push('live'),
    )
    expect(events).toEqual(['reload', 'live'])

    await refreshBeforeLive(async () => false, () => events.push('must not leave replay'))
    expect(events).toEqual(['reload', 'live'])
  })

  it('reads revisions before the live game and retries a torn snapshot', async () => {
    const events: string[] = []
    let viewRevision = 3
    const loaded = await loadConsistentLive(
      async () => {
        events.push('revisions')
        return [{ ...revisions[1], revision: 4 }]
      },
      async () => {
        events.push(`game-${viewRevision}`)
        const view = { rev: viewRevision } as PlayerView
        viewRevision = 4
        return view
      },
    )

    expect(events).toEqual(['revisions', 'game-3', 'revisions', 'game-4'])
    expect(loaded.view.rev).toBe(4)
    expect(loaded.revisions.at(-1)?.revision).toBe(4)
  })

  it('discards a historical response after navigation changes the active game', async () => {
    let active = true
    const pending = loadHistoricalIfCurrent(
      async () => {
        active = false
        return { revision: 1 } as GameRevisionView
      },
      () => active,
    )
    await expect(pending).resolves.toBeNull()
  })
})

describe('shaped boards', () => {
  it('fogs each playable slot of the five-player map, and nothing in the hole', () => {
    const board = createBoardForPlayers(5)
    const { container } = render(
      <BoardView
        gameId="game"
        board={board}
        numOfPlayers={5}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )

    // Twenty-two playable slots where the old rectangle had sixteen blocks;
    // the hole (squares 12..16 by 8..14) is not among them.
    expect(container.querySelectorAll('.board-fog-tile')).toHaveLength(22)
    expect(container.querySelectorAll('.board-map-slot')).toHaveLength(22)
    expect(container.querySelector('.board-map')).toBeNull()
    cleanup()
  })

  it('fogs each playable slot of the three-player pyramid', () => {
    const board = createBoardForPlayers(3)
    const { container } = render(
      <BoardView
        gameId="game"
        board={board}
        numOfPlayers={3}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )

    expect(container.querySelectorAll('.board-fog-tile')).toHaveLength(10)
    cleanup()
  })

  it('lifts the fog from a slot that holds a tile', () => {
    const board = createBoardForPlayers(3)
    const first = board.slots[0]
    if (first === undefined) throw new Error('pyramid has no slots')
    const [x, y] = slotOrigin(board, first)
    const tile: BoardPiece = {
      ...piece('tiles/tile01', 'tile-one'),
      category: 'tile',
      x,
      y,
      width: 376,
      height: 376,
    }

    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...board, pieces: [tile] }}
        numOfPlayers={3}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )

    expect(container.querySelectorAll('.board-fog-tile')).toHaveLength(9)
    cleanup()
  })

  it('keeps the single outlined mat on a rectangular board', () => {
    const { container } = render(
      <BoardView
        gameId="game"
        board={createBoard()}
        numOfPlayers={4}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )

    expect(container.querySelectorAll('.board-map')).toHaveLength(1)
    expect(container.querySelectorAll('.board-map-slot')).toHaveLength(0)
    expect(container.querySelectorAll('.board-fog-tile')).toHaveLength(16)
    cleanup()
  })
})

describe('BoardPalette finite supplies', () => {
  it('calls the tap selection callback for an available asset', () => {
    const hut = findBoardAsset('resources/hut')
    if (hut === undefined) throw new Error('hut missing from manifest')
    let selected: string | null = null

    render(
      <BoardPalette
        assets={[hut]}
        category="resource"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={[]}
        numOfPlayers={2}
        onSelectAsset={(asset) => { selected = asset.id }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /hut/i }))
    expect(selected).toBe('resources/hut')
    cleanup()
  })

  it('lists wonders by level, then alphabetically', () => {
    const wonders = ['wonders/internet', 'wonders/pyramids', 'wonders/hanginggardens']
      .map((id) => findBoardAsset(id))
      .filter((asset): asset is NonNullable<typeof asset> => asset !== undefined)
    expect(wonders).toHaveLength(3)

    render(
      <BoardPalette
        assets={[...wonders]}
        category="wonder"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={[]}
        numOfPlayers={2}
      />,
    )
    const labels = screen.getAllByRole('button', { name: /Hanging|Pyramids|Internet/ })
      .map((button) => button.getAttribute('title'))
    expect(labels).toEqual(['The Hanging Gardens', 'The Pyramids', 'The Internet'])
    cleanup()
  })

  it('shows the remaining count and disables an exhausted building family', () => {
    const academy = findBoardAsset('buildings/academy')
    if (academy === undefined) throw new Error('academy missing from manifest')

    const exhausted = renderToStaticMarkup(
      <BoardPalette
        assets={[academy]}
        category="building"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={Array.from({ length: 5 }, (_, index) => piece('buildings/barracks', String(index)))}
        numOfPlayers={4}
      />,
    )
    expect(exhausted).toContain('Academy (0)')
    expect(exhausted).toContain('type="button"')
    expect(exhausted).toContain('draggable="false"')

    const restored = renderToStaticMarkup(
      <BoardPalette
        assets={[academy]}
        category="building"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={Array.from({ length: 4 }, (_, index) => piece('buildings/barracks', String(index)))}
        numOfPlayers={4}
      />,
    )
    expect(restored).toContain('Academy (1)')
    expect(restored).toContain('draggable="true"')
  })

  it('groups the buildings by upgrade family, in the order of the supply sheet', () => {
    const buildings = BOARD_ASSETS.filter((asset) => asset.category === 'building')
    const groups = groupBuildings(buildings).map((group) => group.map((asset) => asset.id))

    expect(groups).toEqual([
      ['buildings/library', 'buildings/university'],
      ['buildings/market', 'buildings/bank'],
      ['buildings/temple', 'buildings/cathedral'],
      ['buildings/barracks', 'buildings/academy'],
      ['buildings/workshop', 'buildings/ironmine'],
      ['buildings/shipyard', 'buildings/militarydock'],
      ['buildings/granary', 'buildings/aqueduct'],
      ['buildings/tradingpost'],
      ['buildings/harbor'],
    ])
    // Every building in the manifest is shown exactly once.
    expect(groups.flat().sort()).toEqual(buildings.map((asset) => asset.id).sort())
  })

  it('shows a building that is not in the grouping table after the groups', () => {
    const stranger: BoardAsset = {
      id: 'buildings/newthing',
      category: 'building',
      path: 'buildings/newthing.png',
      label: 'New thing',
      width: 80,
      height: 80,
    }
    const buildings = [stranger, ...BOARD_ASSETS.filter((asset) => asset.category === 'building')]
    const groups = groupBuildings(buildings)

    expect(groups.at(-1)?.map((asset) => asset.id)).toEqual(['buildings/newthing'])
    expect(groups).toHaveLength(10)
  })

  it('renders each building family inside one group box', () => {
    const buildings = BOARD_ASSETS.filter((asset) => asset.category === 'building')
    const markup = renderToStaticMarkup(
      <BoardPalette
        assets={buildings}
        category="building"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={[]}
        numOfPlayers={4}
      />,
    )

    expect(markup.match(/class="palette-group palette-group-pair"/g)).toHaveLength(7)
    expect(markup.match(/class="palette-group"/g)).toHaveLength(2)
    expect(markup.indexOf('Library')).toBeLessThan(markup.indexOf('University'))
    expect(markup.indexOf('University')).toBeLessThan(markup.indexOf('Market'))
    expect(markup.indexOf('Shipyard')).toBeLessThan(markup.indexOf('Military dock'))
  })

  it('does not group the other categories', () => {
    const markup = renderToStaticMarkup(
      <BoardPalette
        assets={BOARD_ASSETS}
        category="relic"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={[]}
        numOfPlayers={4}
      />,
    )
    expect(markup).toContain('palette-item')
    expect(markup).not.toContain('palette-group')
  })

  it('lists disasters in their own draggable Pieces category', () => {
    const disasters = BOARD_ASSETS.filter((asset) => asset.category === 'disaster')
    expect(disasters).toHaveLength(4)
    const markup = renderToStaticMarkup(
      <BoardPalette
        assets={BOARD_ASSETS}
        category="disaster"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={[]}
        numOfPlayers={4}
      />,
    )
    expect(markup).toContain('Disasters')
    expect(markup).toContain('Drought')
    expect(markup).toContain('Forest')
    expect(markup).toContain('Grassland')
    expect(markup).toContain('Water')
    expect(markup).toContain('draggable="true"')
  })

  it('lists the relics in their own group and disables one once it is on the board (issue #227)', () => {
    const relics = BOARD_ASSETS.filter((asset) => asset.category === 'relic')
    expect(relics).toHaveLength(5)
    const atlantis = findBoardAsset('relics/atlantis')
    if (atlantis === undefined) throw new Error('atlantis missing from manifest')
    const onBoard: BoardPiece = {
      ...piece('relics/atlantis', 'atlantis-1'),
      path: atlantis.path,
      label: atlantis.label,
      category: 'relic',
    }

    const markup = renderToStaticMarkup(
      <BoardPalette
        assets={BOARD_ASSETS}
        category="relic"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={[onBoard]}
        numOfPlayers={4}
      />,
    )
    // The group has its own tab, and every relic is shown with its supply.
    expect(markup).toContain('Relics')
    expect(markup).toContain('Atlantis (0)')
    expect(markup).toContain('Ark of the Covenant (1)')
    expect(markup).toContain("Attila&#x27;s Village (1)")
    expect(markup).toContain('School of Confucius (1)')
    expect(markup).toContain('Seven Cities of Gold (1)')
    // Buildings are not in this group.
    expect(markup).not.toContain('Academy')

    const empty = renderToStaticMarkup(
      <BoardPalette
        assets={BOARD_ASSETS}
        category="relic"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={[]}
        numOfPlayers={4}
      />,
    )
    expect(empty).toContain('Atlantis (1)')
  })

  it('shows no count and keeps a hut draggable at the cap (issue #116)', () => {
    const hut = findBoardAsset('resources/hut')
    if (hut === undefined) throw new Error('hut missing from manifest')

    // Two huts in a two-player game is exactly where a capped resource would be
    // exhausted; a hut must stay unlimited, so it must not show "(0)".
    const huts: readonly BoardPiece[] = [0, 1].map((index) => ({
      ...piece('resources/hut', String(index)),
      category: 'resource',
    }))

    const markup = renderToStaticMarkup(
      <BoardPalette
        assets={[hut]}
        category="resource"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={huts}
        numOfPlayers={2}
      />,
    )
    expect(markup).toContain('Hut')
    expect(markup).not.toContain('Hut (')
    expect(markup).toContain('draggable="true"')
    expect(markup).not.toContain('unavailable')
  })
})

describe('BoardPalette figures (issue #204)', () => {
  const figures = (): BoardAsset[] =>
    BOARD_ASSETS.filter((asset) => asset.category === 'figure')
  const figurePiece = (assetId: string, id: string): BoardPiece => ({
    ...piece(assetId, id),
    category: 'figure',
  })
  const markup = (pieces: readonly BoardPiece[], viewerIsRussia?: boolean): string =>
    renderToStaticMarkup(
      <BoardPalette
        assets={figures()}
        category="figure"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={pieces}
        numOfPlayers={4}
        {...(viewerIsRussia === undefined ? {} : { viewerIsRussia })}
      />,
    )

  it('shows the remaining armies and scouts per colour', () => {
    const pieces = [
      ...Array.from({ length: 4 }, (_, index) => figurePiece('figures/redarmy', `a${index}`)),
      figurePiece('figures/bluescout', 's'),
    ]
    const html = markup(pieces)
    expect(html).toContain('Red army (2)')
    expect(html).toContain('Blue scout (1)')
    expect(html).toContain('Blue army (6)')
    expect(html).toContain('Green scout (2)')
  })

  it('disables a colour at zero and leaves the others available', () => {
    const pieces = Array.from({ length: 2 }, (_, index) => figurePiece('figures/redscout', `s${index}`))
    const html = markup(pieces)
    expect(html).toContain('Red scout (0)')
    expect(html.match(/palette-item unavailable/g)).toHaveLength(1)
  })

  it('lists the white army only for a Russian viewer', () => {
    expect(markup([])).not.toContain('White army')
    expect(markup([], false)).not.toContain('White army')
    expect(markup([], true)).toContain('White army (1)')
  })

  it('disables the white army once it has been placed', () => {
    const html = markup([figurePiece('figures/whitearmy', 'w')], true)
    expect(html).toContain('White army (0)')
    expect(html).toContain('palette-item unavailable')
  })
})

describe('BoardView mobile placement', () => {
  it('shows a pending placement status after tapping a palette asset', async () => {
    const hut = findBoardAsset('resources/hut')
    if (hut === undefined) throw new Error('hut missing from manifest')
    const assets = vi.spyOn(api, 'boardAssets').mockResolvedValue([hut])

    render(
      <BoardView
        gameId="game"
        board={createBoard()}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resources' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /hut/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /hut/i }))
    expect(screen.getByRole('status').textContent).toContain('Placing Hut')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    assets.mockRestore()
    cleanup()
  })

  it('places an armed asset when tapping an existing starting tile', async () => {
    const hut = findBoardAsset('resources/hut')
    if (hut === undefined) throw new Error('hut missing from manifest')
    const assets = vi.spyOn(api, 'boardAssets').mockResolvedValue([hut])
    const placePiece = vi.spyOn(api, 'placePiece').mockResolvedValue({} as PlayerView)
    const startingTile: BoardPiece = {
      ...piece('tiles/starting', 'starting-tile'),
      path: 'tiles/starting.png',
      label: 'Starting tile',
      category: 'civtile',
      x: 100,
      y: 100,
      width: 4,
      height: 4,
    }

    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [startingTile] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resources' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /hut/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /hut/i }))

    const tile = container.querySelector('.board-piece')
    if (!(tile instanceof HTMLElement)) throw new Error('starting tile missing from board')
    const dispatchPointer = (type: 'pointerdown' | 'pointerup') => {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: 120,
        clientY: 120,
      })) Object.defineProperty(event, name, { value })
      tile.dispatchEvent(event)
    }
    dispatchPointer('pointerdown')
    dispatchPointer('pointerup')

    await waitFor(() => expect(placePiece).toHaveBeenCalledWith('game', hut.id, expect.any(Number), expect.any(Number)))
    placePiece.mockRestore()
    assets.mockRestore()
    cleanup()
  })

  it('a touch selects and arms a figure, and the next board tap moves it', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const boardPiece = piece('buildings/academy', 'academy-1')
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )

    const tile = container.querySelector('.board-piece')
    const surface = container.querySelector('.board-surface')
    if (!(tile instanceof HTMLElement) || !(surface instanceof HTMLElement)) throw new Error('board elements missing')
    const dispatchPointer = (target: HTMLElement, type: 'pointerdown' | 'pointerup', clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX,
        clientY,
      })) Object.defineProperty(event, name, { value })
      target.dispatchEvent(event)
    }

    // One touch selects the piece and arms destination mode in the same tap.
    dispatchPointer(tile, 'pointerdown', 20, 20)
    dispatchPointer(tile, 'pointerup', 20, 20)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Academy'))

    dispatchPointer(surface, 'pointerdown', 120, 120)
    dispatchPointer(surface, 'pointerup', 120, 120)
    await waitFor(() => expect(movePiece).toHaveBeenCalledWith('game', boardPiece.id, expect.any(Number), expect.any(Number)))
    movePiece.mockRestore()
    cleanup()
  })

  it('selects another piece instead of moving the first one when it is tapped', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const first = { ...piece('resources/hut', 'hut-one'), category: 'resource' as const, label: 'Hut', path: 'resources/hut.png' }
    const second = { ...piece('resources/incense', 'incense-one'), category: 'resource' as const, label: 'Incense', path: 'resources/incense.png', x: 100 }
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [first, second] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const pointerTap = (target: HTMLElement, pointerId: number) => {
      for (const type of ['pointerdown', 'pointerup'] as const) {
        const event = new Event(type, { bubbles: true })
        for (const [name, value] of Object.entries({ pointerId, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 })) {
          Object.defineProperty(event, name, { value })
        }
        target.dispatchEvent(event)
      }
    }
    const pieces = () => Array.from(container.querySelectorAll<HTMLElement>('.board-piece'))

    pointerTap(pieces()[0] as HTMLElement, 5)
    await screen.findByText('Hut')
    pointerTap(pieces()[1] as HTMLElement, 6)
    await screen.findByText('Incense')
    expect(screen.queryByText('Hut')).toBeNull()
    expect(movePiece).not.toHaveBeenCalled()
    movePiece.mockRestore()
    cleanup()
  })

  describe('map tiles', () => {
    const setup = () => {
      const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
      const board = createBoard()
      const [sx, sy] = slotOrigin(board, board.slots[0] as { x: number; y: number })
      const tileA = { ...piece('tiles/tile01', 'tile-a'), category: 'tile' as const, label: 'Tile A', path: 'tiles/tile01.png', x: sx, y: sy, width: 376, height: 376 }
      const tileB = { ...piece('tiles/tile02', 'tile-b'), category: 'tile' as const, label: 'Tile B', path: 'tiles/tile02.png', x: slotOrigin(board, board.slots[2] as { x: number; y: number })[0], y: slotOrigin(board, board.slots[2] as { x: number; y: number })[1], width: 376, height: 376 }
      const figure = { ...piece('figures/bluearmy', 'army'), category: 'figure' as const, label: 'Army', path: 'figures/bluearmy.png', x: sx + 500, y: sy + 500, width: 33, height: 51 }
      const figure2 = { ...figure, id: 'army2', label: 'Army Two', x: figure.x + 100 }
      const all = [tileA, tileB, figure, figure2]
      const utils = render(
        <BoardView
          gameId="game"
          board={{ ...board, pieces: all }}
          numOfPlayers={2}
          areas={[]}
          busy={false}
          run={async action => { await action() }}
        />,
      )
      const el = (id: string) => {
        const index = all.findIndex(candidate => candidate.id === id)
        return utils.container.querySelectorAll<HTMLElement>('.board-piece')[index] as HTMLElement
      }
      const surface = utils.container.querySelector('.board-surface') as HTMLElement
      let pointerId = 30
      const tap = (target: HTMLElement, clientX = 20, clientY = 20) => {
        pointerId += 1
        for (const type of ['pointerdown', 'pointerup'] as const) {
          const event = new Event(type, { bubbles: true })
          for (const [name, value] of Object.entries({ pointerId, pointerType: 'touch', isPrimary: true, button: 0, clientX, clientY })) {
            Object.defineProperty(event, name, { value })
          }
          target.dispatchEvent(event)
        }
      }
      const zoom = parseFloat(el('tile-b').style.left) / tileB.x
      return { movePiece, board, tileA, tileB, figure, el, surface, tap, zoom, container: utils.container }
    }

    it('a selected tile is cleared by a tap on another tile, without moving', async () => {
      const { movePiece, el, tap, container } = setup()
      tap(el('tile-a'))
      await waitFor(() => expect(container.querySelector('.board-piece.selected')).not.toBeNull())
      expect(screen.queryByRole('status')).toBeNull()
      tap(el('tile-b'))
      await waitFor(() => expect(container.querySelector('.board-piece.selected')).toBeNull())
      expect(movePiece).not.toHaveBeenCalled()
      movePiece.mockRestore()
      cleanup()
    })

    it('a selected tile is replaced by a tap on a figure', async () => {
      const { movePiece, el, tap, container } = setup()
      tap(el('tile-a'))
      tap(el('army'))
      await waitFor(() => expect(container.querySelector('.board-piece.selected')?.getAttribute('data-piece-id')).toBe('army'))
      expect(movePiece).not.toHaveBeenCalled()
      movePiece.mockRestore()
      cleanup()
    })

    it('a selected tile moves into an empty map slot', async () => {
      const { movePiece, board, el, surface, tap, zoom, container } = setup()
      const empty = board.slots[1] as { x: number; y: number }
      const [ex, ey] = slotOrigin(board, empty)
      tap(el('tile-a'))
      await waitFor(() => expect(container.querySelector('.board-piece.selected')).not.toBeNull())
      tap(surface, (ex + 20) * zoom, (ey + 20) * zoom)
      await waitFor(() => expect(movePiece).toHaveBeenCalledWith('game', 'tile-a', ex, ey))
      movePiece.mockRestore()
      cleanup()
    })

    it('the Move button makes a tap on another figure the destination', async () => {
      const { movePiece, el, tap, container } = setup()
      tap(el('army'))
      fireEvent.click(await screen.findByRole('button', { name: 'Move' }))
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Army'))
      tap(el('army2'))
      await waitFor(() => expect(movePiece).toHaveBeenCalledWith('game', 'army', expect.any(Number), expect.any(Number)))
      expect(container.querySelector('.board-piece.selected')?.getAttribute('data-piece-id')).toBe('army')
      movePiece.mockRestore()
      cleanup()
    })

    const mouse = (target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({ pointerId: 90, pointerType: 'mouse', isPrimary: true, button: 0, clientX, clientY })) {
        Object.defineProperty(event, name, { value })
      }
      target.dispatchEvent(event)
    }

    it('a mouse drag of a tile works while a figure is selected', async () => {
      const { movePiece, el, container } = setup()
      mouse(el('army'), 'pointerdown', 20, 20)
      mouse(el('army'), 'pointerup', 20, 20)
      await waitFor(() => expect(container.querySelector('.board-piece.selected')?.getAttribute('data-piece-id')).toBe('army'))
      mouse(el('tile-a'), 'pointerdown', 20, 20)
      mouse(el('tile-a'), 'pointermove', 80, 80)
      mouse(el('tile-a'), 'pointerup', 80, 80)
      await waitFor(() => expect(movePiece).toHaveBeenCalledWith('game', 'tile-a', expect.any(Number), expect.any(Number)))
      movePiece.mockRestore()
      cleanup()
    })

    it('a mouse click on a tile moves the armed figure there', async () => {
      const { movePiece, el, container } = setup()
      mouse(el('army'), 'pointerdown', 20, 20)
      mouse(el('army'), 'pointerup', 20, 20)
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Army'))
      mouse(el('tile-b'), 'pointerdown', 30, 30)
      mouse(el('tile-b'), 'pointerup', 30, 30)
      await waitFor(() => expect(movePiece).toHaveBeenCalledWith('game', 'army', expect.any(Number), expect.any(Number)))
      expect(movePiece).toHaveBeenCalledTimes(1)
      expect(container.querySelector('.board-piece.selected')?.getAttribute('data-piece-id')).toBe('army')
      movePiece.mockRestore()
      cleanup()
    })

    it('an armed figure is sent to the tapped map tile', async () => {
      const { movePiece, el, tap } = setup()
      tap(el('army'))
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Army'))
      tap(el('tile-b'))
      await waitFor(() => expect(movePiece).toHaveBeenCalledWith('game', 'army', expect.any(Number), expect.any(Number)))
      movePiece.mockRestore()
      cleanup()
    })
  })

  it('clears a touch selection when tapping outside the board without moving', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const boardPiece = piece('buildings/academy', 'academy-outside')
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const tile = container.querySelector('.board-piece')
    if (!(tile instanceof HTMLElement)) throw new Error('board piece missing')
    const dispatchPointer = (target: HTMLElement, type: 'pointerdown' | 'pointerup') => {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      })) Object.defineProperty(event, name, { value })
      target.dispatchEvent(event)
    }

    dispatchPointer(tile, 'pointerdown')
    dispatchPointer(tile, 'pointerup')
    await waitFor(() => expect(container.querySelector('.board-piece')?.classList.contains('selected')).toBe(true))

    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await waitFor(() => expect(container.querySelector('.board-piece')?.classList.contains('selected')).toBe(false))
    outside.remove()
    expect(movePiece).not.toHaveBeenCalled()
    movePiece.mockRestore()
    cleanup()
  })

  it('drags a marked touch piece without scrolling the board', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const boardPiece = piece('buildings/academy', 'academy-drag')
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const pointer = (target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) => {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({ pointerId: 2, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y })) {
        Object.defineProperty(event, name, { value })
      }
      target.dispatchEvent(event)
    }
    const firstTile = container.querySelector('.board-piece')
    if (!(firstTile instanceof HTMLElement)) throw new Error('board piece missing')
    pointer(firstTile, 'pointerdown', 20, 20)
    pointer(firstTile, 'pointerup', 20, 20)
    await waitFor(() => expect(container.querySelector('.board-piece')?.classList.contains('selected')).toBe(true))

    const markedTile = container.querySelector('.board-piece')
    if (!(markedTile instanceof HTMLElement)) throw new Error('marked board piece missing')
    pointer(markedTile, 'pointerdown', 20, 20)
    pointer(markedTile, 'pointermove', 100, 100)
    pointer(markedTile, 'pointerup', 100, 100)
    await waitFor(() => expect(movePiece).toHaveBeenCalledWith('game', boardPiece.id, expect.any(Number), expect.any(Number)))
    movePiece.mockRestore()
    cleanup()
  })

  it('does not keep destination mode armed after a touch drag moved the piece', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const boardPiece = piece('buildings/academy', 'academy-disarm')
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const pointer = (target: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) => {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({ pointerId: 8, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y })) {
        Object.defineProperty(event, name, { value })
      }
      target.dispatchEvent(event)
    }
    const tile = container.querySelector('.board-piece')
    const surface = container.querySelector('.board-surface')
    if (!(tile instanceof HTMLElement) || !(surface instanceof HTMLElement)) throw new Error('board elements missing')

    pointer(tile, 'pointerdown', 20, 20)
    pointer(tile, 'pointerup', 20, 20)
    await waitFor(() => expect(container.querySelector('.board-piece')?.classList.contains('selected')).toBe(true))

    const markedTile = container.querySelector('.board-piece')
    if (!(markedTile instanceof HTMLElement)) throw new Error('marked board piece missing')
    pointer(markedTile, 'pointerdown', 20, 20)
    pointer(markedTile, 'pointermove', 100, 100)
    pointer(markedTile, 'pointerup', 100, 100)
    await waitFor(() => expect(movePiece).toHaveBeenCalledTimes(1))

    // The drag already moved the piece; a later tap must not move it again.
    pointer(surface, 'pointerdown', 200, 200)
    pointer(surface, 'pointerup', 200, 200)
    await waitFor(() => expect(container.querySelector('.board-piece')?.classList.contains('selected')).toBe(false))
    expect(movePiece).toHaveBeenCalledTimes(1)
    movePiece.mockRestore()
    cleanup()
  })

  it('can select and remove another player-area resource after removing one', async () => {
    const removePiece = vi.spyOn(api, 'removePiece').mockResolvedValue({} as PlayerView)
    const first = { ...piece('resources/hut', 'hut-one'), category: 'resource' as const, label: 'Hut', path: 'resources/hut.png' }
    const second = { ...piece('resources/incense', 'incense-one'), category: 'resource' as const, label: 'Incense', path: 'resources/incense.png', x: 100 }
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [first, second] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const pointerTap = (target: HTMLElement, pointerId: number) => {
      for (const type of ['pointerdown', 'pointerup'] as const) {
        const event = new Event(type, { bubbles: true })
        for (const [name, value] of Object.entries({ pointerId, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 })) {
          Object.defineProperty(event, name, { value })
        }
        target.dispatchEvent(event)
      }
    }
    const pieces = () => Array.from(container.querySelectorAll<HTMLElement>('.board-piece'))
    pointerTap(pieces()[0] as HTMLElement, 3)
    await waitFor(() => expect(pieces()[0]?.classList.contains('selected')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removePiece).toHaveBeenCalledWith('game', first.id))

    pointerTap(pieces()[1] as HTMLElement, 4)
    await waitFor(() => expect(pieces()[1]?.classList.contains('selected')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removePiece).toHaveBeenCalledWith('game', second.id))
    removePiece.mockRestore()
    cleanup()
  })
})

describe('BoardView arrow-key nudge (issue #193)', () => {
  const selectByTouchTap = (target: HTMLElement, pointerId: number) => {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({ pointerId, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 })) {
        Object.defineProperty(event, name, { value })
      }
      target.dispatchEvent(event)
    }
  }

  it('does nothing and does not block scrolling when no piece is selected', () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [piece('buildings/academy', 'academy-idle')] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )

    const notCancelled = fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(notCancelled).toBe(true)
    expect(movePiece).not.toHaveBeenCalled()
    movePiece.mockRestore()
    cleanup()
  })

  it('nudges the selected piece the same visible distance at two different zoom levels', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const boardPiece = piece('buildings/academy', 'academy-nudge')
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const tile = container.querySelector('.board-piece')
    if (!(tile instanceof HTMLElement)) throw new Error('board piece missing')
    selectByTouchTap(tile, 1)
    await waitFor(() => expect(tile.classList.contains('selected')).toBe(true))

    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '1' } })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    await waitFor(() => expect(movePiece).toHaveBeenCalledTimes(1))
    const stepAtFullZoom = (movePiece.mock.calls[0]?.[2] as number) - boardPiece.x

    movePiece.mockClear()
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '0.5' } })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    await waitFor(() => expect(movePiece).toHaveBeenCalledTimes(1))
    const stepAtHalfZoom = (movePiece.mock.calls[0]?.[2] as number) - boardPiece.x

    // The on-screen distance (board step * zoom) is the same at both zoom
    // levels, so halving zoom doubles the board-coordinate step.
    expect(stepAtHalfZoom).toBeCloseTo(stepAtFullZoom * 2)
    movePiece.mockRestore()
    cleanup()
  })

  it('moves the selected piece in the direction of the pressed arrow key', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    // Well clear of every edge, so all four directions actually change the
    // position instead of being clamped back to where the piece started.
    const boardPiece = { ...piece('buildings/academy', 'academy-direction'), x: 200, y: 400 }
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const tile = container.querySelector('.board-piece')
    if (!(tile instanceof HTMLElement)) throw new Error('board piece missing')
    selectByTouchTap(tile, 1)
    await waitFor(() => expect(tile.classList.contains('selected')).toBe(true))

    const nudge = async (key: string) => {
      movePiece.mockClear()
      fireEvent.keyDown(document, { key })
      await waitFor(() => expect(movePiece).toHaveBeenCalledTimes(1))
      // The 5th argument (snap: false) is what makes the nudge bypass the
      // player-area/map-tile snapping (review round 1); assert it explicitly
      // so deleting it cannot slip past the suite unnoticed (review round 2).
      expect(movePiece).toHaveBeenCalledWith('game', boardPiece.id, expect.any(Number), expect.any(Number), false)
      const [, , x, y] = movePiece.mock.calls[0] as [string, string, number, number]
      return { x: x - boardPiece.x, y: y - boardPiece.y }
    }

    expect((await nudge('ArrowRight')).x).toBeGreaterThan(0)
    expect((await nudge('ArrowLeft')).x).toBeLessThan(0)
    expect((await nudge('ArrowDown')).y).toBeGreaterThan(0)
    expect((await nudge('ArrowUp')).y).toBeLessThan(0)
    movePiece.mockRestore()
    cleanup()
  })

  it('does not move the piece while busy or read-only', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const boardPiece = piece('buildings/academy', 'academy-guarded')
    const board = { ...createBoard(), pieces: [boardPiece] }
    const { container, rerender } = render(
      <BoardView gameId="game" board={board} numOfPlayers={2} areas={[]} busy={false} run={async action => { await action() }} />,
    )
    const tile = container.querySelector('.board-piece')
    if (!(tile instanceof HTMLElement)) throw new Error('board piece missing')
    selectByTouchTap(tile, 1)
    await waitFor(() => expect(tile.classList.contains('selected')).toBe(true))

    rerender(
      <BoardView gameId="game" board={board} numOfPlayers={2} areas={[]} busy run={async action => { await action() }} />,
    )
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(movePiece).not.toHaveBeenCalled()

    rerender(
      <BoardView gameId="game" board={board} numOfPlayers={2} areas={[]} busy={false} readOnly run={async action => { await action() }} />,
    )
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(movePiece).not.toHaveBeenCalled()
    movePiece.mockRestore()
    cleanup()
  })

  it('leaves an unrelated focused text input alone instead of nudging the piece', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const boardPiece = piece('buildings/academy', 'academy-focus')
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const tile = container.querySelector('.board-piece')
    if (!(tile instanceof HTMLElement)) throw new Error('board piece missing')
    selectByTouchTap(tile, 1)
    await waitFor(() => expect(tile.classList.contains('selected')).toBe(true))

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const notCancelled = fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(notCancelled).toBe(true)
    expect(movePiece).not.toHaveBeenCalled()

    input.remove()
    movePiece.mockRestore()
    cleanup()
  })

  it('cancels the browser default on a successful nudge, unlike the no-op paths above', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    // Well clear of every edge, so the nudge actually goes through.
    const boardPiece = { ...piece('buildings/academy', 'academy-preventdefault'), x: 200, y: 400 }
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const tile = container.querySelector('.board-piece')
    if (!(tile instanceof HTMLElement)) throw new Error('board piece missing')
    selectByTouchTap(tile, 1)
    await waitFor(() => expect(tile.classList.contains('selected')).toBe(true))

    const cancelled = fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(cancelled).toBe(false)
    await waitFor(() => expect(movePiece).toHaveBeenCalledTimes(1))
    movePiece.mockRestore()
    cleanup()
  })

  it('does not call the server when the nudge would not move an already-clamped piece', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    // Sits exactly at the board's top-left corner, so ArrowUp/ArrowLeft clamp
    // straight back to the same spot — the same no-op guard the drag path
    // already has for a plain click without movement.
    const boardPiece = piece('buildings/academy', 'academy-edge')
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [boardPiece] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    const tile = container.querySelector('.board-piece')
    if (!(tile instanceof HTMLElement)) throw new Error('board piece missing')
    selectByTouchTap(tile, 1)
    await waitFor(() => expect(tile.classList.contains('selected')).toBe(true))

    fireEvent.keyDown(document, { key: 'ArrowUp' })
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(movePiece).not.toHaveBeenCalled()
    movePiece.mockRestore()
    cleanup()
  })
})

describe('BoardView undo and redo', () => {
  const historyEntry = (playerId: string) => ({
    id: 'h1',
    at: null,
    playerId,
    username: 'someone',
    description: 'someone did something',
    change: { kind: 'place' as const, piece: piece('figures/redarmy', 'p1'), onTop: true },
    logLength: 0,
  })

  it('disables Undo when the board has no history yet', () => {
    render(
      <BoardView gameId="game" board={createBoard()} numOfPlayers={2} areas={[]} busy={false} youId="alice" run={async () => undefined} />,
    )
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true)
    cleanup()
  })

  it('disables Undo when the last change belongs to someone else', () => {
    const board = { ...createBoard(), history: [historyEntry('bob')] }
    render(
      <BoardView gameId="game" board={board} numOfPlayers={2} areas={[]} busy={false} youId="alice" run={async () => undefined} />,
    )
    expect(screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true)
    cleanup()
  })

  it('enables Undo and calls the API when the last change is your own', async () => {
    const undoBoard = vi.spyOn(api, 'undoBoard').mockResolvedValue({} as PlayerView)
    const board = { ...createBoard(), history: [historyEntry('alice')] }
    render(
      <BoardView
        gameId="game"
        board={board}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        youId="alice"
        run={async action => { await action() }}
      />,
    )
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect(undo.hasAttribute('disabled')).toBe(false)
    fireEvent.click(undo)
    await waitFor(() => expect(undoBoard).toHaveBeenCalledWith('game'))
    undoBoard.mockRestore()
    cleanup()
  })

  it('disables Redo until there is something to redo, then calls the API', async () => {
    const redoBoard = vi.spyOn(api, 'redoBoard').mockResolvedValue({} as PlayerView)
    const { rerender } = render(
      <BoardView gameId="game" board={createBoard()} numOfPlayers={2} areas={[]} busy={false} youId="alice" run={async () => undefined} />,
    )
    expect(screen.getByRole('button', { name: 'Redo' }).hasAttribute('disabled')).toBe(true)

    const board = { ...createBoard(), redo: [historyEntry('alice')] }
    rerender(
      <BoardView
        gameId="game"
        board={board}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        youId="alice"
        run={async action => { await action() }}
      />,
    )
    const redo = screen.getByRole('button', { name: 'Redo' })
    expect(redo.hasAttribute('disabled')).toBe(false)
    fireEvent.click(redo)
    await waitFor(() => expect(redoBoard).toHaveBeenCalledWith('game'))
    redoBoard.mockRestore()
    cleanup()
  })
})

describe('relic outline', () => {
  it('marks relic pieces, and only relic pieces, so the stylesheet can frame them', () => {
    const atlantis = findBoardAsset('relics/atlantis')
    if (atlantis === undefined) throw new Error('atlantis missing from manifest')
    const relic: BoardPiece = {
      ...piece('relics/atlantis', 'atlantis-1'),
      path: atlantis.path,
      label: atlantis.label,
      category: 'relic',
    }
    const building = piece('buildings/academy', 'academy-1')

    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [relic, building] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )

    const relicImage = container.querySelector('[data-piece-id="atlantis-1"]')
    const buildingImage = container.querySelector('[data-piece-id="academy-1"]')
    expect(relicImage?.classList.contains('board-piece-relic')).toBe(true)
    expect(buildingImage?.classList.contains('board-piece-relic')).toBe(false)
    cleanup()
  })

  it('keeps the relic class on a selected relic, where the stylesheet lets .selected win', async () => {
    const atlantis = findBoardAsset('relics/atlantis')
    if (atlantis === undefined) throw new Error('atlantis missing from manifest')
    const relic: BoardPiece = {
      ...piece('relics/atlantis', 'atlantis-1'),
      path: atlantis.path,
      label: atlantis.label,
      category: 'relic',
    }

    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [relic] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )
    const image = container.querySelector('[data-piece-id="atlantis-1"]')
    if (!(image instanceof HTMLElement)) throw new Error('relic missing from board')
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: 5,
        clientY: 5,
      })) Object.defineProperty(event, name, { value })
      image.dispatchEvent(event)
    }

    await waitFor(() => expect(image.classList.contains('selected')).toBe(true))
    expect(image.classList.contains('board-piece-relic')).toBe(true)
    cleanup()
  })
})

describe('blockaded pieces (issue #241)', () => {
  it('draws a blockaded piece greyed and struck through, with text for screen readers and a tooltip (issue #241)', () => {
    const blockaded = piece('buildings/academy', 'academy-blockaded')
    const free = piece('buildings/barracks', 'barracks-free')

    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [blockaded, free] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        blockadedPieceIds={['academy-blockaded']}
        run={async () => undefined}
      />,
    )

    const struck = container.querySelector('[data-piece-id="academy-blockaded"]')
    const other = container.querySelector('[data-piece-id="barracks-free"]')
    expect(struck?.classList.contains('board-piece-blockaded')).toBe(true)
    expect(struck?.getAttribute('title')).toContain('Blockaded by an enemy figure')
    // Not colour alone: the accessible name says so too.
    expect(struck?.getAttribute('alt')).toBe('Academy, blockaded')
    expect(container.querySelectorAll('.board-piece-strike')).toHaveLength(1)
    expect(container.querySelector('.board-piece-strike')?.getAttribute('aria-hidden')).toBe('true')

    expect(other?.classList.contains('board-piece-blockaded')).toBe(false)
    expect(other?.getAttribute('title')).not.toContain('Blockaded')
    expect(other?.getAttribute('alt')).toBe('Academy')
    cleanup()
  })

  it('draws a blockaded wonder like any other blockaded piece', () => {
    const zeus = findBoardAsset('wonders/statueofzeus')
    if (zeus === undefined) throw new Error('statue of zeus missing from manifest')
    const wonder: BoardPiece = {
      ...piece('wonders/statueofzeus', 'zeus-1'),
      path: zeus.path,
      label: zeus.label,
      category: 'wonder',
      ownerId: 'player-me',
    }
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [wonder] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        blockadedPieceIds={['zeus-1']}
        run={async () => undefined}
      />,
    )
    const image = container.querySelector('[data-piece-id="zeus-1"]')
    expect(image?.classList.contains('board-piece-blockaded')).toBe(true)
    expect(image?.getAttribute('title')).toContain('Blockaded by an enemy figure')
    expect(container.querySelectorAll('.board-piece-strike')).toHaveLength(1)
    cleanup()
  })

  it('draws no blockade marks when the view has no blockaded pieces', () => {
    const { container } = render(
      <BoardView
        gameId="game"
        board={{ ...createBoard(), pieces: [piece('buildings/academy', 'academy-1')] }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )
    expect(container.querySelector('.board-piece-blockaded')).toBeNull()
    expect(container.querySelector('.board-piece-strike')).toBeNull()
    cleanup()
  })
})

describe('BoardView terrain warning (issue #255)', () => {
  // A failing test must not leave its board or its spies for the next one.
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  // Aztec has every terrain. Squares are found by search, so a corrected tile
  // file does not break the tests. Zoom is set to 100 %, and jsdom reports a
  // zero-size surface, so a client coordinate is a board coordinate.
  const tileId = 'tiles/Aztec'
  const grid = tileTerrainGrid(tileId) as readonly (readonly Terrain[])[]
  const board0 = createBoard()
  const [tileX, tileY] = slotOrigin(board0, board0.slots[0] as { x: number; y: number })
  const centreOfSquare = (row: number, column: number): readonly [number, number] => [
    tileX + column * SQUARE_SIZE + SQUARE_SIZE / 2,
    tileY + row * SQUARE_SIZE + SQUARE_SIZE / 2,
  ]
  const squaresOf = (terrain: Terrain): readonly (readonly [number, number])[] =>
    grid.flatMap((cells, row) =>
      cells.flatMap((cell, column) => (cell === terrain ? [centreOfSquare(row, column)] : [])),
    )
  const squareOf = (terrain: Terrain, index = 0): readonly [number, number] => {
    const found = squaresOf(terrain)[index]
    if (found === undefined) throw new Error(`${tileId} has no ${terrain} square number ${index}`)
    return found
  }

  const mapTile = {
    ...piece(tileId, 'aztec'),
    category: 'tile' as const,
    label: 'Aztec',
    path: 'tiles/Aztec.png',
    x: tileX,
    y: tileY,
    width: TILE_SQUARES * SQUARE_SIZE,
    height: TILE_SQUARES * SQUARE_SIZE,
  }
  const asset = (id: string): BoardAsset => {
    const found = findBoardAsset(id)
    if (found === undefined) throw new Error(`${id} missing from manifest`)
    return found
  }
  /** A building of the real size whose centre is at (cx, cy). */
  const building = (id: string, pieceId: string, [cx, cy]: readonly [number, number]): BoardPiece => {
    const { width, height, label, path, category } = asset(id)
    return { ...piece(id, pieceId), label, path, category, width, height, x: cx - width / 2, y: cy - height / 2 }
  }

  const pointer = (target: HTMLElement, type: string, pointerType: string, clientX: number, clientY: number) => {
    const event = new Event(type, { bubbles: true })
    for (const [name, value] of Object.entries({ pointerId: 7, pointerType, isPrimary: true, button: 0, clientX, clientY })) {
      Object.defineProperty(event, name, { value })
    }
    target.dispatchEvent(event)
  }
  const tap = (target: HTMLElement, [x, y]: readonly [number, number]) => {
    pointer(target, 'pointerdown', 'touch', x, y)
    pointer(target, 'pointerup', 'touch', x, y)
  }

  const setup = (extra: readonly BoardPiece[] = [], assetIds: readonly string[] = []) => {
    const assets = vi.spyOn(api, 'boardAssets').mockResolvedValue(assetIds.map(asset))
    const placePiece = vi.spyOn(api, 'placePiece').mockResolvedValue({} as PlayerView)
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const all = [mapTile, ...extra]
    const utils = render(
      <BoardView
        gameId="game"
        board={{ ...board0, pieces: all }}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async action => { await action() }}
      />,
    )
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '1' } })
    const surface = utils.container.querySelector('.board-surface') as HTMLElement
    const element = (id: string) =>
      utils.container.querySelectorAll<HTMLElement>('.board-piece')[all.findIndex(candidate => candidate.id === id)] as HTMLElement
    return { assets, placePiece, movePiece, confirm, surface, element, container: utils.container }
  }
  const finish = (mocks: ReturnType<typeof setup>) => {
    mocks.assets.mockRestore()
    mocks.placePiece.mockRestore()
    mocks.movePiece.mockRestore()
    mocks.confirm.mockRestore()
    cleanup()
  }

  /** Arms a building from the palette, as a tap on the board would place it. */
  const arm = async (label: RegExp) => {
    fireEvent.click(screen.getByRole('button', { name: 'Buildings' }))
    const item = await screen.findByRole('button', { name: label })
    fireEvent.click(item)
  }

  it('asks before a tapped Library goes onto forest, and places it on OK', async () => {
    const mocks = setup([], ['buildings/library'])
    const library = asset('buildings/library')
    const [x, y] = squareOf('forest')
    await arm(/^Library/)
    tap(mocks.surface, [x, y])

    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledWith('game', library.id, x - library.width / 2, y - library.height / 2))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.confirm).toHaveBeenCalledWith(
      'A Library is meant for grassland, but this square is forest. Place it anyway?',
    )
    finish(mocks)
  })

  it('does not place the Library when the question is cancelled, and keeps it armed', async () => {
    const mocks = setup([], ['buildings/library'])
    mocks.confirm.mockReturnValue(false)
    const [fx, fy] = squareOf('forest')
    await arm(/^Library/)
    tap(mocks.surface, [fx, fy])

    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.placePiece).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Placing Library')

    // The next tap, on grassland, needs no question and places it.
    const [gx, gy] = squareOf('grassland')
    tap(mocks.surface, [gx, gy])
    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    finish(mocks)
  })

  it('does not ask for a Library on grassland', async () => {
    const mocks = setup([], ['buildings/library'])
    await arm(/^Library/)
    tap(mocks.surface, squareOf('grassland'))
    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).not.toHaveBeenCalled()
    finish(mocks)
  })

  it('does not ask for a Harbor on water, but asks for a Market on water', async () => {
    const mocks = setup([], ['buildings/harbor', 'buildings/market'])
    await arm(/^Harbor/)
    tap(mocks.surface, squareOf('water'))
    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).not.toHaveBeenCalled()

    mocks.placePiece.mockClear()
    await arm(/^Market/)
    tap(mocks.surface, squareOf('water'))
    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(String(mocks.confirm.mock.calls[0]?.[0])).toContain(
      'A Market is meant for any terrain except water, but this square is water.',
    )
    finish(mocks)
  })

  it('asks before a Library is dropped from the palette onto forest', async () => {
    const mocks = setup([], ['buildings/library'])
    const library = asset('buildings/library')
    const [x, y] = squareOf('forest')
    const dataTransfer = { getData: (type: string) => (type === 'text/civ-asset' ? library.id : '') }
    // jsdom has no DragEvent, so the coordinates go on a plain event.
    const drop = () => {
      const event = new Event('drop', { bubbles: true, cancelable: true })
      for (const [name, value] of Object.entries({ clientX: x, clientY: y, dataTransfer })) {
        Object.defineProperty(event, name, { value })
      }
      fireEvent(mocks.surface, event)
    }
    // The palette fills in after the asset list has loaded; the drop reads from the same list.
    fireEvent.click(screen.getByRole('button', { name: 'Buildings' }))
    await screen.findByRole('button', { name: /^Library/ })

    mocks.confirm.mockReturnValue(false)
    drop()
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.placePiece).not.toHaveBeenCalled()

    mocks.confirm.mockReturnValue(true)
    drop()
    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledWith('game', library.id, x - library.width / 2, y - library.height / 2))
    finish(mocks)
  })

  /** Drops a palette asset at a board point; jsdom has no DragEvent, so the fields go on a plain event. */
  const dropAsset = (surface: HTMLElement, assetId: string, [x, y]: readonly [number, number]) => {
    const event = new Event('drop', { bubbles: true, cancelable: true })
    const dataTransfer = { getData: (type: string) => (type === 'text/civ-asset' ? assetId : '') }
    for (const [name, value] of Object.entries({ clientX: x, clientY: y, dataTransfer })) {
      Object.defineProperty(event, name, { value })
    }
    fireEvent(surface, event)
  }

  it('asks before a wonder is dropped on water, and places it only on OK', async () => {
    const mocks = setup([], ['wonders/pyramids'])
    const pyramids = asset('wonders/pyramids')
    const [x, y] = squareOf('water')
    fireEvent.click(screen.getByRole('button', { name: 'Wonders' }))
    await screen.findByRole('button', { name: /Pyramids/ })

    mocks.confirm.mockReturnValue(false)
    dropAsset(mocks.surface, pyramids.id, [x, y])
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.confirm).toHaveBeenCalledWith(
      'The Pyramids is meant for any terrain except water, but this square is water. Place it anyway?',
    )
    expect(mocks.placePiece).not.toHaveBeenCalled()

    mocks.confirm.mockReturnValue(true)
    dropAsset(mocks.surface, pyramids.id, [x, y])
    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledWith('game', pyramids.id, x - pyramids.width / 2, y - pyramids.height / 2))
  })

  it('does not ask for a wonder dropped on forest, or in the Wonders area', async () => {
    const mocks = setup([], ['wonders/pyramids'])
    const pyramids = asset('wonders/pyramids')
    fireEvent.click(screen.getByRole('button', { name: 'Wonders' }))
    await screen.findByRole('button', { name: /Pyramids/ })

    dropAsset(mocks.surface, pyramids.id, squareOf('forest'))
    const area = wondersArea(board0)
    dropAsset(mocks.surface, pyramids.id, [area.x + area.width / 2, area.y + area.height / 2])
    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledTimes(2))
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('asks before a Great Person is tapped onto water, but not onto desert', async () => {
    const mocks = setup([], ['great people/general'])
    mocks.confirm.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Great People' }))
    fireEvent.click(await screen.findByRole('button', { name: /^General/ }))
    tap(mocks.surface, squareOf('water'))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(String(mocks.confirm.mock.calls[0]?.[0])).toBe(
      'A General is meant for any terrain except water, but this square is water. Place it anyway?',
    )
    expect(mocks.placePiece).not.toHaveBeenCalled()

    tap(mocks.surface, squareOf('desert'))
    await waitFor(() => expect(mocks.placePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).toHaveBeenCalledOnce()
  })

  it('asks before a moved Library lands on forest, and moves nothing when cancelled', async () => {
    const library = building('buildings/library', 'library-1', squareOf('grassland'))
    const mocks = setup([library])
    mocks.confirm.mockReturnValue(false)
    const [x, y] = squareOf('forest')

    tap(mocks.element('library-1'), [20, 20])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Library'))
    tap(mocks.surface, [x, y])
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.movePiece).not.toHaveBeenCalled()

    // Still armed: a tap on another grassland square moves it without a question.
    tap(mocks.surface, squareOf('grassland', 1))
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).toHaveBeenCalledOnce()
    finish(mocks)
  })

  it('keeps the armed Library selected when the question is cancelled after a press on a map tile', async () => {
    const library = building('buildings/library', 'library-1', squareOf('grassland'))
    const mocks = setup([library])
    mocks.confirm.mockReturnValue(false)
    const [x, y] = squareOf('forest')
    const clickTile = () => {
      pointer(mocks.element('aztec'), 'pointerdown', 'mouse', x, y)
      pointer(mocks.element('aztec'), 'pointerup', 'mouse', x, y)
    }

    tap(mocks.element('library-1'), [20, 20])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Library'))
    // A mouse click on the tile is a board tap for the armed piece.
    clickTile()
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.movePiece).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.element('library-1').classList.contains('selected')).toBe(true))
    expect(screen.getByRole('status').textContent).toContain('Moving Library')
    expect(mocks.element('aztec').classList.contains('selected')).toBe(false)

    // Still armed, so a second click and OK moves it.
    mocks.confirm.mockReturnValue(true)
    clickTile()
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledWith('game', 'library-1', x - library.width / 2, y - library.height / 2))
  })

  it('moves the Library on OK', async () => {
    const library = building('buildings/library', 'library-1', squareOf('grassland'))
    const mocks = setup([library])
    const [x, y] = squareOf('forest')
    tap(mocks.element('library-1'), [20, 20])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Library'))
    tap(mocks.surface, [x, y])
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledWith('game', 'library-1', x - library.width / 2, y - library.height / 2))
    expect(mocks.confirm).toHaveBeenCalledOnce()
    finish(mocks)
  })

  it('does not ask when a Library already on forest moves to another forest square', async () => {
    // It was placed there after an OK earlier, so asking again would be nagging.
    const library = building('buildings/library', 'library-1', squareOf('forest', 0))
    const mocks = setup([library])
    tap(mocks.element('library-1'), [20, 20])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Library'))
    tap(mocks.surface, squareOf('forest', 1))
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).not.toHaveBeenCalled()
    finish(mocks)
  })

  it('does not ask when a Library is moved off the map into the player band, where it is tidied into a slot', async () => {
    const library = building('buildings/library', 'library-1', squareOf('grassland'))
    const mocks = setup([library])
    tap(mocks.element('library-1'), [20, 20])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Library'))
    tap(mocks.surface, [200, areaBandTop(board0) + SQUARE_SIZE])
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).not.toHaveBeenCalled()
    finish(mocks)
  })

  it('asks before a dragged Library is dropped on forest, and the drag moves nothing when cancelled', async () => {
    const start = squareOf('grassland')
    const library = building('buildings/library', 'library-1', start)
    const mocks = setup([library])
    const [x, y] = squareOf('forest')
    const target = mocks.element('library-1')
    mocks.confirm.mockReturnValue(false)

    pointer(target, 'pointerdown', 'mouse', start[0], start[1])
    pointer(target, 'pointermove', 'mouse', x, y)
    pointer(target, 'pointerup', 'mouse', x, y)
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.movePiece).not.toHaveBeenCalled()

    mocks.confirm.mockReturnValue(true)
    pointer(target, 'pointerdown', 'mouse', start[0], start[1])
    pointer(target, 'pointermove', 'mouse', x, y)
    pointer(target, 'pointerup', 'mouse', x, y)
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledOnce())
    expect(mocks.movePiece).toHaveBeenCalledWith('game', 'library-1', x - library.width / 2, y - library.height / 2)
    finish(mocks)
  })

  /** A Library 3 px short of the border with other terrain to its right, so one 6 px nudge crosses it. */
  const libraryNextToBorder = (): BoardPiece => {
    let border: readonly [number, number] | undefined
    for (let row = 0; row < TILE_SQUARES; row++) {
      for (let column = 0; column < TILE_SQUARES - 1; column++) {
        if (grid[row]?.[column] === 'grassland' && grid[row]?.[column + 1] !== 'grassland') {
          border = [tileX + (column + 1) * SQUARE_SIZE, centreOfSquare(row, column)[1]]
        }
      }
    }
    if (border === undefined) throw new Error(`${tileId} has no grassland square with another terrain to its right`)
    return building('buildings/library', 'library-1', [border[0] - 3, border[1]])
  }

  it('asks before an arrow-key nudge carries a Library from grassland onto other terrain', async () => {
    const mocks = setup([libraryNextToBorder()])
    mocks.confirm.mockReturnValue(false)

    tap(mocks.element('library-1'), [20, 20])
    await waitFor(() => expect(mocks.element('library-1').classList.contains('selected')).toBe(true))
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.movePiece).not.toHaveBeenCalled()

    mocks.confirm.mockReturnValue(true)
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledOnce())
    expect(mocks.movePiece).toHaveBeenCalledWith('game', 'library-1', expect.any(Number), expect.any(Number), false)

    // A nudge that stays inside the square it is on needs no question.
    mocks.confirm.mockClear()
    mocks.movePiece.mockClear()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('a held arrow key does not ask again after Cancel, and moves nothing', async () => {
    const mocks = setup([libraryNextToBorder()])
    mocks.confirm.mockReturnValue(false)
    tap(mocks.element('library-1'), [20, 20])
    await waitFor(() => expect(mocks.element('library-1').classList.contains('selected')).toBe(true))

    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(mocks.confirm).toHaveBeenCalledOnce()
    // The browser repeats keydown while the key is held down.
    for (let repeat = 0; repeat < 3; repeat++) fireEvent.keyDown(document, { key: 'ArrowRight', repeat: true })
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(mocks.movePiece).not.toHaveBeenCalled()

    // A repeat that crosses no terrain border is an ordinary nudge.
    fireEvent.keyDown(document, { key: 'ArrowDown', repeat: true })
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).toHaveBeenCalledOnce()
  })

  it('never asks about a piece that is not one of the listed buildings', async () => {
    const hut = { ...piece('resources/hut', 'hut-1'), category: 'resource' as const, label: 'Hut', path: 'resources/hut.png', width: 40, height: 40 }
    const [x, y] = squareOf('water')
    const mocks = setup([{ ...hut, x: x - 20, y: y - 20 }])
    tap(mocks.element('hut-1'), [20, 20])
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Hut'))
    tap(mocks.surface, squareOf('forest'))
    await waitFor(() => expect(mocks.movePiece).toHaveBeenCalledOnce())
    expect(mocks.confirm).not.toHaveBeenCalled()
    finish(mocks)
  })
})

describe('BoardView square picking for a Build', () => {
  const cells = [
    { column: 3, row: 4, label: 'D5' },
    { column: 4, row: 4, label: 'E5' },
  ]
  const picking = (overrides: Partial<NonNullable<React.ComponentProps<typeof BoardView>['pickSquares']>> = {}) => ({
    itemLabel: 'Library',
    cells,
    selected: null,
    onPick: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  })
  const squares = (): HTMLElement[] => screen.queryAllByRole('button', { name: /^Place Library on / })
  const pointerTap = (target: HTMLElement, pointerId: number) => {
    for (const type of ['pointerdown', 'pointerup'] as const) {
      const event = new Event(type, { bubbles: true })
      for (const [name, value] of Object.entries({ pointerId, pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 })) {
        Object.defineProperty(event, name, { value })
      }
      target.dispatchEvent(event)
    }
  }

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('draws no square buttons outside pick mode', () => {
    render(<BoardView gameId="game" board={createBoard()} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} />)
    expect(squares()).toHaveLength(0)
  })

  it('draws one named button per candidate square inside the board surface, placed on its cell', () => {
    const board = createBoard()
    const { container } = render(
      <BoardView gameId="game" board={board} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} pickSquares={picking()} />,
    )
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '1' } })
    const surface = container.querySelector('.board-surface')
    if (!(surface instanceof HTMLElement)) throw new Error('surface missing')
    expect(surface.classList.contains('picking')).toBe(true)
    const buttons = squares()
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Place Library on D5', 'Place Library on E5'])
    for (const [index, button] of buttons.entries()) {
      const cell = cells[index]
      if (cell === undefined) throw new Error('cell missing')
      expect(surface.contains(button)).toBe(true)
      expect(button.tagName).toBe('BUTTON')
      expect(button.style.left).toBe(`${cell.column * board.squareSize}px`)
      expect(button.style.top).toBe(`${mapTop(board) + cell.row * board.squareSize}px`)
      expect(button.style.width).toBe(`${board.squareSize}px`)
      expect(button.style.height).toBe(`${board.squareSize}px`)
    }

    // The same cells at another zoom step: every length is scaled, the origin included.
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '0.5' } })
    const zoom = 0.5
    const scaled = squares()
    expect(scaled).toHaveLength(cells.length)
    for (const [index, button] of scaled.entries()) {
      const cell = cells[index]
      if (cell === undefined) throw new Error('cell missing')
      expect(button.style.left).toBe(`${cell.column * board.squareSize * zoom}px`)
      expect(button.style.top).toBe(`${(mapTop(board) + cell.row * board.squareSize) * zoom}px`)
      expect(button.style.width).toBe(`${board.squareSize * zoom}px`)
      expect(button.style.height).toBe(`${board.squareSize * zoom}px`)
    }
  })

  it('selects on click and on the keyboard, and marks the chosen square', () => {
    const onPick = vi.fn()
    const { rerender } = render(
      <BoardView gameId="game" board={createBoard()} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} pickSquares={picking({ onPick })} />,
    )
    const [d5, e5] = squares()
    if (d5 === undefined || e5 === undefined) throw new Error('squares missing')
    fireEvent.click(d5)
    expect(onPick).toHaveBeenCalledWith(cells[0])

    // A native button answers Enter and Space with a click; it only has to be focusable and not hidden.
    e5.focus()
    expect(document.activeElement).toBe(e5)
    expect(e5.tabIndex).toBe(0)
    fireEvent.click(e5)
    expect(onPick).toHaveBeenLastCalledWith(cells[1])

    rerender(
      <BoardView gameId="game" board={createBoard()} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} pickSquares={picking({ onPick, selected: { column: 4, row: 4 } })} />,
    )
    expect(squares().map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })

  it('cancels on Escape, except in a field that owns the key', () => {
    const onCancel = vi.fn()
    render(
      <BoardView gameId="game" board={createBoard()} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} pickSquares={picking({ onCancel })} />,
    )
    const zoom = screen.getByLabelText('Zoom')
    zoom.focus()
    fireEvent.keyDown(zoom, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    ;(zoom as HTMLElement).blur()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not listen for Escape when it is not in pick mode', () => {
    const onCancel = vi.fn()
    const { rerender } = render(
      <BoardView gameId="game" board={createBoard()} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} pickSquares={picking({ onCancel })} />,
    )
    rerender(<BoardView gameId="game" board={createBoard()} numOfPlayers={2} areas={[]} busy={false} run={async () => undefined} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('leaves pieces alone while picking: a tap neither selects nor moves them', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const board = { ...createBoard(), pieces: [piece('buildings/academy', 'academy-1')] }
    const { container } = render(
      <BoardView gameId="game" board={board} numOfPlayers={2} areas={[]} busy={false} run={async (action) => { await action() }} pickSquares={picking()} />,
    )
    const tile = container.querySelector('.board-piece')
    const surface = container.querySelector('.board-surface')
    if (!(tile instanceof HTMLElement) || !(surface instanceof HTMLElement)) throw new Error('board elements missing')

    pointerTap(tile, 1)
    expect(tile.classList.contains('selected')).toBe(false)
    expect(screen.queryByRole('status')).toBeNull()
    pointerTap(surface, 2)
    expect(movePiece).not.toHaveBeenCalled()
  })

  it('drops a piece selection and armed move when pick mode starts, and tap then tap works again after', async () => {
    const movePiece = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const board = { ...createBoard(), pieces: [piece('buildings/academy', 'academy-1')] }
    const props = { gameId: 'game', board, numOfPlayers: 2, areas: [], busy: false, run: async (action: () => Promise<unknown>) => { await action() } }
    const { container, rerender } = render(<BoardView {...props} />)
    const tile = container.querySelector('.board-piece')
    const surface = container.querySelector('.board-surface')
    if (!(tile instanceof HTMLElement) || !(surface instanceof HTMLElement)) throw new Error('board elements missing')

    pointerTap(tile, 1)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Academy'))

    rerender(<BoardView {...props} pickSquares={picking()} />)
    expect(screen.queryByRole('status')).toBeNull()

    rerender(<BoardView {...props} />)
    pointerTap(tile, 3)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Academy'))
    pointerTap(surface, 4)
    await waitFor(() => expect(movePiece).toHaveBeenCalledOnce())
  })

  describe('the palette while a Build waits for its square', () => {
    const pyramids = findBoardAsset('wonders/pyramids')
    if (pyramids === undefined) throw new Error('wonders/pyramids missing from manifest')
    const props = { gameId: 'game', board: createBoard(), numOfPlayers: 2, areas: [], busy: false, run: async (action: () => Promise<unknown>) => { await action() } }
    const wonderButton = async (): Promise<HTMLButtonElement> => {
      fireEvent.click(screen.getByRole('button', { name: 'Wonders' }))
      return (await screen.findByRole('button', { name: /Pyramids/ })) as HTMLButtonElement
    }
    const dropOnWondersArea = (surface: HTMLElement) => {
      const area = wondersArea(props.board)
      const event = new Event('drop', { bubbles: true, cancelable: true })
      const dataTransfer = { getData: (type: string) => (type === 'text/civ-asset' ? pyramids.id : '') }
      for (const [name, value] of Object.entries({ clientX: area.x + area.width / 2, clientY: area.y + area.height / 2, dataTransfer })) {
        Object.defineProperty(event, name, { value })
      }
      fireEvent(surface, event)
    }

    it('ignores a piece dropped on the board while picking, and places it again after', async () => {
      vi.spyOn(api, 'boardAssets').mockResolvedValue([pyramids])
      const placePiece = vi.spyOn(api, 'placePiece').mockResolvedValue({} as PlayerView)
      const { container, rerender } = render(<BoardView {...props} pickSquares={picking()} />)
      const surface = container.querySelector('.board-surface')
      if (!(surface instanceof HTMLElement)) throw new Error('surface missing')
      await wonderButton()

      dropOnWondersArea(surface)
      expect(placePiece).not.toHaveBeenCalled()

      rerender(<BoardView {...props} />)
      dropOnWondersArea(surface)
      await waitFor(() => expect(placePiece).toHaveBeenCalledOnce())
    })

    it('does not let the palette arm a piece while picking, and says why', async () => {
      vi.spyOn(api, 'boardAssets').mockResolvedValue([pyramids])
      const { rerender } = render(<BoardView {...props} pickSquares={picking()} />)
      const button = await wonderButton()
      expect(button.disabled).toBe(true)
      expect(button.draggable).toBe(false)
      expect(screen.getByText('Finish or cancel the build first.')).toBeTruthy()
      fireEvent.click(button)
      expect(screen.queryByText(/^Placing /)).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()

      // Outside pick mode the same button arms the piece as before.
      rerender(<BoardView {...props} />)
      expect(screen.queryByText('Finish or cancel the build first.')).toBeNull()
      const free = screen.getByRole('button', { name: /Pyramids/ }) as HTMLButtonElement
      expect(free.disabled).toBe(false)
      fireEvent.click(free)
      expect(screen.getByRole('status').textContent).toContain('Placing The Pyramids')
    })
  })

  it('brings the squares into view on entering, smoothly unless reduced motion is asked for, and not again on a refresh', () => {
    const board = createBoard()
    const props = { gameId: 'game', board, numOfPlayers: 2, areas: [], busy: false, run: async () => undefined }
    const scrollTo = vi.fn()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const first = render(<BoardView {...props} />)
    const scroll = first.container.querySelector('.board-scroll')
    if (!(scroll instanceof HTMLElement)) throw new Error('scroll box missing')
    ;(scroll as { scrollTo: unknown }).scrollTo = scrollTo

    first.rerender(<BoardView {...props} pickSquares={picking()} />)
    expect(scrollTo).toHaveBeenCalledOnce()
    expect(scrollTo.mock.calls[0]?.[0]).toMatchObject({ behavior: 'smooth' })

    first.rerender(<BoardView {...props} pickSquares={picking({ selected: { column: 3, row: 4 } })} />)
    expect(scrollTo).toHaveBeenCalledOnce()
    first.unmount()

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    const second = render(<BoardView {...props} />)
    const box = second.container.querySelector('.board-scroll')
    if (!(box instanceof HTMLElement)) throw new Error('scroll box missing')
    const reducedScroll = vi.fn()
    ;(box as { scrollTo: unknown }).scrollTo = reducedScroll
    second.rerender(<BoardView {...props} pickSquares={picking()} />)
    expect(reducedScroll.mock.calls[0]?.[0]).toMatchObject({ behavior: 'auto' })
  })
})
