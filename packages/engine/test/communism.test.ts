/** Communism's Spy square lock (issue #302). */

import { describe, expect, it } from 'vitest'

import { placePiece, travelFigure } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction } from '../src/assisted.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import { communismLocksOf } from '../src/communism.js'
import { figureMovementOptions } from '../src/movement.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player, withCardInHand, withHutInHand } from './assisted-fixture.js'
import { coverMap } from './cover-map.js'
import { CASH1981, CHUL, firstCivGame, ITCHI, KARANDRAS1 } from './fixture.js'

const AT = '2026-10-28T12:00:00.000Z'

function movementTurn(): GameState {
  let state = firstCivGame()
  state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Communism' }))
  state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Communism' }))
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
}

function place(state: GameState, column: number, row: number): GameState {
  state = coverMap(state)
  const asset = findBoardAsset('figures/redarmy')
  if (asset === undefined) throw new Error('missing army')
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId: asset.id,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
}

const withSpy = (state: GameState): GameState => withHutInHand(state, 'Spy').state

const use = (
  state: GameState,
  column = 3,
  row = 3,
  requestId = 'req-communism',
  confirmedRepeat = false,
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'communism',
    requestId,
    at: AT,
    payload: { square: { column, row } },
    ...(confirmedRepeat ? { confirmedRepeat } : {}),
  })

const voted = (state: GameState, logId: string): GameState =>
  [KARANDRAS1, ITCHI, CHUL].reduce(
    (next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })),
    state,
  )

describe('Communism', () => {
  it('is ready in Movement with a Spy and wrong in City Management', () => {
    const state = withSpy(movementTurn())
    expect(assistedAvailability(state, CASH1981, 'communism').status).toBe('ready')

    const cm = unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
    const withTech = unwrap(chooseTech(cm, { playerId: CASH1981, techName: 'Communism' }))
    const revealed = unwrap(revealTech(withTech, { playerId: CASH1981, techName: 'Communism' }))
    expect(assistedAvailability(withSpy(revealed), CASH1981, 'communism').status).toBe('wrong-phase')
  })

  it('locks the square, spends the Spy and stops normal travel', () => {
    const state = place(withSpy(movementTurn()), 3, 3)
    const used = unwrap(use(state))
    expect(communismLocksOf(used)).toEqual([{ column: 3, row: 3 }])
    expect(player(used).items.some((item) => item.kind === 'hut' && item.name === 'Spy')).toBe(false)
    expect(used.discardedItems.some((item) => 'name' in item && item.name === 'Spy')).toBe(true)

    const army = used.board.pieces.find((piece) => piece.category === 'figure')
    if (army === undefined) throw new Error('missing army')
    const options = figureMovementOptions(used.board, player(used), army, 1, communismLocksOf(used))
    expect(options?.squareLocked).toBe(true)
    expect(options?.destinations).toHaveLength(0)
    expect(
      unwrapErr(travelFigure(used, { playerId: CASH1981, pieceId: army.id, column: 4, row: 3 })).kind,
    ).toBe('FIGURE_MOVE_ILLEGAL')
  })

  it('also stops a movement culture card from leaving the square', () => {
    const state = place(withSpy(movementTurn()), 3, 3)
    const used = unwrap(use(state))
    const { state: withCard, itemId } = withCardInHand(used, 'Migrants')
    const army = withCard.board.pieces.find((piece) => piece.category === 'figure')
    if (army === undefined) throw new Error('missing army')
    const refused = unwrapErr(
      performAssistedAction(withCard, {
        playerId: CASH1981,
        action: 'playCard',
        requestId: 'req-migrants',
        at: AT,
        payload: {
          itemId,
          targets: [],
          from: { column: 3, row: 3 },
          to: { column: 3, row: 5 },
          figureId: army.id,
        },
      }),
    )
    expect(refused.kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('can lock a water square without Sailing', () => {
    const state = place(withSpy(movementTurn()), 3, 3)
    expect(communismLocksOf(unwrap(use(state, 0, 0)))).toEqual([{ column: 0, row: 0 }])
  })

  it('allows a confirmed second use with another Spy', () => {
    const state = withSpy(withSpy(movementTurn()))
    const first = unwrap(use(state, 3, 3, 'req-1'))
    expect(unwrapErr(use(first, 4, 4, 'req-2')).kind).toBe('ASSISTED_ACTION_REJECTED')
    const second = unwrap(use(first, 4, 4, 'req-2', true))
    expect(communismLocksOf(second)).toEqual([
      { column: 3, row: 3 },
      { column: 4, row: 4 },
    ])
  })

  it('undo returns the Spy and removes the lock', () => {
    const state = place(withSpy(movementTurn()), 3, 3)
    const used = unwrap(use(state))
    const record = used.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing record')
    const undone = voted(unwrap(initiateUndo(used, { logId: record.logId, playerId: CASH1981 })), record.logId)
    expect(communismLocksOf(undone)).toHaveLength(0)
    expect(player(undone).items.some((item) => item.kind === 'hut' && item.name === 'Spy')).toBe(true)
  })

  it('rejects a square outside the map', () => {
    const state = withSpy(movementTurn())
    expect(unwrapErr(use(state, 999, 999)).kind).toBe('ASSISTED_ACTION_REJECTED')
  })
})
