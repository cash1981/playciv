/**
 * Figure movement (issue #302): cardinal steps up to the travel speed, water
 * rules, the once-a-turn lock, and the undo that gives the move back.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, travelFigure, undoLastBoardChange } from '../src/actions/board.js'
import {
  SQUARE_SIZE,
  findBoardAsset,
  mapTop,
  type BoardPiece,
} from '../src/board.js'
import {
  figureMovementOptions,
  movementOf,
  movementTotal,
  travelSpeedOf,
} from '../src/movement.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'
import { turnStatus } from '../src/turn.js'
import { terrainAt } from '../src/terrain.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

/** The fixture has four Red seats; movement needs a real owner per seat. */
function game(): GameState {
  const base = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      color: colours[index] ?? 'Yellow',
    })),
  }
}

const playerOf = (state: GameState, playerId = CASH1981): Playerhand => {
  const player = state.players.find((candidate) => candidate.playerId === playerId)
  if (player === undefined) throw new Error('missing fixture player')
  return player
}

const withPlayer = (state: GameState, player: Playerhand): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === player.playerId ? player : candidate,
  ),
})

/** Places a piece with its centre in the map square at `column`, `row`. */
function place(
  state: GameState,
  assetId: string,
  column: number,
  row: number,
  playerId = CASH1981,
): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
}

function placeTile(state: GameState, assetId: string): GameState {
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: 0,
      y: mapTop(state.board),
    }),
  )
}

const figure = (state: GameState): BoardPiece => {
  const piece = state.board.pieces.find((candidate) => candidate.category === 'figure')
  if (piece === undefined) throw new Error('no figure on the board')
  return piece
}

const withTech = (state: GameState, name: string, hidden = false): GameState => {
  const player = playerOf(state)
  return withPlayer(state, {
    ...player,
    techsChosen: [
      ...player.techsChosen,
      { name, hidden } as Playerhand['techsChosen'][number],
    ],
  })
}

const withSailing = (state: GameState): GameState => withTech(state, 'Sailing')

describe('movement speed', () => {
  it('adds the parts of the Movement expression', () => {
    expect(movementTotal('2')).toBe(2)
    expect(movementTotal('3+1')).toBe(4)
    expect(movementTotal('2+1+1')).toBe(4)
  })

  it('gives Natural Religion +1 to an army but not a scout', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'figures/redscout', 4, 1)
    const player = playerOf(state)
    const religious = withPlayer(state, {
      ...player,
      socialPolicies: [
        { name: 'Natural Religion', hidden: false } as Playerhand['socialPolicies'][number],
      ],
    })
    const armyPiece = religious.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    const scoutPiece = religious.board.pieces.find((piece) => piece.assetId === 'figures/redscout')
    if (armyPiece === undefined || scoutPiece === undefined) throw new Error('missing figure')

    expect(travelSpeedOf(player, armyPiece, 1)).toBe(2)
    expect(travelSpeedOf(playerOf(religious), armyPiece, 1)).toBe(3)
    expect(travelSpeedOf(playerOf(religious), scoutPiece, 1)).toBe(2)

    // An expression that already contains a bonus, as older saves typed Natural
    // Religion (`3+1`), is not given the bonus a second time.
    const typed = withPlayer(religious, {
      ...playerOf(religious),
      stats: { ...playerOf(religious).stats, mvmt: '3+1' },
    })
    expect(travelSpeedOf(playerOf(typed), armyPiece, 1)).toBe(4)

    const hidden = withPlayer(state, {
      ...player,
      socialPolicies: [
        { name: 'Natural Religion', hidden: true } as Playerhand['socialPolicies'][number],
      ],
    })
    expect(travelSpeedOf(playerOf(hidden), armyPiece, 1)).toBe(2)

    const anarchy = withPlayer(religious, {
      ...playerOf(religious),
      government: 'Anarchy',
    })
    expect(travelSpeedOf(playerOf(anarchy), armyPiece, 1)).toBe(2)
  })

  it('adds Henry Ford while faceup and doubles with Captain James Cook this turn', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const withFord = withPlayer(state, {
      ...playerOf(state),
      items: [
        {
          kind: 'greatperson',
          name: 'Henry Ford',
          hidden: false,
        } as Playerhand['items'][number],
      ],
    })
    expect(travelSpeedOf(playerOf(withFord), piece, 1)).toBe(3)

    const withCook = withPlayer(withFord, {
      ...playerOf(withFord),
      playerTurns: [
        {
          turnNumber: 1,
          usedActions: ['card:Captain James Cook'],
        } as unknown as Playerhand['playerTurns'][number],
      ],
    })
    expect(travelSpeedOf(playerOf(withCook), piece, 1)).toBe(6)
  })
})

