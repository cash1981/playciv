// @vitest-environment jsdom

/**
 * The movement range is drawn only in the Movement phase, and a figure a Build placed this City
 * Management can be put on another square of its city without Undo (human, 2026-11-24).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SQUARE_SIZE, createBoard, findBoardAsset, mapTop } from '@civ/engine'
import type { BoardPiece, MovementPlayer, PlayerView, RepositionableFigure } from '@civ/engine'

import { api } from '../lib/api.js'

import { BoardView } from './BoardView.js'

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(api, 'boardAssets').mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const top = mapTop(createBoard())

function pieceOn(assetId: string, id: string, column: number, row: number, category: BoardPiece['category'] = 'figure'): BoardPiece {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing ${assetId}`)
  return {
    id,
    assetId: asset.id,
    path: asset.path,
    label: asset.label,
    category,
    x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
    y: top + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    width: asset.width,
    height: asset.height,
    rotation: 0,
    placedBy: 'player-one',
  }
}

const movementPlayer: MovementPlayer = {
  color: 'Red',
  civilization: null,
  stats: { mvmt: '2' },
  items: [],
  socialPolicies: [],
  techsChosen: [],
  playerTurns: [],
}

const SQUARES: RepositionableFigure = { pieceId: 'army-1', squares: [{ column: 2, row: 1, label: 'C2' }, { column: 0, row: 1, label: 'A2' }] }

function renderBoard(props: { movementOverlay?: boolean; repositionFigures?: readonly RepositionableFigure[]; outOfTurnQuestion?: string | null }) {
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    await action()
  }
  return render(
    <BoardView
      gameId="game"
      board={{ ...createBoard(), pieces: [pieceOn('tiles/tileback', 'tile-back', 0, 0, 'tile'), pieceOn('figures/redarmy', 'army-1', 1, 1)] }}
      numOfPlayers={2}
      areas={[]}
      busy={false}
      movementPlayer={movementPlayer}
      movementTurn={1}
      run={run}
      {...props}
    />,
  )
}

function selectArmy(container: HTMLElement): void {
  const army = container.querySelector('[data-piece-id="army-1"]')
  if (!(army instanceof HTMLElement)) throw new Error('army missing')
  const event = new Event('pointerdown', { bubbles: true })
  for (const [name, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 20, clientY: 20 })) {
    Object.defineProperty(event, name, { value })
  }
  army.dispatchEvent(event)
}

describe('the movement range', () => {
  it('is drawn for a selected figure while the Movement phase is on (the default)', async () => {
    const { container } = renderBoard({})
    selectArmy(container)
    expect((await screen.findAllByRole('button', { name: /Move Red army to/ })).length).toBeGreaterThan(0)
  })

  it('is not drawn in any other phase, and the figure still cannot be moved freely', async () => {
    const { container } = renderBoard({ movementOverlay: false })
    selectArmy(container)
    await screen.findByText(/moves by the Movement rules in the Movement phase/)
    expect(screen.queryAllByRole('button', { name: /Move Red army to/ })).toEqual([])
    expect(container.querySelector('.board-move-cell')).toBeNull()
    // The free Move button would bypass the Movement rules, so a movement figure has none
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull()
  })
})

describe('repositioning a built figure', () => {
  it('offers the squares of the selected figure and sends the pick, with no travel', async () => {
    const reposition = vi.spyOn(api, 'repositionBuiltFigure').mockResolvedValue({} as PlayerView)
    const travel = vi.spyOn(api, 'travelFigure').mockResolvedValue({} as PlayerView)
    const { container } = renderBoard({ movementOverlay: false, repositionFigures: [SQUARES] })
    // Nothing is offered until the figure is selected
    expect(container.querySelector('.board-reposition-cell')).toBeNull()
    selectArmy(container)

    const squares = await screen.findAllByRole('button', { name: /Put Red army on .* instead/ })
    expect(squares.map((square) => square.textContent)).toEqual(['C2', 'A2'])
    await screen.findByText(/Built this turn: click a blue square/)
    // The free Move button would bypass the Movement rules, also while the blue squares are up
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull()
    fireEvent.click(squares[0] as HTMLElement)

    await waitFor(() => expect(reposition).toHaveBeenCalledWith('game', 'army-1', 2, 1))
    expect(travel).not.toHaveBeenCalled()
  })

  /** One pointer event on the army, as a mouse drag would send it. */
  function pointer(army: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number): void {
    const event = new Event(type, { bubbles: true })
    for (const [name, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX, clientY })) {
      Object.defineProperty(event, name, { value })
    }
    army.dispatchEvent(event)
  }

  /** Drags the army from the centre of its square by `dx` screen pixels. */
  function dragArmyBy(container: HTMLElement, dx: number): void {
    const army = container.querySelector('[data-piece-id="army-1"]')
    if (!(army instanceof HTMLElement)) throw new Error('army missing')
    const zoom = Number.parseFloat(/([\d.]+)\s*%/.exec(screen.getByTestId('zoom-readout').textContent ?? '')?.[1] ?? '100') / 100
    const startX = (SQUARE_SIZE + SQUARE_SIZE / 2) * zoom
    const startY = (top + SQUARE_SIZE + SQUARE_SIZE / 2) * zoom
    pointer(army, 'pointerdown', startX, startY)
    pointer(army, 'pointermove', startX + dx, startY)
    pointer(army, 'pointerup', startX + dx, startY)
  }

  /** Drags the army from its square by `columns` columns, as far as the board's zoom turns that into screen pixels. */
  function dragArmy(container: HTMLElement, columns: number): void {
    const zoom = Number.parseFloat(/([\d.]+)\s*%/.exec(screen.getByTestId('zoom-readout').textContent ?? '')?.[1] ?? '100') / 100
    dragArmyBy(container, columns * SQUARE_SIZE * zoom)
  }

  it('moves the figure when it is dragged onto one of the offered squares, with no travel and no Undo', async () => {
    const reposition = vi.spyOn(api, 'repositionBuiltFigure').mockResolvedValue({} as PlayerView)
    const move = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const travel = vi.spyOn(api, 'travelFigure').mockResolvedValue({} as PlayerView)
    const { container } = renderBoard({ movementOverlay: false, repositionFigures: [SQUARES] })
    dragArmy(container, 1)
    await waitFor(() => expect(reposition).toHaveBeenCalledWith('game', 'army-1', 2, 1))
    expect(move).not.toHaveBeenCalled()
    expect(travel).not.toHaveBeenCalled()
  })

  it('still arranges a listed figure inside its own square', async () => {
    const reposition = vi.spyOn(api, 'repositionBuiltFigure').mockResolvedValue({} as PlayerView)
    const move = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const { container } = renderBoard({ movementOverlay: false, repositionFigures: [SQUARES] })
    dragArmyBy(container, 10)
    await waitFor(() => expect(move).toHaveBeenCalledWith('game', 'army-1', expect.any(Number), expect.any(Number), false))
    expect(reposition).not.toHaveBeenCalled()
  })

  it('asks about the warning on the square before a drop, as the tap does, and sends nothing when the answer is no', async () => {
    const reposition = vi.spyOn(api, 'repositionBuiltFigure').mockResolvedValue({} as PlayerView)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const warned: RepositionableFigure = { pieceId: 'army-1', squares: [{ column: 2, row: 1, label: 'C2', note: 'An enemy figure stands there.' }] }
    const { container } = renderBoard({ movementOverlay: false, repositionFigures: [warned] })
    dragArmy(container, 1)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('An enemy figure stands there. Put Red army on C2 anyway?'))
    expect(reposition).not.toHaveBeenCalled()

    cleanup()
    confirm.mockReturnValue(true)
    const again = renderBoard({ movementOverlay: false, repositionFigures: [warned] })
    dragArmy(again.container, 1)
    await waitFor(() => expect(reposition).toHaveBeenCalledWith('game', 'army-1', 2, 1))
  })

  it('asks the not-your-turn question before a drop, and sends nothing when the answer is no', async () => {
    const reposition = vi.spyOn(api, 'repositionBuiltFigure').mockResolvedValue({} as PlayerView)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { container } = renderBoard({ movementOverlay: false, repositionFigures: [SQUARES], outOfTurnQuestion: 'It is not your turn. Move anyway?' })
    dragArmy(container, 1)
    expect(confirm).toHaveBeenCalledWith('It is not your turn. Move anyway?')
    expect(reposition).not.toHaveBeenCalled()
  })

  it('springs back when it is dropped on a square that is not offered', async () => {
    const reposition = vi.spyOn(api, 'repositionBuiltFigure').mockResolvedValue({} as PlayerView)
    const move = vi.spyOn(api, 'movePiece').mockResolvedValue({} as PlayerView)
    const { container } = renderBoard({ movementOverlay: false, repositionFigures: [SQUARES] })
    dragArmy(container, 2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reposition).not.toHaveBeenCalled()
    expect(move).not.toHaveBeenCalled()
  })

  it('does not reposition a figure that is not in the list, even when dropped on an offered square', async () => {
    const reposition = vi.spyOn(api, 'repositionBuiltFigure').mockResolvedValue({} as PlayerView)
    const { container } = renderBoard({ movementOverlay: false, repositionFigures: [{ ...SQUARES, pieceId: 'someone-else' }] })
    dragArmy(container, 1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reposition).not.toHaveBeenCalled()
  })

  it('offers nothing for a figure that is not in the list', async () => {
    const other = renderBoard({ movementOverlay: false, repositionFigures: [{ ...SQUARES, pieceId: 'someone-else' }] })
    selectArmy(other.container)
    await screen.findByText(/moves by the Movement rules/)
    expect(screen.queryAllByRole('button', { name: /Put Red army on/ })).toEqual([])
  })
})
