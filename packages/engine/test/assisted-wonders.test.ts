/**
 * The Build action for wonders (base rules p. 17): a city produces one of the wonders
 * faceup in the market, pays its cost (a lower one with the tech named on the card),
 * and the wonder stands in the city's outskirts and belongs to the player. One wonder
 * per city, any terrain but water. Buildings are tested in `assisted-build.test.ts`.
 *
 * The scene is that file's: Cash is Red on Monarchy and the America tile lies in the
 * first map slot with a red city on its square B2, whose outskirts are A1 mountain, B1
 * mountain, C1 water, A2 forest, C2 grassland, A3 desert, B3 desert and C3 mountain.
 * The market is the shared Wonders area: the test puts the wonders it needs there.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  removePiece,
  setCityProductionOverride,
  setWonderOwner,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction, takeBackOpenBuild } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, isInWondersArea, mapTop, slotOrigin, wondersArea } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { buildOptionsOf, buildSquareRefusal, marketWondersOf } from '../src/build-options.js'
import type { BuildChoice, CityBuildOptions } from '../src/build-options.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const COLOSSUS = 'wonders/colossus'
const STONEHENGE = 'wonders/stonehenge'
const PYRAMIDS = 'wonders/pyramids'
const C2 = { column: 2, row: 1 }
const C1 = { column: 2, row: 0 }
const A1 = { column: 0, row: 0 }

function game(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const state = firstCivGame()
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      color: colors[p.playerId] ?? p.color,
      government: p.playerId === CASH1981 ? 'Monarchy' : p.government,
    })),
  }
}

function put(state: GameState, playerId: string, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

/** A wonder in the market: a piece in the shared Wonders area that nobody owns. */
function inMarket(state: GameState, assetId: string, slot = 0): GameState {
  const area = wondersArea(state.board)
  return unwrap(
    placePiece(state, { playerId: CASH1981, assetId, x: area.x + 8 + slot * 10, y: area.y + 40 + slot * 90 }),
  )
}

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no cash')
  return found
}

const cityOf = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city')
  return city
}

function learn(state: GameState, ...techs: readonly string[]): GameState {
  return techs.reduce(
    (next, techName) =>
      unwrap(revealTech(unwrap(chooseTech(next, { playerId: CASH1981, techName })), { playerId: CASH1981, techName })),
    state,
  )
}

/** The America tile, a red city on B2, City Management open, the techs revealed, the trade in hand and a production set by hand. */
function ready(options: { techs?: readonly string[]; trade?: number; production?: number | null; market?: readonly string[] } = {}): GameState {
  const slot = game().board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  let state = game()
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  state = put(state, CASH1981, 'cities/redcity2', 1, 1)
  state = learn(state, ...(options.techs ?? []))
  state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  state = {
    ...state,
    players: state.players.map((p) =>
      p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade: options.trade ?? 0 } } : p,
    ),
  }
  const production = options.production === undefined ? 15 : options.production
  if (production !== null) {
    state = unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: cityOf(state).id, value: production }))
  }
  ;(options.market ?? [COLOSSUS, STONEHENGE]).forEach((assetId, index) => {
    state = inMarket(state, assetId, index)
  })
  return state
}

const optionsOf = (state: GameState): CityBuildOptions => {
  const found = buildOptionsOf(state, me(state))[0]
  if (found === undefined) throw new Error('no build options')
  return found
}
const wonderChoice = (options: CityBuildOptions, assetId: string): BuildChoice | undefined =>
  options.choices.find((choice) => choice.item.kind === 'wonder' && choice.assetId === assetId)
const wonderReason = (options: CityBuildOptions, assetId: string): string =>
  options.unavailable.find((entry) => entry.item.kind === 'wonder' && entry.assetId === assetId)?.reason ?? ''

