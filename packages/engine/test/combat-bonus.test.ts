/**
 * The derived combat bonus (issue #197). There is no old system behind the
 * numbers: each source and value was specified by the human in the issue.
 */

import { describe, expect, it } from 'vitest'

import {
  bringToFront,
  movePiece,
  placePiece,
  redoLastBoardChange,
  removePiece,
  sendToBack,
  setWonderOwner,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { setPlayerGovernment, setPlayerStat } from '../src/actions/player.js'
import { SQUARE_SIZE, findBoardAsset, isInWondersArea, mapTop, wondersArea } from '../src/board.js'
import { combatBonusOf } from '../src/combat-bonus.js'
import type { CivItem } from '../src/item.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

function bonus(state: GameState, playerId = CASH1981): number {
  const player = findPlayer(state, playerId)
  if (player === undefined) throw new Error('no such player')
  return combatBonusOf(state, player)
}

function place(state: GameState, playerId: string, assetId: string, index = 0): GameState {
  return unwrap(placePiece(state, { playerId, assetId, x: 40 + index * 100, y: 300 }))
}

function setMic(state: GameState, value: number): GameState {
  return unwrap(
    setPlayerStat(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, stat: 'mic', value }),
  )
}

function withCiv(state: GameState, playerId: string, name: string): GameState {
  const civilization = { kind: 'civ', name } as unknown as CivItem
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? { ...p, civilization } : p)),
  }
}

describe('combatBonusOf', () => {
  it('is 0 for a player with nothing', () => {
    expect(bonus(firstCivGame())).toBe(0)
  })

  it('counts Barracks and the Shipyard as +2 and an Academy as +4', () => {
    let state = place(firstCivGame(), CASH1981, 'buildings/barracks', 0)
    expect(bonus(state)).toBe(2)
    state = place(state, CASH1981, 'buildings/shipyard', 1)
    expect(bonus(state)).toBe(4)
    state = place(state, CASH1981, 'buildings/academy', 2)
    expect(bonus(state)).toBe(8)
    state = place(state, CASH1981, 'buildings/barracks', 3)
    expect(bonus(state)).toBe(10)
  })

  it('counts a Military dock as +4', () => {
    const state = place(firstCivGame(), CASH1981, 'buildings/militarydock', 0)
    expect(bonus(state)).toBe(4)
  })

  it('ignores buildings that give no bonus, and buildings placed by someone else', () => {
    let state = place(firstCivGame(), CASH1981, 'buildings/library', 0)
    state = place(state, KARANDRAS1, 'buildings/barracks', 1)
    state = place(state, KARANDRAS1, 'buildings/militarydock', 2)
    expect(bonus(state)).toBe(0)
    expect(bonus(state, KARANDRAS1)).toBe(6)
  })

  it('counts each General as +4', () => {
    let state = place(firstCivGame(), CASH1981, 'great people/general', 0)
    expect(bonus(state)).toBe(4)
    state = place(state, CASH1981, 'great people/general', 1)
    expect(bonus(state)).toBe(8)
    expect(bonus(place(state, CASH1981, 'great people/scientist', 2))).toBe(8)
  })

  it.each([
    [0, 0],
    [1, 0],
    [2, 4],
    [3, 4],
    [4, 8],
    [5, 8],
    [6, 12],
    [7, 12],
    [10, 12],
  ])('gives %i MIC investments a bonus of %i, capped at 6 investments', (mic, expected) => {
    expect(bonus(setMic(firstCivGame(), mic))).toBe(expected)
  })

  it('adds 4 under Fundamentalism and nothing under other governments', () => {
    const fundamentalism = unwrap(
      setPlayerGovernment(firstCivGame(), {
        editorPlayerId: CASH1981, targetPlayerId: CASH1981, government: 'Fundamentalism',
      }),
    )
    expect(bonus(fundamentalism)).toBe(4)
    const democracy = unwrap(
      setPlayerGovernment(fundamentalism, {
        editorPlayerId: CASH1981, targetPlayerId: CASH1981, government: 'Democracy',
      }),
    )
    expect(bonus(democracy)).toBe(0)
  })

  it('adds 2 for the French', () => {
    const state = withCiv(firstCivGame(), CASH1981, 'French')
    expect(bonus(state)).toBe(2)
    expect(bonus(withCiv(firstCivGame(), CASH1981, 'Germans'))).toBe(0)
  })

  it('adds 6 for the owner of the Statue of Zeus', () => {
    const state = firstCivGame()
    const area = wondersArea(state.board)
    const placed = unwrap(placePiece(state, {
      playerId: CASH1981, assetId: 'wonders/statueofzeus', x: area.x + 20, y: area.y + 40,
    }))
    const wonder = placed.board.pieces.at(-1)
    if (wonder === undefined) throw new Error('the statue should be on the board')
    expect(isInWondersArea(placed.board, wonder)).toBe(true)
    // Unowned: nobody gets it.
    expect(bonus(placed)).toBe(0)
    const owned = unwrap(setWonderOwner(placed, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: KARANDRAS1,
    }))
    expect(bonus(owned, KARANDRAS1)).toBe(6)
    expect(bonus(owned, CASH1981)).toBe(0)

    const disabled = unwrap(setWonderOwner(owned, {
      playerId: CASH1981, pieceId: wonder.id, ownerId: null,
    }))
    expect(bonus(disabled, KARANDRAS1)).toBe(0)
    expect(disabled.board.pieces.some((piece) => piece.id === wonder.id)).toBe(true)
  })

  it('counts an owned Statue of Zeus that sits outside the Wonders area, as Egypt\'s starting wonder does', () => {
    const placed = unwrap(placePiece(firstCivGame(), {
      playerId: CASH1981, assetId: 'wonders/statueofzeus', x: 40, y: 300, ownerId: CASH1981,
    }))
    const wonder = placed.board.pieces.at(-1)
    if (wonder === undefined) throw new Error('the statue should be on the board')
    expect(isInWondersArea(placed.board, wonder)).toBe(false)
    expect(bonus(placed)).toBe(6)
  })

  it('adds up every source', () => {
    let state = withCiv(firstCivGame(), CASH1981, 'French')
    state = place(state, CASH1981, 'buildings/barracks', 0)
    state = place(state, CASH1981, 'buildings/academy', 1)
    state = place(state, CASH1981, 'great people/general', 2)
    state = setMic(state, 4)
    state = unwrap(
      setPlayerGovernment(state, {
        editorPlayerId: CASH1981, targetPlayerId: CASH1981, government: 'Fundamentalism',
      }),
    )
    // French 2 + Barracks 2 + Academy 4 + General 4 + MIC 8 + Fundamentalism 4
    expect(bonus(state)).toBe(24)
  })
})

