/**
 * The movement ability of the culture cards (issue #302): Migrants, Colonists,
 * Immigrants, and the group cards Disoriented, Lost and Out of Position.
 */

import { describe, expect, it } from 'vitest'

import { bringToFront, placePiece, travelFigure, undoLastBoardChange } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { CARD_MOVE_RULES } from '../src/card-movement.js'
import { mapCellOf } from '../src/blockade.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player, withCardInHand } from './assisted-fixture.js'
import { coverMap } from './cover-map.js'
import { CASH1981, CHUL, firstCivGame, ITCHI, KARANDRAS1 } from './fixture.js'

const AT = '2026-10-28T12:00:00.000Z'

/** The fixture has four Red seats; card movement needs a real owner per seat. */
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

const movementTurn = (): GameState =>
  unwrap(markPhasesDone(game(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))

/** Places a piece with its centre in the map square at `column`, `row`. */
function place(
  state: GameState,
  assetId: string,
  column: number,
  row: number,
  playerId = CASH1981,
): GameState {
  state = coverMap(state)
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`missing asset ${assetId}`)
  const placed = unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: Math.round(column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2),
      y: Math.round(mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2),
    }),
  )
  // A real tile goes above the tile backs that cover the rest of the map
  const tile = asset.category === 'tile' ? placed.board.pieces.find((piece) => piece.assetId === assetId) : undefined
  return tile === undefined ? placed : unwrap(bringToFront(placed, { playerId, pieceId: tile.id }))
}

const figuresIn = (state: GameState, column: number, row: number) =>
  state.board.pieces.filter((piece) => {
    if (piece.category !== 'figure') return false
    const cell = mapCellOf(state.board, piece)
    return cell?.column === column && cell.row === row
  })

const withTech = (state: GameState, name: string): GameState => {
  const owner = state.players.find((candidate) => candidate.playerId === CASH1981)
  if (owner === undefined) throw new Error('missing player')
  return {
    ...state,
    players: state.players.map((candidate) =>
      candidate.playerId === CASH1981
        ? {
            ...candidate,
            techsChosen: [
              ...candidate.techsChosen,
              { name, hidden: false } as GameState['players'][number]['techsChosen'][number],
            ],
          }
        : candidate,
    ),
  }
}

const play = (
  state: GameState,
  itemId: string,
  name: string,
  from: { readonly column: number; readonly row: number },
  to: { readonly column: number; readonly row: number },
  options: { readonly targets?: readonly string[]; readonly figureId?: string } = {},
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'playCard',
    requestId: `req-${name}`,
    at: AT,
    payload: {
      itemId,
      targets: options.targets ?? [],
      from,
      to,
      ...(options.figureId === undefined ? {} : { figureId: options.figureId }),
    },
  })

const voted = (state: GameState, logId: string): GameState =>
  [KARANDRAS1, ITCHI, CHUL].reduce(
    (next, playerId) => unwrap(vote(next, { logId, playerId, vote: true, at: AT })),
    state,
  )

describe('the card list', () => {
  it('has the printed allowances', () => {
    expect(CARD_MOVE_RULES.get('Migrants')).toEqual({ kind: 'one', allowance: 2 })
    expect(CARD_MOVE_RULES.get('Colonists')).toEqual({ kind: 'one', allowance: 4 })
    expect(CARD_MOVE_RULES.get('Immigrants')).toEqual({ kind: 'one', allowance: 6 })
    expect(CARD_MOVE_RULES.get('Disoriented')).toEqual({ kind: 'group', allowance: 2 })
    expect(CARD_MOVE_RULES.get('Lost')).toEqual({ kind: 'group', allowance: 3 })
    expect(CARD_MOVE_RULES.get('Out of Position')).toEqual({ kind: 'group', allowance: 4 })
  })

  it('offers the one-figure movement only in Movement and the group move in City Management', () => {
    const migrants = withCardInHand(movementTurn(), 'Migrants').state
    expect(playableCardsOf(migrants, player(migrants)).find((card) => card.name === 'Migrants')?.mapMove).toEqual({
      kind: 'one',
      allowance: 2,
    })
    const migrantsInCm = withCardInHand(cmTurn(), 'Migrants').state
    expect(playableCardsOf(migrantsInCm, player(migrantsInCm)).find((card) => card.name === 'Migrants')?.mapMove).toBeNull()

    const lost = withCardInHand(cmTurn(), 'Lost').state
    expect(playableCardsOf(lost, player(lost)).find((card) => card.name === 'Lost')?.mapMove).toEqual({
      kind: 'group',
      allowance: 3,
    })
  })
})