const tryBuild = (
  state: GameState,
  assetId: string,
  at: { readonly column: number; readonly row: number },
  requestId = 'req-1',
  rush?: boolean,
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'build',
    requestId,
    at: AT,
    payload: {
      cityPieceId: cityOf(state).id,
      item: { kind: 'wonder', assetId },
      target: at,
      ...(rush === undefined ? {} : { rush }),
    },
  })
const build = (
  state: GameState,
  assetId: string,
  at: { readonly column: number; readonly row: number },
  requestId = 'req-1',
  rush?: boolean,
): GameState => unwrap(tryBuild(state, assetId, at, requestId, rush))

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

describe('the market', () => {
  it('is the wonders in the shared Wonders area that nobody owns', () => {
    const state = ready()
    const market = marketWondersOf(state.board, state.board.pieces)
    expect(market.map((piece) => piece.assetId)).toEqual([COLOSSUS, STONEHENGE])
    expect(market.every((piece) => isInWondersArea(state.board, piece))).toBe(true)

    // Owned, or standing on the map, is not in the market
    const colossus = piecesOf(state, COLOSSUS)[0] as BoardPiece
    const owned = unwrap(setWonderOwner(state, { playerId: CASH1981, pieceId: colossus.id, ownerId: KARANDRAS1 }))
    expect(marketWondersOf(owned.board, owned.board.pieces).map((piece) => piece.assetId)).toEqual([STONEHENGE])
    const onMap = put(state, CASH1981, PYRAMIDS, 9, 9)
    expect(marketWondersOf(onMap.board, onMap.board.pieces).map((piece) => piece.assetId)).toEqual([COLOSSUS, STONEHENGE])
  })
})

