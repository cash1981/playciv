/** Steam Power's Silk ability (issue #302): teleport the figures of one square onto a water square. */

import { describe, expect, it } from 'vitest'

import { placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { movementOf } from '../src/movement.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { steamPowerDestinations, steamPowerFiguresAt, waterCells } from '../src/steam-power.js'

import { player, withCardInHand, withHutInHand } from './assisted-fixture.js'
import { coverMap } from './cover-map.js'
import { CASH1981, CHUL, firstCivGame, ITCHI, KARANDRAS1 } from './fixture.js'

const AT = '2026-10-29T12:00:00.000Z'

/** City Management with Steam Power revealed, a Silk in hand and tile 05 (water upper-left) in the first slot. */
function cmTurn(stacking = 2): GameState {
  let state = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  state = {
    ...state,
    players: state.players.map((candidate, index) => ({
      ...candidate,
      color: colours[index] ?? 'Yellow',
      stats: { ...candidate.stats, stacking },
    })),
  }
  state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Steam Power' }))
  state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Steam Power' }))
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/tile05', x: 0, y: mapTop(state.board) }))
  state = withHutInHand(state, 'Silk').state
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
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

const WATER = (state: GameState) => {
  const cell = waterCells(state.board)[0]
  if (cell === undefined) throw new Error('tile 05 should have water')
  return cell
}

const use = (state: GameState, from: { column: number; row: number }, to: { column: number; row: number }, requestId = 'req-steam') =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'steamPower',
    requestId,
    at: AT,
    payload: { from, to },
  })

const figures = (state: GameState, owner?: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.category === 'figure' && (owner === undefined || piece.assetId.includes(owner)))

const voted = (state: GameState, logId: string): GameState =>
  [KARANDRAS1, ITCHI, CHUL].reduce(
    (next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })),
    state,
  )

describe('Steam Power Silk ability', () => {
  it('is ready in City Management with a Silk and wrong in Movement', () => {
    expect(assistedAvailability(cmTurn(), CASH1981, 'steamPower').status).toBe('ready')
    const movement = unwrap(markPhasesDone(cmTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(assistedAvailability(movement, CASH1981, 'steamPower').status).toBe('wrong-phase')
  })

  it('needs a Silk', () => {
    let state = firstCivGame()
    state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Steam Power' }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Steam Power' }))
    state = unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
    expect(assistedAvailability(state, CASH1981, 'steamPower').status).toBe('needs-resource')
  })

  it('moves every figure in the square to a water square, locks them and spends the Silk', () => {
    const state = place(place(cmTurn(), 'figures/redarmy', 2, 3), 'figures/redscout', 2, 3)
    const water = WATER(state)
    const used = unwrap(use(state, { column: 2, row: 3 }, water))

    for (const piece of figures(used)) {
      expect(mapCellOf(used.board, piece)).toEqual(water)
      expect(movementOf(piece, 1)).toMatchObject({ locked: true, reason: 'steamPower' })
    }
    expect(player(used).items.some((item) => item.kind === 'hut' && item.name === 'Silk')).toBe(false)
    expect(used.log.at(-1)?.publicLog).toContain('used Steam Power')
  })

  it('refuses a destination that is not water', () => {
    const state = place(cmTurn(), 'figures/redarmy', 2, 3)
    expect(unwrapErr(use(state, { column: 2, row: 3 }, { column: 3, row: 3 })).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('refuses a source without figures of yours', () => {
    const state = place(cmTurn(), 'figures/redarmy', 2, 3)
    expect(unwrapErr(use(state, { column: 1, row: 3 }, WATER(state))).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('respects the stacking limit at the destination (rule 50)', () => {
    let state = place(place(cmTurn(1), 'figures/redarmy', 2, 3), 'figures/redscout', 3, 3)
    const water = WATER(state)
    state = place(state, 'figures/redarmy', water.column, water.row)
    const army = steamPowerFiguresAt(state.board, player(state), { column: 2, row: 3 }, 1)
    const destinations = steamPowerDestinations(state.board, player(state), 1, army, { column: 2, row: 3 })
    expect(destinations.some((cell) => cell.column === water.column && cell.row === water.row)).toBe(false)
    expect(unwrapErr(use(state, { column: 2, row: 3 }, water)).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('lets an army land on water holding enemy figures but never a scout', () => {
    const base = cmTurn()
    const water = WATER(base)
    const enemy = place(base, 'figures/bluearmy', water.column, water.row, KARANDRAS1)

    const armyState = place(enemy, 'figures/redarmy', 2, 3)
    const landed = unwrap(use(armyState, { column: 2, row: 3 }, water))
    const redArmy = landed.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    expect(redArmy === undefined ? null : mapCellOf(landed.board, redArmy)).toEqual(water)

    const scoutState = place(enemy, 'figures/redscout', 2, 3)
    expect(unwrapErr(use(scoutState, { column: 2, row: 3 }, water)).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('lets figures on water stay and lock in place', () => {
    const base = cmTurn()
    const water = WATER(base)
    const state = place(base, 'figures/redarmy', water.column, water.row)
    const used = unwrap(use(state, water, water))
    expect(movementOf(figures(used)[0] as BoardPiece, 1)).toMatchObject({ locked: true, reason: 'steamPower' })
  })

  it('keeps a moved figure out of the movement culture cards', () => {
    const state = place(cmTurn(), 'figures/redarmy', 2, 3)
    const used = unwrap(use(state, { column: 2, row: 3 }, WATER(state)))
    // Migrants' movement is a Movement phase ability, played after this City Management
    const movement = unwrap(markPhasesDone(used, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    const { state: withCard, itemId } = withCardInHand(movement, 'Migrants')
    const army = figures(withCard)[0] as BoardPiece
    const water = WATER(withCard)
    const res = performAssistedAction(withCard, {
        playerId: CASH1981,
        action: 'playCard',
        requestId: 'req-migrants',
        at: AT,
        payload: { itemId, targets: [], from: water, to: { column: water.column + 1, row: water.row }, figureId: army.id },
      })
    const refused = unwrapErr(res)
    expect(refused.kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(JSON.stringify(refused)).toContain('Choose one of your figures in the source square')

    // Positive control: the same play with an unmoved figure is accepted
    const fresh = place(unwrap(markPhasesDone(cmTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' })), 'figures/redarmy', 2, 3)
    const { state: freshCard, itemId: freshId } = withCardInHand(fresh, 'Migrants')
    const freshArmy = figures(freshCard)[0] as BoardPiece
    expect(
      performAssistedAction(freshCard, {
        playerId: CASH1981,
        action: 'playCard',
        requestId: 'req-migrants-2',
        at: AT,
        payload: { itemId: freshId, targets: [], from: { column: 2, row: 3 }, to: { column: 2, row: 2 }, figureId: freshArmy.id },
      }).ok,
    ).toBe(true)
  })

  it('keeps the board Undo out of it, and the undo vote puts the figures and the Silk back', () => {
    const state = place(cmTurn(), 'figures/redarmy', 2, 3)
    const used = unwrap(use(state, { column: 2, row: 3 }, WATER(state)))
    expect(unwrapErr(undoLastBoardChange(used, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')

    const record = used.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing record')
    const undone = voted(unwrap(initiateUndo(used, { logId: record.logId, playerId: CASH1981 })), record.logId)
    expect(mapCellOf(undone.board, figures(undone)[0] as BoardPiece)).toEqual({ column: 2, row: 3 })
    expect(movementOf(figures(undone)[0] as BoardPiece, 1)).toBeNull()
    expect(player(undone).items.some((item) => item.kind === 'hut' && item.name === 'Silk')).toBe(true)
  })
})
