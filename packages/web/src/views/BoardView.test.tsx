// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { boardWidth, createBoard, createBoardForPlayers, findBoardAsset, slotOrigin } from '@civ/engine'
import type { BoardPiece, PlayerView } from '@civ/engine'

import type { GameRevisionView } from '../lib/api.js'
import { api } from '../lib/api.js'

import { BoardPalette, BoardView, fittingBoardZoom } from './BoardView.js'
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
      privateDescription: null,
      logIds: [],
    },
    {
      gameId: 'game',
      revision: 1,
      createdAt: '2026-09-19T10:01:00.000Z',
      actor: { playerId: 'two', username: 'Bob' },
      publicDescription: 'Bob joined',
      privateDescription: null,
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
