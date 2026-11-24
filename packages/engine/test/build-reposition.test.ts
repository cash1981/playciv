/**
 * Putting a figure a Build placed on another square of the same city, without Undo
 * (human, 2026-11-24): free while City Management is open, refused afterwards, and the
 * build's own undo still works from the new square.
 *
 * The scene is the one of `assisted-build.test.ts`: Cash is Red on Monarchy with the America
 * tile in the first slot and a red city on B2, whose outskirts are A1, B1, C1 (water), A2,
 * C2, A3, B3 and C3.
 */

import { describe, expect, it } from 'vitest'

import { movePiece, placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { repositionBuiltFigure, repositionableFiguresOf } from '../src/build-reposition.js'
import type { RepositionBuiltFigureInput } from '../src/build-reposition.js'
import { describeError } from '../src/errors.js'
import { travelFigure } from '../src/actions/board.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-24T10:00:00.000Z'

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

function withAmerica(state: GameState): GameState {
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  return unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
}

const withTrade = (state: GameState, trade: number): GameState => ({
  ...state,
  players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade } } : p)),
})

/** City Management open for Cash, with this much trade. */
const ready = (trade: number): GameState =>
  withTrade(
    unwrap(markPhasesDone(put(withAmerica(game()), CASH1981, 'cities/redcity2', 1, 1), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' })),
    trade,
  )

const me = (state: GameState) => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no Cash')
  return found
}
const cityOf = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city')
  return city
}

/** An army (4 production, the city has 5) or a scout (6: one trade short... three with the estimate of 5) built on `at`. */
function buildFigure(state: GameState, kind: 'army' | 'scout', at: { column: number; row: number }, requestId = 'req-1'): GameState {
  return unwrap(
    performAssistedAction(state, {
      playerId: CASH1981,
      action: 'build',
      requestId,
      at: AT,
      payload: { cityPieceId: cityOf(state).id, item: { kind }, target: at, ...(kind === 'scout' ? { rush: true } : {}) },
    }),
  )
}

const B3 = { column: 1, row: 2 }
const C2 = { column: 2, row: 1 }
const A1 = { column: 0, row: 0 }

const figureOf = (state: GameState, kind: 'army' | 'scout' = 'army'): BoardPiece => {
  const found = state.board.pieces.find((piece) => piece.assetId === `figures/red${kind}`)
  if (found === undefined) throw new Error('no figure')
  return found
}

const reposition = (state: GameState, to: { column: number; row: number }, extra: Partial<RepositionBuiltFigureInput> = {}) =>
  repositionBuiltFigure(state, { playerId: CASH1981, pieceId: figureOf(state).id, ...to, at: AT, ...extra })

const cellOf = (state: GameState, piece: BoardPiece) => mapCellOf(state.board, piece)