describe('reachable squares', () => {
  it('lists cardinal squares within the speed, never diagonals', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')

    expect(options.speed).toBe(2)
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 1, row: 2, distance: 1, label: 'B3' }),
    )
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 3, row: 1, distance: 2 }),
    )
    // A diagonal square is reached in two cardinal steps, not one jump.
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 2, row: 2, distance: 2 }),
    )
  })

  it('does not walk through another figure to reach the square beyond it', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'figures/bluearmy', 2, 1, KARANDRAS1)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations.some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)
  })

  it('offers no destinations once the figure has moved', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 2 }),
    )
    const moved = figure(travelled)
    const options = figureMovementOptions(travelled.board, playerOf(travelled), moved, 1)
    if (options === null) throw new Error('expected movement options')

    expect(moved.movement).toMatchObject({ turn: 1, used: 1, locked: true })
    expect(options.locked).toBe(true)
    expect(options.destinations).toHaveLength(0)
  })

  it('is fresh again on the next turn', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 2 }),
    )
    const options = figureMovementOptions(
      travelled.board,
      playerOf(travelled),
      figure(travelled),
      2,
    )
    if (options === null) throw new Error('expected movement options')
    expect(options.locked).toBe(false)
    expect(options.destinations.length).toBeGreaterThan(0)
  })
})

// Tile 05 has water in the upper-left and land below it.
const waterGame = (): GameState =>
  place(placeTile(game(), 'tiles/tile05'), 'figures/redarmy', 0, 3)

describe('huts and villages', () => {
  it.each(['resources/hut', 'resources/village'])(
    'stops a move on a %s square unless Flight flies over it',
    (assetId) => {
      let state = place(game(), 'figures/redarmy', 1, 1)
      state = place(state, assetId, 2, 1)
      const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
      if (options === null) throw new Error('expected movement options')
      expect(options.destinations).toContainEqual(
        expect.objectContaining({ column: 2, row: 1, distance: 1 }),
      )
      expect(options.destinations.some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)

      const flying = withTech(state, 'Flight')
      const flown = figureMovementOptions(flying.board, playerOf(flying), figure(flying), 1)
      if (flown === null) throw new Error('expected movement options')
      expect(flown.destinations).toContainEqual(
        expect.objectContaining({ column: 3, row: 1, distance: 2 }),
      )
    },
  )

  it('lets a figure that starts on a hut move away', () => {
    let state = place(game(), 'figures/redarmy', 2, 1)
    state = place(state, 'resources/hut', 2, 1)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 3, row: 1, distance: 1 }),
    )
  })

  it('does not fly over with a hidden Flight', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'resources/hut', 2, 1)
    state = withTech(state, 'Flight', true)
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations.some((cell) => cell.column === 3 && cell.row === 1)).toBe(false)
  })

  it('refuses to travel past a hut without Flight', () => {
    let state = place(game(), 'figures/redarmy', 1, 1)
    state = place(state, 'resources/hut', 2, 1)
    const piece = figure(state)
    expect(
      unwrapErr(travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 3, row: 1 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
    const stopped = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 2, row: 1 }),
    ).board.pieces.find((candidate) => candidate.id === piece.id)
    expect(stopped?.movement).toMatchObject({ turn: 1, used: 1, locked: true })
  })
})

