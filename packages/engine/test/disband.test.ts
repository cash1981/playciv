/**
 * Disbanding figures (Fame and Fortune p. 7–8, the human's rulings of 2026-10-30):
 * a scout or army that travels onto a centre of its own city may be disbanded
 * there for a caravan or a fortification, one marker per city; the defended city's
 * combat bonus; and the fortification the end of the battle uses up.
 */

import { describe, expect, it } from 'vitest'

import { endBattleAction, initiateBattle, undoEndBattle } from '../src/actions/arena.js'
import { placePiece, redoLastBoardChange, travelFigure, undoLastBoardChange } from '../src/actions/board.js'
import { SQUARE_SIZE, applyChange, findBoardAsset, mapTop, piecesAtStep, revertChange } from '../src/board.js'
import type { BoardPiece, Rotation } from '../src/board.js'
import { cityCenterCells } from '../src/blockade.js'
import { cityDefenceOf } from '../src/city-defence.js'
import { CARAVAN_ASSET_ID, FORTIFICATION_ASSET_ID, disbandOfferAt } from '../src/disband.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { battleSummaries } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { coverMap } from './cover-map.js'
import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

/** Cash is Red, Karandras Blue; the map is covered with tile backs, so nothing is fog. */
function game(): GameState {
  const base = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  return coverMap({
    ...base,
    players: base.players.map((player, index) => ({ ...player, color: colours[index] ?? 'Yellow' })),
  })
}

/** Places a piece with its centre in the map square at `column`, `row`. */
function place(state: GameState, assetId: string, column: number, row: number, playerId = CASH1981, rotation: Rotation = 0): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
      rotation,
    }),
  )
}

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const only = (state: GameState, assetId: string): BoardPiece => {
  const found = piecesOf(state, assetId)
  if (found.length !== 1 || found[0] === undefined) throw new Error(`expected one ${assetId}, found ${found.length}`)
  return found[0]
}

const travel = (state: GameState, assetId: string, column: number, row: number, disband?: boolean, playerId = CASH1981) =>
  travelFigure(state, {
    playerId,
    pieceId: only(state, assetId).id,
    column,
    row,
    ...(disband === undefined ? {} : { disband }),
  })

/** A red city on D4 (column 3, row 3), a red scout two squares south and a red army two squares east. */
const scene = (city = 'cities/redcity2'): GameState =>
  place(place(place(game(), city, 3, 3), 'figures/redscout', 3, 5), 'figures/redarmy', 5, 3)