describe('what a city may build of the wonders', () => {
  it('offers each wonder of the market with its cost, on every square but water', () => {
    const options = optionsOf(ready())
    const colossus = wonderChoice(options, COLOSSUS)
    expect(colossus).toMatchObject({ placement: 'square', label: 'The Colossus', cost: 15, tradeToPay: 0 })
    // The outskirts of B2 without the water square C1
    expect(colossus?.squares.map((square) => square.label)).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'B3', 'C3'])
    expect(wonderChoice(options, STONEHENGE)).toMatchObject({ cost: 10 })
    // Only the market is offered: nothing else is a wonder choice
    expect(options.choices.filter((choice) => choice.item.kind === 'wonder')).toHaveLength(2)
  })

  it('costs less when the player knows the tech on the card, and says which', () => {
    const without = optionsOf(ready({ production: 11 }))
    expect(wonderChoice(without, COLOSSUS)).toBeUndefined()
    expect(wonderReason(without, COLOSSUS)).toMatch(/^Costs 15 production \(10 with Metalworking\) and City B2 has 11 /)

    const withTech = optionsOf(ready({ production: 11, techs: ['Metalworking'] }))
    expect(wonderChoice(withTech, COLOSSUS)).toMatchObject({ cost: 10, tradeToPay: 0 })
  })

  it('a tech that is chosen but not revealed gives no discount', () => {
    const chosen = unwrap(chooseTech(ready({ production: 11 }), { playerId: CASH1981, techName: 'Metalworking' }))
    expect(wonderChoice(optionsOf(chosen), COLOSSUS)).toBeUndefined()
  })

  it('a wonder without a discount costs the same for everybody', () => {
    const options = optionsOf(ready({ market: ['wonders/statueofzeus'] }))
    expect(wonderChoice(options, 'wonders/statueofzeus')).toMatchObject({ cost: 15 })
  })

  it('a shortfall is paid in trade, like a building', () => {
    const options = optionsOf(ready({ production: 12, trade: 9 }))
    expect(wonderChoice(options, COLOSSUS)).toMatchObject({ cost: 15, tradeToPay: 9 })
    const poor = optionsOf(ready({ production: 12, trade: 8 }))
    expect(wonderChoice(poor, COLOSSUS)).toBeUndefined()
    expect(wonderReason(poor, COLOSSUS)).toContain('takes 9 trade and you have 8')
  })

  it('a city holds one wonder: a wonder in its outskirts, whoever owns it, keeps the others out', () => {
    const state = put(ready(), KARANDRAS1, PYRAMIDS, 0, 2)
    const options = optionsOf(state)
    expect(options.choices.filter((choice) => choice.item.kind === 'wonder')).toEqual([])
    expect(wonderReason(options, COLOSSUS)).toBe(
      'City B2 already has The Pyramids. A city may hold only one wonder, and may also hold one limited building.',
    )
  })

  it('a limited building in the outskirts does not stop a wonder', () => {
    const state = put(ready(), CASH1981, 'buildings/temple', 0, 2)
    expect(wonderChoice(optionsOf(state), COLOSSUS)).toBeDefined()
  })

  it('a square with a building or a wonder is taken, and a city with only water has no square', () => {
    const state = put(ready(), CASH1981, 'buildings/library', 2, 1)
    expect(wonderChoice(optionsOf(state), COLOSSUS)?.squares.map((square) => square.label)).not.toContain('C2')
    expect(buildSquareRefusal(state, me(state), cityOf(state).id, { kind: 'wonder', assetId: COLOSSUS }, C2)).toBe(
      'C2 is already taken: Library stands there.',
    )
  })

  it('the water square is refused with the reason', () => {
    const state = ready()
    expect(buildSquareRefusal(state, me(state), cityOf(state).id, { kind: 'wonder', assetId: COLOSSUS }, C1)).toBe(
      'C1 is water, and a wonder needs any terrain except water.',
    )
  })

  it('outside City Management nothing is offered', () => {
    const closed = unwrap(markPhasesDone(ready(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    const options = optionsOf(closed)
    expect(options.status).toBe('wrong-phase')
    expect(options.choices).toEqual([])
  })
})

describe('building a wonder', () => {
  it('moves it out of the market onto the square, centred, and makes the player its owner', () => {
    const before = ready()
    const market = piecesOf(before, COLOSSUS)[0] as BoardPiece
    const done = build(before, COLOSSUS, C2)

    const wonders = piecesOf(done, COLOSSUS)
    // The same piece, not a new one
    expect(wonders).toHaveLength(1)
    const piece = wonders[0] as BoardPiece
    expect(piece.id).toBe(market.id)
    expect(mapCellOf(done.board, piece)).toEqual(C2)
    expect(Math.abs(piece.x + piece.width / 2 - (C2.column + 0.5) * SQUARE_SIZE)).toBeLessThanOrEqual(0.5)
    expect(piece.ownerId).toBe(CASH1981)
    expect(isInWondersArea(done.board, piece)).toBe(false)
    expect(marketWondersOf(done.board, done.board.pieces).map((p) => p.assetId)).toEqual([STONEHENGE])

    const [moved, owned] = done.board.history.slice(-2)
    expect(moved?.change).toMatchObject({ kind: 'move', pieceId: piece.id, from: { x: market.x, y: market.y } })
    expect(owned?.change).toMatchObject({ kind: 'owner', pieceId: piece.id, from: null, to: CASH1981 })
    expect(moved?.logLength).toBe(done.log.length)
    expect(owned?.logLength).toBe(done.log.length)
    expect(done.log.at(-1)?.publicLog).toBe('cash1981 built the Colossus in City B2 on square C2')
    expect(done.assistedActions[0]?.effect).toMatchObject({
      kind: 'build',
      item: { kind: 'wonder', assetId: COLOSSUS },
      pieceId: piece.id,
      wonder: { from: { x: market.x, y: market.y } },
    })
  })

  it('pays the discounted cost with the tech: nothing is paid when the production is enough', () => {
    const done = build(ready({ production: 10, techs: ['Metalworking'], trade: 5 }), COLOSSUS, C2)
    expect(me(done).stats.trade).toBe(5)
    expect(done.log.at(-1)?.publicLog).not.toContain('paying')
  })

  it('a rush pays the trade and needs the flag', () => {
    const state = ready({ production: 12, trade: 12 })
    expect(describeError(unwrapErr(tryBuild(state, COLOSSUS, C2)))).toBe(
      'The Colossus costs 15 and City B2 has 12. Confirm paying 9 trade to build it.',
    )
    const done = build(state, COLOSSUS, C2, 'req-1', true)
    expect(me(done).stats.trade).toBe(3)
    expect(done.log.at(-1)?.publicLog).toBe(
      'cash1981 built the Colossus in City B2 on square C2, paying 9 trade for the missing production',
    )
  })

  it('refuses a wonder that is not in the market, with the reason', () => {
    const state = ready({ market: [STONEHENGE] })
    expect(describeError(unwrapErr(tryBuild(state, COLOSSUS, C2)))).toBe(
      'The Colossus is not a wonder that can be built: it is not in the market.',
    )
  })

  it('refuses the water square and a second wonder in the same city', () => {
    expect(describeError(unwrapErr(tryBuild(ready(), COLOSSUS, C1)))).toContain('C1 is water, and a wonder needs any terrain except water.')
    const first = build(ready(), COLOSSUS, C2)
    const second = describeError(unwrapErr(tryBuild(first, STONEHENGE, A1, 'req-2')))
    expect(second).toContain('City B2 already has The Colossus')
  })

  it('a building program marker is used up, as with a building', () => {
    const marked = put(ready({ production: null }), CASH1981, 'markers/Building Program', 1, 1)
    // Doubled to 10, which pays Stonehenge
    const done = build(marked, STONEHENGE, C2)
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    expect(done.log.at(-1)?.publicLog).toBe(
      'cash1981 built Stonehenge in City B2 on square C2, using up the Building Program marker',
    )
  })

  it('the board Undo cannot take back the move or the new owner alone', () => {
    const done = build(ready(), COLOSSUS, C2)
    expect(done.board.history.at(-1)?.change.kind).toBe('owner')
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
  })

  it('every refusal leaves the game as it was', () => {
    const state = ready()
    const snapshot = JSON.stringify(state)
    for (const attempt of [tryBuild(state, COLOSSUS, C1), tryBuild(state, PYRAMIDS, C2, 'req-2')]) {
      expect(attempt.ok).toBe(false)
    }
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

describe('undoing a wonder', () => {
  it('by the vote puts it back in the market where it stood, unowned, and gives the trade back', () => {
    const before = ready({ production: 12, trade: 12 })
    const market = piecesOf(before, COLOSSUS)[0] as BoardPiece
    const undone = undoByVote(build(before, COLOSSUS, C2, 'req-1', true), 'req-1')

    const piece = piecesOf(undone, COLOSSUS)[0] as BoardPiece
    expect(piece.id).toBe(market.id)
    expect({ x: piece.x, y: piece.y }).toEqual({ x: market.x, y: market.y })
    expect(piece.ownerId ?? null).toBeNull()
    expect(marketWondersOf(undone.board, undone.board.pieces).map((p) => p.assetId)).toEqual([COLOSSUS, STONEHENGE])
    expect(me(undone).stats.trade).toBe(12)
    expect(undone.assistedActions[0]?.status).toBe('undone')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's Colossus on C2 was undone: the wonder was put back in the market, 9 trade returned",
    )
    // It can be built again
    expect(wonderChoice(optionsOf(undone), COLOSSUS)).toBeDefined()
  })

  it('is refused by the vote when the wonder has been moved off its square', () => {
    const done = build(ready(), COLOSSUS, C2)
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece
    const moved = unwrap(
      movePiece(done, { playerId: CASH1981, pieceId: piece.id, x: 3 * SQUARE_SIZE + 4, y: mapTop(done.board) + 3 * SQUARE_SIZE + 4 }),
    )
    const entry = moved.log.find((candidate) => candidate.assistedActionId === 'req-1')
    let next = unwrap(initiateUndo(moved, { logId: entry?.id ?? '', playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry?.id ?? '', playerId, vote: true, at: AT }))
    const refused = unwrapErr(vote(next, { logId: entry?.id ?? '', playerId: CHUL, vote: true, at: AT }))
    expect(refused).toMatchObject({ kind: 'ASSISTED_UNDO_BLOCKED', reason: 'The Colossus has left C2. Move it back first.' })
  })

  it('removing the wonder by hand before End turn puts it back in the market, and after End turn removes it as any piece', () => {
    const done = build(ready({ production: 12, trade: 12 }), COLOSSUS, C2, 'req-1', true)
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece

    const result = takeBackOpenBuild(done, { playerId: CASH1981, pieceId: piece.id, at: AT })
    if (result === undefined) throw new Error('the wonder is not an open build')
    const taken = unwrap(result)
    expect(marketWondersOf(taken.board, taken.board.pieces).map((p) => p.assetId)).toContain(COLOSSUS)
    expect(me(taken).stats.trade).toBe(12)
    expect(taken.log.at(-1)?.publicLog).toBe(
      "System: cash1981's Colossus on C2 was undone: the wonder was put back in the market, 9 trade returned. It was removed before End turn.",
    )

    const late = unwrap(markPhasesDone(done, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(takeBackOpenBuild(late, { playerId: CASH1981, pieceId: piece.id, at: AT })).toBeUndefined()
    expect(unwrap(removePiece(late, { playerId: CASH1981, pieceId: piece.id })).board.pieces.some((p) => p.id === piece.id)).toBe(false)
  })

  it('puts a taken-back wonder on the next free spot when another wonder has been drawn into its own', () => {
    const done = build(ready({ production: 15 }), COLOSSUS, C2)
    const market = marketWondersOf(done.board, done.board.pieces).find((piece) => piece.assetId === STONEHENGE) as BoardPiece
    const piece = piecesOf(done, COLOSSUS)[0] as BoardPiece
    const from = (done.assistedActions[0]?.effect as { wonder?: { from: { x: number; y: number } } }).wonder?.from as { x: number; y: number }
    // A wonder is drawn into the spot the Colossus left
    const area = wondersArea(done.board)
    const refilled = unwrap(placePiece(done, { playerId: CASH1981, assetId: PYRAMIDS, x: from.x, y: from.y }))
    expect(market.x).not.toBe(from.x)

    const result = takeBackOpenBuild(refilled, { playerId: CASH1981, pieceId: piece.id, at: AT })
    if (result === undefined) throw new Error('not an open build')
    const taken = unwrap(result)
    const back = piecesOf(taken, COLOSSUS)[0] as BoardPiece
    const pyramids = piecesOf(taken, PYRAMIDS)[0] as BoardPiece
    expect(isInWondersArea(taken.board, back)).toBe(true)
    expect(isInWondersArea(taken.board, pyramids)).toBe(true)
    // The two do not sit on top of each other
    expect(Math.abs(back.x - pyramids.x) >= back.width / 2 || Math.abs(back.y - pyramids.y) >= back.height / 2).toBe(true)
    expect(area.width).toBeGreaterThan(0)
  })

  it('puts a taken-back wonder back with a used Building Program marker restored, and the board Undo cannot undo it', () => {
    const marked = put(ready({ production: null }), CASH1981, 'markers/Building Program', 1, 1)
    const marker = piecesOf(marked, 'markers/Building Program')[0] as BoardPiece
    const done = build(marked, STONEHENGE, C2)
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    const piece = piecesOf(done, STONEHENGE)[0] as BoardPiece

    const result = takeBackOpenBuild(done, { playerId: CASH1981, pieceId: piece.id, at: AT })
    if (result === undefined) throw new Error('not an open build')
    const taken = unwrap(result)
    expect(piecesOf(taken, 'markers/Building Program')).toEqual([marker])
    expect(marketWondersOf(taken.board, taken.board.pieces).map((p) => p.assetId)).toContain(STONEHENGE)
    expect(unwrapErr(undoLastBoardChange(taken, CASH1981)).kind).toBe('NOTHING_TO_UNDO_ON_BOARD')
  })
})