describe('water', () => {
  it('does not offer a water square without a water tech', () => {
    const state = waterGame()
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    const x = 0 * SQUARE_SIZE + SQUARE_SIZE / 2
    const y = mapTop(state.board) + 2 * SQUARE_SIZE + SQUARE_SIZE / 2
    expect(terrainAt(state.board, x, y)).toBe('water')
    expect(options.destinations.some((cell) => cell.column === 0 && cell.row === 2)).toBe(false)
  })

  it('offers water with Sailing, Steam Power or Flight', () => {
    const state = withSailing(waterGame())
    const options = figureMovementOptions(state.board, playerOf(state), figure(state), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations.some((cell) => cell.column === 0 && cell.row === 2)).toBe(true)
  })

  it('lets England cross water but never end there', () => {
    // A4 (grassland) has only two neighbours: A3 (water) and B4 (forest).
    // Put an enemy on B4 so the only two-step way to B3 (grassland) is across A3.
    const blocked = place(waterGame(), 'figures/bluearmy', 1, 3, KARANDRAS1)
    const base = withPlayer(blocked, {
      ...playerOf(blocked),
      civilization: { name: 'England' } as Playerhand['civilization'],
    })
    const options = figureMovementOptions(base.board, playerOf(base), figure(base), 1)
    if (options === null) throw new Error('expected movement options')
    expect(options.destinations).toContainEqual(
      expect.objectContaining({ column: 1, row: 2, distance: 2 }),
    )
    expect(options.destinations.some((cell) => cell.column === 0 && cell.row === 2)).toBe(false)

    // Without England, the same blocked route leaves B3 unreachable.
    const noCrossing = figureMovementOptions(blocked.board, playerOf(blocked), figure(blocked), 1)
    if (noCrossing === null) throw new Error('expected movement options')
    expect(noCrossing.destinations.some((cell) => cell.column === 1 && cell.row === 2)).toBe(false)
  })
})

describe('travelFigure', () => {
  it('moves a figure and records the distance and lock with the position', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 3, row: 1 }),
    )
    const moved = figure(travelled)

    expect(moved.x).toBe(Math.round(3 * SQUARE_SIZE + (SQUARE_SIZE - moved.width) / 2))
    expect(movementOf(moved, 1)).toEqual({ turn: 1, used: 2, locked: true })
    expect(travelled.board.history.at(-1)?.change).toMatchObject({
      kind: 'move',
      movement: { from: null, to: { turn: 1, used: 2, locked: true } },
    })
  })

  it('refuses a second move in the same turn', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 2 }),
    )
    const refused = unwrapErr(
      travelFigure(travelled, { playerId: CASH1981, pieceId: piece.id, column: 1, row: 3 }),
    )
    expect(refused.kind).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('refuses a square too far away and water without a tech', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    expect(
      unwrapErr(travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 4, row: 1 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')

    const wet = waterGame()
    const wetPiece = figure(wet)
    expect(
      unwrapErr(travelFigure(wet, { playerId: CASH1981, pieceId: wetPiece.id, column: 0, row: 2 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('refuses another player’s figure', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const refused = unwrapErr(
      travelFigure(state, { playerId: KARANDRAS1, pieceId: piece.id, column: 1, row: 2 }),
    )
    expect(refused.kind).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('undoes the position and the spent movement together', () => {
    const state = place(game(), 'figures/redarmy', 1, 1)
    const piece = figure(state)
    const travelled = unwrap(
      travelFigure(state, { playerId: CASH1981, pieceId: piece.id, column: 3, row: 1 }),
    )
    const undone = unwrap(undoLastBoardChange(travelled, CASH1981))
    const back = figure(undone)

    expect(back.x).toBe(piece.x)
    expect(back.y).toBe(piece.y)
    expect(back.movement).toBeUndefined()
    const options = figureMovementOptions(undone.board, playerOf(undone), back, 1)
    expect(options?.destinations.length).toBeGreaterThan(0)
    expect(turnStatus(undone).currentTurn).toBe(1)
  })
})
