/**
 * Shared set-up for the assisted action tests: a player whose City Management
 * is open with Chivalry revealed, and the two kinds of resource token.
 */

import { placePiece } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { playerAreas } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { unwrap } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

export const player = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`fixture player ${playerId} missing`)
  return found
}

/** Chivalry chosen and revealed, Start of Turn and Trade done, so City Management is open. */
export function chivalryTurn(techName = 'Chivalry'): GameState {
  let state = firstCivGame()
  state = unwrap(chooseTech(state, { playerId: CASH1981, techName }))
  state = unwrap(revealTech(state, { playerId: CASH1981, techName }))
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
}

/** Puts a resource piece inside one player's own area, where the player would drop it. */
export function withPieceInArea(
  state: GameState,
  assetId: string,
  ownerId = CASH1981,
): { readonly state: GameState; readonly piece: BoardPiece } {
  const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === ownerId)
  if (area === undefined) throw new Error('fixture area missing')
  const placed = unwrap(
    placePiece(state, { playerId: ownerId, assetId, x: area.x + 20, y: area.y + 80 }),
  )
  const piece = placed.board.pieces.at(-1)
  if (piece === undefined || piece.assetId !== assetId) throw new Error('piece was not placed')
  return { state: placed, piece }
}

/** A hut of the given name, taken from the deck into a player's hand. */
export function withHutInHand(
  state: GameState,
  name: string,
  ownerId = CASH1981,
): { readonly state: GameState; readonly hutId: string } {
  const hut = state.items.find((item) => item.kind === 'hut' && item.name === name)
  if (hut === undefined) throw new Error(`no ${name} hut in the fixture deck`)
  const inHand = { ...hut, hidden: true, ownerId }
  return {
    hutId: hut.id,
    state: {
      ...state,
      items: state.items.filter((item) => item.id !== hut.id),
      players: state.players.map((candidate) =>
        candidate.playerId === ownerId
          ? { ...candidate, items: [...candidate.items, inHand] }
          : candidate,
      ),
    },
  }
}