describe('one-figure cards', () => {
  it('moves one chosen figure, without locking its normal movement', () => {
    const { state, itemId } = withCardInHand(movementTurn(), 'Migrants')
    const withFigures = place(place(state, 'figures/redarmy', 4, 4), 'figures/redscout', 4, 4)
    const army = figuresIn(withFigures, 4, 4).find((piece) => piece.assetId === 'figures/redarmy')
    if (army === undefined) throw new Error('missing army')

    const played = unwrap(play(withFigures, itemId, 'Migrants', { column: 4, row: 4 }, { column: 4, row: 6 }, { figureId: army.id }))

    expect(figuresIn(played, 4, 6)).toHaveLength(1)
    expect(figuresIn(played, 4, 6)[0]?.id).toBe(army.id)
    expect(figuresIn(played, 4, 4)).toHaveLength(1)
    expect(figuresIn(played, 4, 6)[0]?.movement).toBeUndefined()
  })

  it('moves a figure after its normal travel, since the card is a separate move', () => {
    const { state, itemId } = withCardInHand(movementTurn(), 'Migrants')
    let withFigure = place(state, 'figures/redarmy', 2, 2)
    const army = figuresIn(withFigure, 2, 2)[0]
    if (army === undefined) throw new Error('missing army')
    withFigure = unwrap(
      travelFigure(withFigure, { playerId: CASH1981, pieceId: army.id, column: 2, row: 3 }),
    )
    const travelled = figuresIn(withFigure, 2, 3)[0]
    if (travelled === undefined) throw new Error('missing travelled army')
    expect(travelled.movement).toMatchObject({ locked: true, reason: 'travel' })

    const played = unwrap(
      play(withFigure, itemId, 'Migrants', { column: 2, row: 3 }, { column: 4, row: 3 }, { figureId: army.id }),
    )
    expect(figuresIn(played, 4, 3)).toHaveLength(1)
    expect(figuresIn(played, 4, 3)[0]?.movement).toMatchObject({ locked: true, reason: 'travel' })
  })

  it('refuses a non-empty destination and a figure locked by Galileo', () => {
    const { state, itemId } = withCardInHand(movementTurn(), 'Migrants')
    const withFigure = place(state, 'figures/redarmy', 2, 2)
    const army = figuresIn(withFigure, 2, 2)[0]
    if (army === undefined) throw new Error('missing army')
    const blocked = place(withFigure, 'resources/hut', 2, 3)
    expect(
      unwrapErr(play(blocked, itemId, 'Migrants', { column: 2, row: 2 }, { column: 2, row: 3 }, { figureId: army.id })).kind,
    ).toBe('ASSISTED_ACTION_REJECTED')

    const galileoLocked: GameState = {
      ...withFigure,
      board: {
        ...withFigure.board,
        pieces: withFigure.board.pieces.map((piece) =>
          piece.id === army.id
            ? { ...piece, movement: { turn: 1, used: 0, locked: true, reason: 'galileo' } }
            : piece,
        ),
      },
    }
    expect(
      unwrapErr(play(galileoLocked, itemId, 'Migrants', { column: 2, row: 2 }, { column: 2, row: 4 }, { figureId: army.id })).kind,
    ).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('uses ordinary water rules: a figure on water may move on water with Sailing', () => {
    const base = withTech(movementTurn(), 'Sailing')
    const { state, itemId } = withCardInHand(base, 'Migrants')
    let withFigure = place(state, 'tiles/tile05', 0, 0)
    withFigure = place(withFigure, 'figures/redarmy', 0, 0)
    const army = figuresIn(withFigure, 0, 0)[0]
    if (army === undefined) throw new Error('missing army')
    const played = unwrap(
      play(withFigure, itemId, 'Migrants', { column: 0, row: 0 }, { column: 1, row: 0 }, { figureId: army.id }),
    )
    expect(figuresIn(played, 1, 0)).toHaveLength(1)
  })

  it('refuses a destination beyond the card allowance', () => {
    const { state, itemId } = withCardInHand(movementTurn(), 'Migrants')
    const withFigure = place(state, 'figures/redarmy', 2, 2)
    const army = figuresIn(withFigure, 2, 2)[0]
    if (army === undefined) throw new Error('missing army')
    expect(
      unwrapErr(play(withFigure, itemId, 'Migrants', { column: 2, row: 2 }, { column: 2, row: 5 }, { figureId: army.id })).kind,
    ).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('undoes the card move and returns the card', () => {
    const { state, itemId } = withCardInHand(movementTurn(), 'Migrants')
    const withFigure = place(state, 'figures/redarmy', 2, 2)
    const army = figuresIn(withFigure, 2, 2)[0]
    if (army === undefined) throw new Error('missing army')
    const played = unwrap(play(withFigure, itemId, 'Migrants', { column: 2, row: 2 }, { column: 2, row: 4 }, { figureId: army.id }))
    expect(unwrapErr(undoLastBoardChange(played, CASH1981)).kind).toBe('BOARD_UNDO_ASSISTED')

    const record = played.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing record')
    const undone = voted(unwrap(initiateUndo(played, { logId: record.logId, playerId: CASH1981 })), record.logId)
    expect(figuresIn(undone, 2, 2)).toHaveLength(1)
    expect(figuresIn(undone, 2, 4)).toHaveLength(0)
    expect(player(undone).items.some((item) => 'name' in item && item.name === 'Migrants')).toBe(true)
  })
})

  it('refuses the undo when the figure’s movement changed after the card', () => {
    const { state, itemId } = withCardInHand(movementTurn(), 'Migrants')
    const withFigure = place(state, 'figures/redarmy', 2, 2)
    const army = figuresIn(withFigure, 2, 2)[0]
    if (army === undefined) throw new Error('missing army')
    const played = unwrap(play(withFigure, itemId, 'Migrants', { column: 2, row: 2 }, { column: 2, row: 4 }, { figureId: army.id }))
    const changed: GameState = {
      ...played,
      board: {
        ...played.board,
        pieces: played.board.pieces.map((piece) =>
          piece.id === army.id
            ? { ...piece, movement: { turn: 1, used: 0, locked: true, reason: 'galileo' } }
            : piece,
        ),
      },
    }
    const record = changed.assistedActions.at(-1)
    if (record === undefined) throw new Error('missing record')
    const asked = unwrap(initiateUndo(changed, { logId: record.logId, playerId: CASH1981 }))
    let result = null as ReturnType<typeof vote> | null
    let next = asked
    for (const playerId of [KARANDRAS1, ITCHI, CHUL]) {
      result = vote(next, { logId: record.logId, playerId, vote: true, at: AT })
      if (!result.ok) break
      next = result.value
    }
    expect(result?.ok).toBe(false)
    expect(result?.ok === false ? result.error.kind : null).toBe('ASSISTED_UNDO_BLOCKED')
  })

describe('group cards', () => {
  it('moves every chosen player’s figure together and keeps their normal movement', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Lost')
    const withFigures = place(place(state, 'figures/bluearmy', 4, 4, KARANDRAS1), 'figures/bluearmy', 4, 4, KARANDRAS1)
    expect(figuresIn(withFigures, 4, 4)).toHaveLength(2)
    const played = unwrap(
      play(withFigures, itemId, 'Lost', { column: 4, row: 4 }, { column: 4, row: 7 }),
    )
    expect(figuresIn(played, 4, 7)).toHaveLength(2)
    expect(figuresIn(played, 4, 4)).toHaveLength(0)
    for (const figure of figuresIn(played, 4, 7)) expect(figure.movement).toBeUndefined()
  })

  it('refuses a source with figures of two other players, and ignores the acting player’s own figure', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Lost')
    const joint = place(place(state, 'figures/bluearmy', 4, 4, KARANDRAS1), 'figures/greenarmy', 4, 4, ITCHI)
    expect(unwrapErr(play(joint, itemId, 'Lost', { column: 4, row: 4 }, { column: 4, row: 7 })).kind).toBe(
      'ASSISTED_ACTION_REJECTED',
    )

    const mixed = place(place(state, 'figures/redarmy', 4, 4, CASH1981), 'figures/bluearmy', 4, 4, KARANDRAS1)
    const played = unwrap(play(mixed, itemId, 'Lost', { column: 4, row: 4 }, { column: 4, row: 7 }))
    expect(figuresIn(played, 4, 4)).toHaveLength(1)
    expect(figuresIn(played, 4, 4)[0]?.assetId).toBe('figures/redarmy')
    expect(figuresIn(played, 4, 7)).toHaveLength(1)
    expect(figuresIn(played, 4, 7)[0]?.assetId).toBe('figures/bluearmy')
  })

  it('refuses a non-empty destination and a group with a Galileo-locked figure', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Lost')
    const withFigure = place(state, 'figures/bluearmy', 4, 4, KARANDRAS1)
    const blue = figuresIn(withFigure, 4, 4)[0]
    if (blue === undefined) throw new Error('missing blue army')
    const blocked = place(withFigure, 'buildings/temple', 4, 5)
    expect(
      unwrapErr(play(blocked, itemId, 'Lost', { column: 4, row: 4 }, { column: 4, row: 5 })).kind,
    ).toBe('ASSISTED_ACTION_REJECTED')

    const galileoLocked: GameState = {
      ...withFigure,
      board: {
        ...withFigure.board,
        pieces: withFigure.board.pieces.map((piece) =>
          piece.id === blue.id
            ? { ...piece, movement: { turn: 1, used: 0, locked: true, reason: 'galileo' } }
            : piece,
        ),
      },
    }
    expect(
      unwrapErr(play(galileoLocked, itemId, 'Lost', { column: 4, row: 4 }, { column: 4, row: 7 })).kind,
    ).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('does not cross or end on water', () => {
    const { state, itemId } = withCardInHand(cmTurn(), 'Lost')
    // Tile 05 has land at A4 and water at A3.
    const withFigures = place(place(state, 'tiles/tile05', 0, 0), 'figures/bluearmy', 0, 3, KARANDRAS1)
    const refused = unwrapErr(
      play(withFigures, itemId, 'Lost', { column: 0, row: 3 }, { column: 0, row: 2 }),
    )
    expect(refused.kind).toBe('ASSISTED_ACTION_REJECTED')
  })
})
