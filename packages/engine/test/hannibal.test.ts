/** Hannibal's group move between two of the player's squares (issue #302). */

import { describe, expect, it } from 'vitest'

import { placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player, withCardInHand } from './assisted-fixture.js'
import { coverMap } from './cover-map.js'
import { CASH1981, CHUL, firstCivGame, ITCHI, KARANDRAS1 } from './fixture.js'

const AT = '2026-10-28T12:00:00.000Z'

function game(): GameState {
  const base = firstCivGame()
  const colours = ['Red', 'Blue', 'Green', 'Purple']
  return {
    ...base,
    players: base.players.map((candidate, index) => ({
      ...candidate,
      color: colours[index] ?? 'Yellow',
    })),
  }
}

const cmTurn = (): GameState =>
  unwrap(markPhasesDone(game(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))

function place(state: GameState, assetId: string, column: number, row: number): GameState {
  state = coverMap(state)
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
}

const figuresIn = (state: GameState, column: number, row: number) =>
  state.board.pieces.filter((piece) => {
    if (piece.category !== 'figure') return false
    const cell = mapCellOf(state.board, piece)
    return cell?.column === column && cell.row === row
  })

const play = (
  state: GameState,
  itemId: string,
  from: { readonly column: number; readonly row: number },
  to: { readonly column: number; readonly row: number },
  figureIds?: readonly string[],
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'playCard',
    requestId: 'req-hannibal',
    at: AT,
    payload: {
      itemId,
      targets: [],
      from,
      to,
      ...(figureIds === undefined ? {} : { figureIds }),
    },
  })

const voted = (state: GameState, logId: string): GameState =>
  [KARANDRAS1, ITCHI, CHUL].reduce(
    (next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })),
    state,
  )

describe('Hannibal', () => {
  it('offers the map move in City Management', () => {
    const state = withCardInHand(cmTurn(), 'Hannibal').state
    expect(playableCardsOf(state, player(state)).find((card) => card.name === 'Hannibal')?.mapMove).toEqual({
      kind: 'hannibal',
      allowance: 0,
    })
  })

  it('moves any or all figures without exceeding the stacking limit', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Hannibal')
    let withFigures = place(place(state, 'figures/redarmy', 3, 3), 'figures/redarmy', 3, 3)
    withFigures = place(withFigures, 'figures/redarmy', 3, 5)
    const source = figuresIn(withFigures, 3, 3)
    expect(source).toHaveLength(2)

    const both = unwrapErr(play(withFigures, itemId, { column: 3, row: 3 }, { column: 3, row: 5 }))
    expect(both.kind).toBe('ASSISTED_ACTION_REJECTED')

    const one = unwrap(
      play(withFigures, itemId, { column: 3, row: 3 }, { column: 3, row: 5 }, [source[0]?.id ?? '']),
    )
    expect(figuresIn(one, 3, 3)).toHaveLength(1)
    expect(figuresIn(one, 3, 5)).toHaveLength(2)
  })

  it('moves all figures when there is room', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Hannibal')
    const withFigures = place(place(state, 'figures/redarmy', 3, 3), 'figures/redarmy', 3, 5)
    const source = figuresIn(withFigures, 3, 3)
    const played = unwrap(play(withFigures, itemId, { column: 3, row: 3 }, { column: 3, row: 5 }))
    expect(figuresIn(played, 3, 3)).toHaveLength(0)
    expect(figuresIn(played, 3, 5)).toHaveLength(2)
    expect(source).toHaveLength(1)
  })

  it('refuses an empty destination and the same square', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Hannibal')
    const withFigures = place(place(state, 'figures/redarmy', 3, 3), 'figures/redarmy', 3, 3)
    expect(
      unwrapErr(play(withFigures, itemId, { column: 3, row: 3 }, { column: 3, row: 5 })).kind,
    ).toBe('ASSISTED_ACTION_REJECTED')
    expect(
      unwrapErr(play(withFigures, itemId, { column: 3, row: 3 }, { column: 3, row: 3 })).kind,
    ).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('undoes the move and returns the card', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Hannibal')
    const withFigures = place(place(state, 'figures/redarmy', 3, 3), 'figures/redarmy', 3, 5)
    const played = unwrap(play(withFigures, itemId, { column: 3, row: 3 }, { column: 3, row: 5 }))
    expect(unwrapErr(undoLastBoardChange(played, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')
    const record = played.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing record')
    const undone = voted(unwrap(initiateUndo(played, { logId: record.logId, playerId: CASH1981 })), record.logId)
    expect(figuresIn(undone, 3, 3)).toHaveLength(1)
    expect(figuresIn(undone, 3, 5)).toHaveLength(1)
    expect(player(undone).items.some((item) => 'name' in item && item.name === 'Hannibal')).toBe(true)
  })
})
