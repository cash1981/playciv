// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { boardWidth, createBoard, findBoardAsset } from '@civ/engine'
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
    const surface = container.querySelector('.board-surface')
    if (!(scroll instanceof HTMLElement) || !(surface instanceof HTMLElement)) throw new Error('board missing')
    let availableWidth = boardWidth(board) + 100
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => availableWidth })
    fireEvent(window, new Event('resize'))
    expect(surface.style.width).toBe(`${boardWidth(board)}px`)

    availableWidth = boardWidth(board) * 0.55
    fireEvent(window, new Event('resize'))
    expect(surface.style.width).toBe(`${boardWidth(board) * 0.5}px`)

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

  it('arms touch movement after selecting a piece and moves it on the next board tap', async () => {
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

  it('moves the armed piece when the destination tap lands on another piece', async () => {
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
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Moving Hut'))
    pointerTap(pieces()[1] as HTMLElement, 6)
    await waitFor(() => expect(movePiece).toHaveBeenCalledWith('game', first.id, expect.any(Number), expect.any(Number)))
    movePiece.mockRestore()
    cleanup()
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
