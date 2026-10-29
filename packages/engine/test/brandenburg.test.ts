/** Brandenburg Gate's outskirts rule (issue #302, unofficial rules 209 to 214). */

import { describe, expect, it } from 'vitest'

import { placePiece, setWonderOwner, travelFigure } from '../src/actions/board.js'
import { brandenburgForbiddenFor, brandenburgZonesOf } from '../src/brandenburg.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { galileoDestinations } from '../src/galileo.js'
import { figureMovementOptions } from '../src/movement.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'

import { coverMap } from './cover-map.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

function game(): GameState {
  const base = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  return {
    ...base,
    players: base.players.map((candidate, index) => ({
      ...candidate,
      color: colours[index] ?? 'Yellow',
      stats: { ...candidate.stats, mvmt: '5' },
    })),
  }
}

function place(state: GameState, assetId: string, column: number, row: number, playerId = CASH1981): GameState {
  state = coverMap(state)
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

/** Blue's capital at (8, 8) and a Brandenburg Gate that Blue owns. */
function withGate(base: GameState = game()): GameState {
  let state = place(base, 'cities/bluecapital2', 8, 8, KARANDRAS1)
  state = place(state, 'wonders/brandenburggate', 8, 5, KARANDRAS1)
  const gate = state.board.pieces.find((piece) => piece.assetId === 'wonders/brandenburggate')
  if (gate === undefined) throw new Error('missing gate')
  return unwrap(setWonderOwner(state, { playerId: KARANDRAS1, pieceId: gate.id, ownerId: KARANDRAS1 }))
}

const playerOf = (state: GameState, id = CASH1981): Playerhand => {
  const found = state.players.find((candidate) => candidate.playerId === id)
  if (found === undefined) throw new Error('missing player')
  return found
}

const army = (state: GameState, owner: 'red' | 'blue' = 'red'): BoardPiece => {
  const piece = state.board.pieces.find((candidate) => candidate.assetId === `figures/${owner}army`)
  if (piece === undefined) throw new Error('no army')
  return piece
}

const inZone = (state: GameState, moverId: string, column: number, row: number): boolean =>
  brandenburgForbiddenFor(state, moverId).some((cell) => cell.column === column && cell.row === row)

describe('Brandenburg Gate zones', () => {
  it('guards the eight squares around the holder\'s city but not the centre', () => {
    const state = withGate()
    expect(brandenburgZonesOf(state)).toHaveLength(1)
    expect(inZone(state, CASH1981, 7, 7)).toBe(true)
    expect(inZone(state, CASH1981, 9, 9)).toBe(true)
    expect(inZone(state, CASH1981, 8, 8)).toBe(false)
    expect(inZone(state, CASH1981, 10, 8)).toBe(false)
  })

  it('does not restrict the holder\'s own figures', () => {
    expect(inZone(withGate(), KARANDRAS1, 7, 7)).toBe(false)
  })

  it('does nothing while the wonder is disabled, unowned or blockaded', () => {
    const state = withGate()
    const gate = state.board.pieces.find((piece) => piece.assetId === 'wonders/brandenburggate') as BoardPiece
    const disabled = unwrap(setWonderOwner(state, { playerId: KARANDRAS1, pieceId: gate.id, ownerId: null, disable: true }))
    expect(brandenburgZonesOf(disabled)).toHaveLength(0)

    // An enemy figure on the gate's own square blockades it (rule 214)
    const blockaded = place(state, 'figures/redarmy', 8, 5)
    expect(brandenburgZonesOf(blockaded)).toHaveLength(0)
  })

  it('guards the outskirts of a city that is not the capital', () => {
    let state = place(game(), 'cities/bluecity2', 8, 8, KARANDRAS1)
    state = place(state, 'wonders/brandenburggate', 8, 5, KARANDRAS1)
    const gate = state.board.pieces.find((piece) => piece.assetId === 'wonders/brandenburggate') as BoardPiece
    state = unwrap(setWonderOwner(state, { playerId: KARANDRAS1, pieceId: gate.id, ownerId: KARANDRAS1 }))
    expect(inZone(state, CASH1981, 7, 7)).toBe(true)
  })
})

describe('Brandenburg Gate with several cities', () => {
  it('guards the outskirts of every city of the holder, a metropolis and the capital included', () => {
    let state = place(game(), 'cities/bluemetropolis2', 8, 8, KARANDRAS1)
    state = place(state, 'cities/bluecity2', 2, 2, KARANDRAS1)
    state = place(state, 'cities/bluecapital2', 13, 2, KARANDRAS1)
    state = place(state, 'wonders/brandenburggate', 8, 5, KARANDRAS1)
    const gate = state.board.pieces.find((piece) => piece.assetId === 'wonders/brandenburggate') as BoardPiece
    state = unwrap(setWonderOwner(state, { playerId: KARANDRAS1, pieceId: gate.id, ownerId: KARANDRAS1 }))
    expect(inZone(state, CASH1981, 7, 7)).toBe(true)
    expect(inZone(state, CASH1981, 1, 1)).toBe(true)
    expect(inZone(state, CASH1981, 3, 3)).toBe(true)
    expect(inZone(state, CASH1981, 12, 1)).toBe(true)
    // The centres are not outskirts
    expect(inZone(state, CASH1981, 2, 2)).toBe(false)
    expect(inZone(state, CASH1981, 13, 2)).toBe(false)
  })
})

describe('Brandenburg Gate in movement', () => {
  it('offers no destination in the outskirts but still lets a figure cross them', () => {
    const state = place(withGate(), 'figures/redarmy', 5, 8)
    const options = figureMovementOptions(
      state.board,
      playerOf(state),
      army(state),
      1,
      [],
      brandenburgForbiddenFor(state, CASH1981),
    )
    if (options === null) throw new Error('expected options')
    expect(options.destinations.some((cell) => cell.column === 7 && cell.row === 8)).toBe(false)
    expect(options.destinations.some((cell) => cell.column === 6 && cell.row === 8)).toBe(true)
    // Four squares east is the far side of the outskirts: crossed, not ended in.
    expect(options.destinations.some((cell) => cell.column === 10 && cell.row === 8)).toBe(true)
  })

  it('refuses the travel route into the outskirts', () => {
    const state = place(withGate(), 'figures/redarmy', 5, 8)
    expect(
      unwrapErr(travelFigure(state, { playerId: CASH1981, pieceId: army(state).id, column: 7, row: 8 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
    expect(unwrap(travelFigure(state, { playerId: CASH1981, pieceId: army(state).id, column: 6, row: 8 }))).toBeDefined()
  })

  it('lets the holder move into their own outskirts', () => {
    const state = place(withGate(), 'figures/bluearmy', 5, 8, KARANDRAS1)
    expect(
      unwrap(travelFigure(state, { playerId: KARANDRAS1, pieceId: army(state, 'blue').id, column: 7, row: 8 })),
    ).toBeDefined()
  })

  it('takes the outskirts off Galileo\'s edge destinations', () => {
    let state = game()
    state = place(state, 'cities/bluecapital2', 1, 1, KARANDRAS1)
    state = place(state, 'wonders/brandenburggate', 1, 4, KARANDRAS1)
    const gate = state.board.pieces.find((piece) => piece.assetId === 'wonders/brandenburggate') as BoardPiece
    state = unwrap(setWonderOwner(state, { playerId: KARANDRAS1, pieceId: gate.id, ownerId: KARANDRAS1 }))
    // The capital at B2 has A1..C3 around it; A1 is an edge square.
    const all = galileoDestinations(state.board)
    const without = galileoDestinations(state.board, undefined, brandenburgForbiddenFor(state, CASH1981))
    expect(all.some((cell) => cell.column === 0 && cell.row === 0)).toBe(true)
    expect(without.some((cell) => cell.column === 0 && cell.row === 0)).toBe(false)
  })
})