describe('repositioning a built figure', () => {
  it('offers the build\'s own squares except the one it stands on, in the own view only', () => {
    const done = buildFigure(ready(0), 'army', B3)
    const own = toPlayerView(done, CASH1981).you?.repositionableFigures ?? []
    expect(own).toHaveLength(1)
    const squares = own[0]?.squares.map((square) => square.label) ?? []
    expect(squares).toEqual(['A1', 'B1', 'A2', 'C2', 'A3', 'C3'])
    expect(own[0]?.pieceId).toBe(figureOf(done).id)
    // Another player sees none, and a spectator has no own view
    expect(toPlayerView(done, KARANDRAS1).you?.repositionableFigures).toEqual([])
    expect(toPlayerView(done, 'nobody').you).toBeNull()
  })

  it('puts the army on another square: free, one history entry, no movement spent', () => {
    const built = buildFigure(ready(2), 'army', B3)
    const before = me(built)
    const moved = unwrap(reposition(built, C2))
    const army = figureOf(moved)
    expect(cellOf(moved, army)).toEqual({ column: C2.column, row: C2.row })
    expect(army.movement).toBeUndefined()
    // Nothing paid or refunded, and the build is still applied, once
    expect(me(moved).stats.trade).toBe(before.stats.trade)
    expect(moved.assistedActions).toHaveLength(1)
    expect(moved.assistedActions[0]?.status).toBe('applied')
    expect(moved.board.history.length).toBe(built.board.history.length + 1)
    expect(moved.board.history.at(-1)?.description).toBe(
      'cash1981 put Red army on C2 instead of B3, still in City Management (no movement used)',
    )
    // The record follows the figure
    const effect = moved.assistedActions[0]?.effect
    expect(effect && 'square' in effect ? effect.square : null).toEqual({ column: 2, row: 1, label: 'C2' })
    // and it can be put on yet another square
    const again = unwrap(reposition(moved, A1))
    expect(cellOf(again, figureOf(again))).toEqual({ column: 0, row: 0 })
  })

  it('works for a scout too', () => {
    const built = buildFigure(ready(12), 'scout', B3)
    const moved = unwrap(
      repositionBuiltFigure(built, { playerId: CASH1981, pieceId: figureOf(built, 'scout').id, ...A1, at: AT }),
    )
    expect(cellOf(moved, figureOf(moved, 'scout'))).toEqual({ column: 0, row: 0 })
    expect(me(moved).stats.trade).toBe(me(built).stats.trade)
  })

  it('leaves the build undoable by vote from the new square: the figure goes and the trade comes back', () => {
    const built = buildFigure(ready(12), 'scout', B3)
    expect(me(built).stats.trade).toBeLessThan(12)
    const moved = unwrap(
      repositionBuiltFigure(built, { playerId: CASH1981, pieceId: figureOf(built, 'scout').id, ...C2, at: AT }),
    )
    const logId = moved.log.find((entry) => entry.assistedActionId === 'req-1')?.id ?? ''
    let next = unwrap(initiateUndo(moved, { logId, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
    expect(next.board.pieces.some((piece) => piece.assetId === 'figures/redscout')).toBe(false)
    expect(me(next).stats.trade).toBe(12)
    expect(next.assistedActions[0]?.status).toBe('undone')
  })

  it('cannot be taken back to the old square by the board Undo', () => {
    const moved = unwrap(reposition(buildFigure(ready(0), 'army', B3), C2))
    expect(describeError(unwrapErr(undoLastBoardChange(moved, CASH1981)))).toMatch(/assisted action/)
    expect(cellOf(moved, figureOf(moved))).toEqual({ column: 2, row: 1 })
  })

  it('refuses a square the build did not offer, and the square it stands on', () => {
    const built = buildFigure(ready(0), 'army', B3)
    // C1 is water, D4 is outside the outskirts of the city
    expect(describeError(unwrapErr(reposition(built, { column: 2, row: 0 })))).toMatch(/not a legal square/)
    expect(describeError(unwrapErr(reposition(built, { column: 3, row: 3 })))).toMatch(/not a legal square/)
    expect(describeError(unwrapErr(reposition(built, B3)))).toMatch(/already stands on B3/)
  })

  it('refuses a square that is full', () => {
    const base = ready(0)
    const crowded = put(base, CASH1981, 'figures/redscout', C2.column, C2.row)
    // The stacking limit is read from the player, so fill the square up to it
    const limit = toPlayerView(crowded, CASH1981).you?.stackingLimit ?? 1
    let full = crowded
    for (let count = 1; count < limit; count++) full = put(full, CASH1981, 'figures/redscout', C2.column, C2.row)
    const built = buildFigure(full, 'army', B3)
    expect(toPlayerView(built, CASH1981).you?.repositionableFigures[0]?.squares.map((square) => square.label)).not.toContain('C2')
    expect(describeError(unwrapErr(reposition(built, C2)))).toMatch(/not a legal square/)
  })

  it('is refused after End turn for City Management', () => {
    const built = buildFigure(ready(0), 'army', B3)
    const over = unwrap(markPhasesDone(built, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(describeError(unwrapErr(reposition(over, C2)))).toMatch(/City Management is over/)
    expect(repositionableFiguresOf(over, me(over))).toEqual([])
    expect(toPlayerView(over, CASH1981).you?.repositionableFigures).toEqual([])
  })

  it('is refused for another player and for a figure nobody built', () => {
    const built = buildFigure(ready(0), 'army', B3)
    expect(describeError(unwrapErr(reposition(built, C2, { playerId: KARANDRAS1 })))).toMatch(/not built by you/)
    const stray = put(built, CASH1981, 'figures/redscout', A1.column, A1.row)
    const scout = figureOf(stray, 'scout')
    expect(describeError(unwrapErr(repositionBuiltFigure(stray, { playerId: CASH1981, pieceId: scout.id, ...C2 })))).toMatch(/not built by you/)
    expect(unwrapErr(repositionBuiltFigure(built, { playerId: CASH1981, pieceId: 'nope', ...C2 })).kind).toBe('BOARD_PIECE_NOT_FOUND')
  })

  it('is refused for a building, which is not a figure', () => {
    const built = buildFigure(ready(0), 'army', B3)
    // The record of a building names a piece that is not a figure: only a figure's record qualifies
    const army = figureOf(built)
    const tampered: GameState = {
      ...built,
      assistedActions: built.assistedActions.map((record) =>
        record.effect.kind === 'build' && 'item' in record.effect
          ? ({ ...record, effect: { ...record.effect, item: { kind: 'building', assetId: 'buildings/library' } } } as typeof record)
          : record,
      ),
    }
    expect(describeError(unwrapErr(repositionBuiltFigure(tampered, { playerId: CASH1981, pieceId: army.id, ...C2 })))).toMatch(/not built by you/)
  })

  it('is refused once the figure has travelled, or left its square by hand', () => {
    const built = buildFigure(ready(0), 'army', B3)
    const army = figureOf(built)
    const travelled = unwrap(travelFigure(built, { playerId: CASH1981, pieceId: army.id, column: 0, row: 2, at: AT }))
    expect(describeError(unwrapErr(reposition(travelled, C2)))).toMatch(/has moved this turn/)
    expect(toPlayerView(travelled, CASH1981).you?.repositionableFigures).toEqual([])

    const dragged = unwrap(movePiece(built, { playerId: CASH1981, pieceId: army.id, x: army.x + 2 * SQUARE_SIZE, y: army.y, snap: false }))
    expect(describeError(unwrapErr(reposition(dragged, C2)))).toMatch(/has left B3/)
  })

  it('is refused when a later action used the figure', () => {
    const built = buildFigure(ready(0), 'army', B3)
    const army = figureOf(built)
    const used: GameState = {
      ...built,
      assistedActions: [
        ...built.assistedActions,
        { ...(built.assistedActions[0] as (typeof built.assistedActions)[number]), id: 'later', kind: 'startBuildingProgram', effect: { kind: 'startBuildingProgram', cityPieceId: army.id } as never },
      ],
    }
    expect(describeError(unwrapErr(reposition(used, C2)))).toMatch(/was used after it was built/)
  })

  it('is refused when a scout was harvested from, whose id only the submitted choices hold', () => {
    // A second city far away and no capital marker: the scout on C3 is offered to it, with the Incense under it
    const built = buildFigure(put(ready(12), CASH1981, 'cities/redcity2', 6, 5), 'scout', { column: 2, row: 2 })
    const scout = figureOf(built, 'scout')
    const far = built.board.pieces.filter((piece) => piece.category === 'city')[1]
    if (far === undefined) throw new Error('no second city')
    const harvested = unwrap(
      performAssistedAction(built, {
        playerId: CASH1981,
        action: 'harvest',
        requestId: 'req-h',
        at: AT,
        payload: { cityPieceId: far.id, resource: 'incense', scoutPieceId: scout.id },
      }),
    )
    // The effect of a harvest names no scout: only the payload that was submitted does
    expect(JSON.stringify(harvested.assistedActions.at(-1)?.effect)).not.toContain(scout.id)
    const refusedMove = repositionBuiltFigure(harvested, { playerId: CASH1981, pieceId: scout.id, ...A1, at: AT })
    expect(describeError(unwrapErr(refusedMove))).toMatch(/was used after it was built \(harvest\)/)
    expect(toPlayerView(harvested, CASH1981).you?.repositionableFigures).toEqual([])
    // Undo the harvest and the scout can be put elsewhere again
    expect(repositionableFiguresOf(built, me(built)).map((entry) => entry.pieceId)).toEqual([scout.id])
  })
})