/** Cash is Red, Karandras Blue and Itchi Green, so figures can be told apart. */
function colouredGame(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green' }
  const state = firstCivGame()
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })),
  }
}

/** Puts a piece with its centre in map square (column, row), both from 0. */
function put(state: GameState, playerId: string, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(placePiece(state, {
    playerId,
    assetId,
    x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
    y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
  }))
}

describe('city-state 4', () => {
  const CS4 = 'city-states/cs4'

  it('gives +2 to a player with an army or scout of their own colour in its square', () => {
    const base = put(colouredGame(), CASH1981, CS4, 5, 5)
    expect(bonus(base)).toBe(0)
    expect(bonus(put(base, CASH1981, 'figures/redarmy', 5, 5))).toBe(2)
    expect(bonus(put(base, CASH1981, 'figures/redscout', 5, 5))).toBe(2)
  })

  it('counts once however many own figures stand there', () => {
    let state = put(colouredGame(), CASH1981, CS4, 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = put(state, CASH1981, 'figures/redscout', 5, 5)
    expect(bonus(state)).toBe(2)
  })

  it('ignores other city-states and figures in a neighbouring square', () => {
    let state = put(colouredGame(), CASH1981, 'city-states/cs1', 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    expect(bonus(state)).toBe(0)
    state = put(state, CASH1981, CS4, 8, 8)
    state = put(state, CASH1981, 'figures/redarmy', 9, 8)
    expect(bonus(state)).toBe(0)
  })

  it('does not go to a player whose figure is another colour, and does not need the card', () => {
    const state = put(put(colouredGame(), CASH1981, CS4, 5, 5), KARANDRAS1, 'figures/bluearmy', 5, 5)
    expect(bonus(state, KARANDRAS1)).toBe(2)
    expect(bonus(state, CASH1981)).toBe(0)
  })

  /** Moves the last piece with this asset id to the centre of map square (column, row). */
  function moveTo(state: GameState, assetId: string, column: number, row: number): GameState {
    const piece = [...state.board.pieces].reverse().find((candidate) => candidate.assetId === assetId)
    if (piece === undefined) throw new Error(`no ${assetId}`)
    return unwrap(movePiece(state, {
      playerId: CASH1981,
      pieceId: piece.id,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - piece.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - piece.height) / 2,
      snap: false,
    }))
  }

  function fight(): GameState {
    let state = put(colouredGame(), CASH1981, CS4, 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    return put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
  }

  it('goes only to the figure that stood there first when another colour comes in', () => {
    const state = fight()
    expect(bonus(state, CASH1981)).toBe(2)
    expect(bonus(state, KARANDRAS1)).toBe(0)
    // The other way round: Blue was first.
    let blueFirst = put(colouredGame(), CASH1981, CS4, 5, 5)
    blueFirst = put(blueFirst, KARANDRAS1, 'figures/bluearmy', 5, 5)
    blueFirst = put(blueFirst, CASH1981, 'figures/redarmy', 5, 5)
    expect(bonus(blueFirst, CASH1981)).toBe(0)
    expect(bonus(blueFirst, KARANDRAS1)).toBe(2)
  })

  it('does not depend on the stacking order: bring to front, send to back and a nudge change nothing', () => {
    const state = fight()
    const red = state.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    const blue = state.board.pieces.find((piece) => piece.assetId === 'figures/bluearmy')
    if (red === undefined || blue === undefined) throw new Error('no armies')
    const indexOf = (s: GameState, id: string): number => s.board.pieces.findIndex((piece) => piece.id === id)
    const check = (s: GameState): void => {
      // Red, the first arrival, is above Blue in the stack, and still holds it.
      expect(indexOf(s, red.id)).toBeGreaterThan(indexOf(s, blue.id))
      expect(bonus(s, CASH1981)).toBe(2)
      expect(bonus(s, KARANDRAS1)).toBe(0)
    }
    check(unwrap(bringToFront(state, { playerId: CASH1981, pieceId: red.id })))
    check(unwrap(sendToBack(state, { playerId: KARANDRAS1, pieceId: blue.id })))
    // A nudge inside the same square puts Red on top too.
    check(moveTo(state, 'figures/redarmy', 5, 5))
  })

  it('passes to the figure left standing when the holder is killed', () => {
    const state = fight()
    const red = state.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    if (red === undefined) throw new Error('no red army')
    const after = unwrap(removePiece(state, { playerId: CASH1981, pieceId: red.id }))
    expect(bonus(after, CASH1981)).toBe(0)
    expect(bonus(after, KARANDRAS1)).toBe(2)
    // An undo gives it back to Red.
    const undone = unwrap(undoLastBoardChange(after, CASH1981))
    expect(bonus(undone, CASH1981)).toBe(2)
    expect(bonus(undone, KARANDRAS1)).toBe(0)
  })

  it('stays with the holder while one of their figures remains', () => {
    let state = put(colouredGame(), CASH1981, CS4, 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = put(state, CASH1981, 'figures/redscout', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    state = moveTo(state, 'figures/redarmy', 1, 1)
    expect(bonus(state, CASH1981)).toBe(2)
    expect(bonus(state, KARANDRAS1)).toBe(0)
  })

  it('goes to the figure left standing when the holder leaves, and does not come back with them', () => {
    let state = fight()
    state = moveTo(state, 'figures/redarmy', 1, 1)
    expect(bonus(state, CASH1981)).toBe(0)
    expect(bonus(state, KARANDRAS1)).toBe(2)
    // Red returns, but Blue has stood there since Red left.
    state = moveTo(state, 'figures/redarmy', 5, 5)
    expect(bonus(state, CASH1981)).toBe(0)
    expect(bonus(state, KARANDRAS1)).toBe(2)
  })

  it('goes to nobody once the square is empty, and the next to arrive gets it', () => {
    let state = put(colouredGame(), CASH1981, CS4, 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = moveTo(state, 'figures/redarmy', 1, 1)
    expect(bonus(state, CASH1981)).toBe(0)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    state = moveTo(state, 'figures/redarmy', 5, 5)
    expect(bonus(state, KARANDRAS1)).toBe(2)
    expect(bonus(state, CASH1981)).toBe(0)
  })

  it('goes to the colour that has stood there longest without a break, not the one with the oldest figure', () => {
    let state = put(colouredGame(), CASH1981, CS4, 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluescout', 5, 5)
    state = put(state, ITCHI, 'figures/greenarmy', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    const blueScout = state.board.pieces.find((piece) => piece.assetId === 'figures/bluescout')
    const red = state.board.pieces.find((piece) => piece.assetId === 'figures/redarmy')
    if (blueScout === undefined || red === undefined) throw new Error('no figures')
    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: blueScout.id }))
    state = unwrap(removePiece(state, { playerId: CASH1981, pieceId: red.id }))
    expect(bonus(state, KARANDRAS1)).toBe(2)
    expect(bonus(state, ITCHI)).toBe(0)
  })

  it('starts over when the city-state itself is moved, and follows redo', () => {
    let state = put(colouredGame(), CASH1981, CS4, 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 8)
    // Moved onto Blue, which is the only one there, and away from Red.
    state = moveTo(state, CS4, 8, 8)
    expect(bonus(state, KARANDRAS1)).toBe(2)
    expect(bonus(state, CASH1981)).toBe(0)
    const undone = unwrap(undoLastBoardChange(state, CASH1981))
    expect(bonus(undone, CASH1981)).toBe(2)
    expect(bonus(undone, KARANDRAS1)).toBe(0)
    const redone = unwrap(redoLastBoardChange(undone, CASH1981))
    expect(bonus(redone, KARANDRAS1)).toBe(2)
    expect(bonus(redone, CASH1981)).toBe(0)
  })

  it('looks at every city-state 4, so stacking cannot hide the one with a figure on it', () => {
    let state = put(colouredGame(), CASH1981, CS4, 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = put(state, CASH1981, CS4, 8, 8)
    expect(bonus(state)).toBe(2)
    // Nudging the first one puts it on top of the stack; the second one used to take over.
    const first = state.board.pieces.find((piece) => piece.assetId === CS4)
    if (first === undefined) throw new Error('no city-state')
    const nudged = unwrap(movePiece(state, {
      playerId: CASH1981, pieceId: first.id, x: first.x + 1, y: first.y, snap: false,
    }))
    expect(bonus(nudged)).toBe(2)
  })

  it.each([
    ['army', 'Russians'],
    ['scout', 'Spanish'],
  ])('counts the white %s for the %s player only', (figure, civ) => {
    const state = put(put(withCiv(colouredGame(), CASH1981, civ), CASH1981, CS4, 5, 5), CASH1981, `figures/white${figure}`, 5, 5)
    expect(bonus(state, CASH1981)).toBe(2)
    expect(bonus(state, KARANDRAS1)).toBe(0)
  })

  it('gives nothing to a player without a colour', () => {
    const state = put(put(colouredGame(), CASH1981, CS4, 5, 5), CASH1981, 'figures/redarmy', 5, 5)
    const colourless = {
      ...state,
      players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, color: null } : p)),
    }
    expect(bonus(colourless, CASH1981)).toBe(0)
  })

  it('adds to the other sources and shows in the projection', () => {
    let state = place(colouredGame(), CASH1981, 'buildings/barracks', 0)
    state = put(state, CASH1981, CS4, 5, 5)
    state = put(state, CASH1981, 'figures/redscout', 5, 5)
    expect(bonus(state)).toBe(4)
    expect(toPlayerView(state, CASH1981).you?.stats.combat).toBe(4)
    expect(toPlayerView(state, KARANDRAS1).opponents.find((p) => p.playerId === CASH1981)?.stats.combat).toBe(4)
  })
})

describe('combat in the projections', () => {
  it('shows the derived value to the owner and to opponents, and ignores a stored value', () => {
    const base = place(firstCivGame(), CASH1981, 'buildings/academy', 0)
    const stored = {
      ...base,
      players: base.players.map((p) =>
        p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, combat: 99 } } : p,
      ),
    }

    const own = toPlayerView(stored, CASH1981)
    expect(own.you?.stats.combat).toBe(4)

    const seen = toPlayerView(stored, KARANDRAS1)
    expect(seen.opponents.find((p) => p.playerId === CASH1981)?.stats.combat).toBe(4)
  })

  it('recalculates when a building is removed from the board', () => {
    const state = place(firstCivGame(), CASH1981, 'buildings/barracks', 0)
    expect(toPlayerView(state, CASH1981).you?.stats.combat).toBe(2)
    const without = { ...state, board: { ...state.board, pieces: [] } }
    expect(toPlayerView(without, CASH1981).you?.stats.combat).toBe(0)
  })
})

