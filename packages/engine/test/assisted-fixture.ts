/**
 * Shared set-up for the assisted action tests: a player whose City Management
 * is open with Chivalry revealed, and the two kinds of resource token.
 */

import { placePiece } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { playerAreas } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { itemNumberText } from '../src/log.js'
import { unwrap } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

export const player = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`fixture player ${playerId} missing`)
  return found
}

/** Expected public identity of a particular fixture resource (also works after it was discarded). */
export function resourceText(state: GameState, resource: string, playerId = CASH1981): string {
  const holder = player(state, playerId)
  const item = [...holder.items, ...state.discardedItems].find((candidate) =>
    (candidate.kind === 'hut' || candidate.kind === 'village') && candidate.name === resource && candidate.ownerId === playerId,
  )
  if (item === undefined) throw new Error(`missing ${resource} fixture resource`)
  return `${resource} (${item.kind}) ${itemNumberText(state.logSecret, holder.username, item)}`
}

export const resourcePattern = (state: GameState, resource: string, playerId = CASH1981): string =>
  resourceText(state, resource, playerId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

/** A real village resource, without substituting a same-named hut. */
export function withVillageInHand(
  state: GameState,
  name: string,
  ownerId = CASH1981,
): { readonly state: GameState; readonly itemId: string } {
  const item = state.items.find((candidate) => candidate.kind === 'village' && candidate.name === name)
  if (item === undefined) throw new Error(`no ${name} village in the fixture deck`)
  return {
    itemId: item.id,
    state: {
      ...state,
      items: state.items.filter((candidate) => candidate.id !== item.id),
      players: state.players.map((candidate) => candidate.playerId === ownerId
        ? { ...candidate, items: [...candidate.items, { ...item, hidden: true, ownerId }] }
        : candidate),
    },
  }
}


/**
 * A card of the given printed name (culture event or Great Person), taken from the
 * deck into a player's hand and still hidden, as a drawn card is.
 */
export function withCardInHand(
  state: GameState,
  name: string,
  ownerId = CASH1981,
): { readonly state: GameState; readonly itemId: string } {
  const card = state.items.find(
    (item) => (item.kind === 'greatperson' || item.kind.startsWith('culture')) && 'name' in item && item.name === name,
  )
  if (card === undefined) throw new Error(`no ${name} card in the fixture deck`)
  const inHand = { ...card, hidden: true, ownerId }
  return {
    itemId: card.id,
    state: {
      ...state,
      items: state.items.filter((item) => item.id !== card.id),
      players: state.players.map((candidate) =>
        candidate.playerId === ownerId
          ? { ...candidate, items: [...candidate.items, inHand] }
          : candidate,
      ),
    },
  }
}

/** The start of turn: nothing marked done, so Start of Turn is the open phase. */
export const startOfTurn = (): GameState => firstCivGame()

/** Start of Turn done, Trade open. */
export const tradeTurn = (): GameState =>
  unwrap(markPhasesDone(firstCivGame(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' }))
