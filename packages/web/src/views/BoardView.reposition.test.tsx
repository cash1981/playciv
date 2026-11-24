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

function renderBoard(props: { movementOverlay?: boolean; repositionFigures?: readonly RepositionableFigure[] }) {
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
    fireEvent.click(squares[0] as HTMLElement)

    await waitFor(() => expect(reposition).toHaveBeenCalledWith('game', 'army-1', 2, 1))
    expect(travel).not.toHaveBeenCalled()
  })

  it('offers nothing for a figure that is not in the list', async () => {
    const other = renderBoard({ movementOverlay: false, repositionFigures: [{ ...SQUARES, pieceId: 'someone-else' }] })
    selectArmy(other.container)
    await screen.findByText(/moves by the Movement rules/)
    expect(screen.queryAllByRole('button', { name: /Put Red army on/ })).toEqual([])
  })
})