describe('disbanding by travel', () => {
  it('a scout disbanded on its own city centre leaves a caravan there, in one board history entry after the move', () => {
    const before = scene()
    const scout = only(before, 'figures/redscout')
    const after = unwrap(travel(before, 'figures/redscout', 3, 3, true))

    expect(piecesOf(after, 'figures/redscout')).toEqual([])
    const caravan = only(after, CARAVAN_ASSET_ID)
    expect(caravan.placedBy).toBe(CASH1981)
    expect(after.board.history.slice(-2).map((entry) => entry.change.kind)).toEqual(['move', 'disband'])
    expect(after.board.history.at(-1)?.description).toBe('cash1981 disbanded Red scout in City D4, sending a caravan to the city')
    expect(after.board.history.at(-1)?.change).toMatchObject({ kind: 'disband', figure: { id: scout.id }, marker: { id: caravan.id } })

    // The caravan sits in the centre square
    expect(disbandOfferAt(after.board, 'Red', only(after, 'figures/redarmy'), { column: 3, row: 3 })?.existing?.id).toBe(caravan.id)
  })

  it('an army disbanded on its own city centre fortifies it', () => {
    const after = unwrap(travel(scene(), 'figures/redarmy', 3, 3, true))
    expect(piecesOf(after, 'figures/redarmy')).toEqual([])
    expect(piecesOf(after, FORTIFICATION_ASSET_ID)).toHaveLength(1)
    expect(piecesOf(after, CARAVAN_ASSET_ID)).toEqual([])
  })

  it('a city holds one marker: a later figure is only removed, whatever its kind', () => {
    const fortified = unwrap(travel(scene(), 'figures/redarmy', 3, 3, true))
    const after = unwrap(travel(fortified, 'figures/redscout', 3, 3, true))
    expect(piecesOf(after, 'figures/redscout')).toEqual([])
    expect(piecesOf(after, CARAVAN_ASSET_ID)).toEqual([])
    expect(piecesOf(after, FORTIFICATION_ASSET_ID)).toHaveLength(1)
    expect(after.board.history.at(-1)?.change).toMatchObject({ kind: 'disband', marker: null })
    expect(after.board.history.at(-1)?.description).toBe(
      'cash1981 disbanded Red scout in City D4, which already has a fortification, so nothing is gained',
    )
  })

  it('without the request the figure just moves onto the centre', () => {
    const after = unwrap(travel(scene(), 'figures/redscout', 3, 3))
    expect(piecesOf(after, 'figures/redscout')).toHaveLength(1)
    expect(piecesOf(after, CARAVAN_ASSET_ID)).toEqual([])
  })

  it('refuses on the outskirts, on another player\'s city and on open ground, and changes nothing', () => {
    const outskirts = travel(scene(), 'figures/redscout', 3, 4, true)
    expect(describeError(unwrapErr(outskirts))).toMatch(/only be disbanded on a centre square of one of your own cities/)

    const blue = place(place(game(), 'cities/bluecity2', 3, 3, KARANDRAS1), 'figures/redscout', 3, 5)
    expect(travel(blue, 'figures/redscout', 3, 3, true).ok).toBe(false)
    expect(travel(scene(), 'figures/redscout', 2, 5, true).ok).toBe(false)
  })

  it('works on either centre square of a metropolis, and a marker on one counts for both', () => {
    const state = place(game(), 'cities/redmetropolis2', 3, 3)
    const centres = cityCenterCells(state.board, only(state, 'cities/redmetropolis2')) ?? []
    expect(centres).toHaveLength(2)
    for (const centre of centres) {
      const withArmy = place(state, 'figures/redarmy', centre.column, centre.row + 2)
      const after = unwrap(travel(withArmy, 'figures/redarmy', centre.column, centre.row, true))
      const fortification = only(after, FORTIFICATION_ASSET_ID)
      expect(after.board.history.at(-1)?.description).toMatch(/in Metropolis /)
      // The marker on this centre is the city's marker from the other centre too
      for (const other of centres) {
        expect(disbandOfferAt(after.board, 'Red', fortification, other)).toBeUndefined()
        const scout = place(after, 'figures/redscout', other.column, other.row + 2)
        expect(disbandOfferAt(scout.board, 'Red', only(scout, 'figures/redscout'), other)?.existing?.id).toBe(fortification.id)
      }
    }
  })

  it('board Undo gives the figure back on the centre and takes the marker away, and the next Undo takes the move back', () => {
    const before = scene()
    const after = unwrap(travel(before, 'figures/redscout', 3, 3, true))
    const once = unwrap(undoLastBoardChange(after, CASH1981))
    expect(piecesOf(once, CARAVAN_ASSET_ID)).toEqual([])
    expect(piecesOf(once, 'figures/redscout')).toHaveLength(1)
    const twice = unwrap(undoLastBoardChange(once, CASH1981))
    expect(twice.board.pieces).toEqual(before.board.pieces)
  })

  it('board Redo brings the disband back exactly', () => {
    const after = unwrap(travel(scene(), 'figures/redscout', 3, 3, true))
    const redone = unwrap(redoLastBoardChange(unwrap(undoLastBoardChange(after, CASH1981)), CASH1981))
    expect(redone.board.pieces).toEqual(after.board.pieces)
  })

  it('refuses to disband onto a centre where another player\'s figures stand', () => {
    const state = place(scene(), 'figures/bluearmy', 3, 3, KARANDRAS1)
    expect(describeError(unwrapErr(travel(state, 'figures/redarmy', 3, 3, true)))).toMatch(/settle the battle before disbanding/)
  })

  it('the disband change applies and reverts exactly, so replay sees the same board', () => {
    const before = scene()
    const after = unwrap(travel(before, 'figures/redscout', 3, 3, true))
    const entry = after.board.history.at(-1)
    if (entry === undefined) throw new Error('no history')
    const moved = piecesAtStep(after.board.history, after.board.history.length - 1)
    expect(applyChange(moved, entry.change)).toEqual(after.board.pieces)
    expect(revertChange(after.board.pieces, entry.change)).toEqual(moved)
  })
})

describe('the defended city', () => {
  /** A blue army standing on the red city's centre, and a battle between them. */
  function attacked(city: string, extra: (state: GameState) => GameState = (state) => state): GameState {
    let state = extra(place(game(), city, 3, 3))
    state = place(state, 'figures/bluearmy', 3, 3, KARANDRAS1)
    return unwrap(initiateBattle(state, { initiatorId: KARANDRAS1, opponentId: CASH1981 }))
  }

  const defenceOf = (state: GameState) => {
    if (state.battle === null) throw new Error('no battle')
    return cityDefenceOf(state, state.battle)
  }

  it('a city gives +6, a capital +12, walls +4 more, a metropolis +2 more (base p. 23, F&F p. 9)', () => {
    expect(defenceOf(attacked('cities/redcity2'))?.total).toBe(6)
    expect(defenceOf(attacked('cities/redcitywalled2'))?.total).toBe(10)
    expect(defenceOf(attacked('cities/redcapital2'))?.total).toBe(12)
    expect(defenceOf(attacked('cities/redcapitalwalled2'))?.total).toBe(16)
    expect(defenceOf(attacked('cities/redmetropoliswalled2'))?.parts).toEqual([
      { label: 'Defending a capital', amount: 12 },
      { label: 'City Walls', amount: 4 },
      { label: 'Metropolis', amount: 2 },
    ])
  })

  it('a fortification adds +2, and the defender\'s combat bonus in the battle counts the city', () => {
    const state = attacked('cities/redcity2', (s) => place(s, FORTIFICATION_ASSET_ID, 3, 3))
    expect(defenceOf(state)).toMatchObject({ total: 8, cityLabel: 'City D4' })
    const [attacker, defender] = battleSummaries(state)
    expect(attacker?.cityDefence).toBeNull()
    expect(defender?.cityDefence?.total).toBe(8)
    expect(defender?.combatBonus).toBe(8)
  })

  it('a caravan adds nothing in battle', () => {
    expect(defenceOf(attacked('cities/redcity2', (s) => place(s, CARAVAN_ASSET_ID, 3, 3)))?.total).toBe(6)
  })

  it('no city bonus when the attacker stands on the outskirts, or on another colour\'s city', () => {
    let state = place(game(), 'cities/redcity2', 3, 3)
    state = place(state, 'figures/bluearmy', 3, 4, KARANDRAS1)
    const outskirts = unwrap(initiateBattle(state, { initiatorId: KARANDRAS1, opponentId: CASH1981 }))
    expect(defenceOf(outskirts)).toBeNull()

    // The battle's defender is Karandras, but the army stands on Cash's city
    const wrongSide = unwrap(initiateBattle(place(game(), 'cities/redcity2', 3, 3), { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    expect(defenceOf(wrongSide)).toBeNull()
  })

  it('ending the battle removes the fortification whoever won, and undoing the end puts it back', () => {
    const state = attacked('cities/redcity2', (s) => place(s, FORTIFICATION_ASSET_ID, 3, 3))
    const fortification = only(state, FORTIFICATION_ASSET_ID)
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    expect(piecesOf(ended, FORTIFICATION_ASSET_ID)).toEqual([])
    expect(ended.board.history.at(-1)?.change).toMatchObject({ kind: 'remove', piece: { id: fortification.id } })
    expect(ended.log.at(-1)?.publicLog).toContain('removes the fortification of City D4')
    expect(ended.endedBattle?.fortification).toEqual(fortification)

    const back = unwrap(undoEndBattle(ended, { playerId: KARANDRAS1 }))
    expect(piecesOf(back, FORTIFICATION_ASSET_ID)).toEqual([fortification])
    expect(back.log.at(-1)?.publicLog).toMatch(/undoes ending the battle and puts the fortification back$/)
    expect(back.battle).not.toBeNull()

    // A board Undo that already put it back is not doubled by the battle undo
    const boardUndone = unwrap(undoLastBoardChange(ended, KARANDRAS1))
    const both = unwrap(undoEndBattle(boardUndone, { playerId: KARANDRAS1 }))
    expect(piecesOf(both, FORTIFICATION_ASSET_ID)).toHaveLength(1)
  })

  it('undoing the end leaves the old fortification off when the city was fortified again since', () => {
    const state = attacked('cities/redcity2', (s) => place(s, FORTIFICATION_ASSET_ID, 3, 3))
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    const refortified = place(ended, FORTIFICATION_ASSET_ID, 3, 3)
    const back = unwrap(undoEndBattle(refortified, { playerId: KARANDRAS1 }))
    expect(piecesOf(back, FORTIFICATION_ASSET_ID)).toHaveLength(1)
    expect(back.log.at(-1)?.publicLog).toMatch(/undoes ending the battle$/)
  })

  it('a battle that is not for a fortified city removes no marker', () => {
    const state = attacked('cities/redcity2', (s) => place(s, CARAVAN_ASSET_ID, 3, 3))
    const ended = unwrap(endBattleAction(state, { playerId: KARANDRAS1 }))
    expect(piecesOf(ended, CARAVAN_ASSET_ID)).toHaveLength(1)
    expect(ended.endedBattle?.fortification).toBeUndefined()
  })
})
