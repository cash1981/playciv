/**
 * Paying a resource token for an assisted action, and putting it back on an undo.
 *
 * Its own file so the Start of Turn abilities that cost a resource (Ecology) and the
 * cards of `assisted.ts` share one body. Imports only what the registry already
 * imports; nothing here is computed at load time (see the cycle note in `assisted.ts`).
 */

import { removePiece } from './actions/board.js'
import { placeBack, playerOf, withPlayerHand } from './assisted-core.js'
import { areaAt, playerAreas } from './board.js'
import type { EngineError } from './errors.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import type { GameState, Playerhand, SpentResource } from './state.js'

const normalize = (name: string): string => name.trim().toLowerCase()

/**
 * The token a resource would be paid with, without paying it. A hut in the
 * player's hand comes first, then a `resources/<name>` piece whose centre lies
 * in the player's own area. A piece outside every area is nobody's and is never
 * taken. Generic over Incense, Iron, Silk, Wheat and Uranium.
 */
export function findResourceToken(
  state: GameState,
  playerId: string,
  resource: string,
): SpentResource | undefined {
  const player = playerOf(state, playerId)
  if (player === undefined) return undefined

  // Marie Curie: a Uranium spend may use the resource she armed instead.
  const curieSubstitute = resource === 'Uranium' ? player.curieSubstitute ?? undefined : undefined
  const paid = curieSubstitute ?? resource
  const wanted = normalize(paid)
  const hut = player.items.find(
    (item) => item.kind === 'hut' && !item.used && normalize(item.name) === wanted,
  )
  if (hut !== undefined) {
    return {
      kind: 'hut',
      resource: paid,
      itemId: hut.id,
      ...(curieSubstitute === undefined ? {} : { curieSubstitute }),
    }
  }

  const areas = playerAreas(state.board, state.players)
  const piece = state.board.pieces.find(
    (candidate) =>
      candidate.category === 'resource' &&
      candidate.assetId === `resources/${wanted}` &&
      areaAt(areas, candidate.x + candidate.width / 2, candidate.y + candidate.height / 2)
        ?.playerId === playerId,
  )
  return piece === undefined
    ? undefined
    : { kind: 'piece', resource: paid, piece, ...(curieSubstitute === undefined ? {} : { curieSubstitute }) }
}

export interface SpendOutcome {
  readonly state: GameState
  /** Exactly what was spent, so an undo can put the same token back. */
  readonly spent: SpentResource
}

/**
 * Pays one resource token. A hut goes to `discardedItems` (hidden, as
 * `discardItem` leaves it); a piece is removed from the board through the board
 * history, which is "back to stock" because supply is counted from the pieces on
 * the board. `NO_RESOURCE` when the player has neither.
 */
export function spendResource(
  state: GameState,
  playerId: string,
  resource: string,
  at?: string,
): Result<SpendOutcome, 'NO_RESOURCE'> {
  const player = playerOf(state, playerId)
  const token = findResourceToken(state, playerId, resource)
  if (player === undefined || token === undefined) return err('NO_RESOURCE')

  if (token.kind === 'hut') {
    const hut = player.items.find((item) => item.id === token.itemId)
    if (hut === undefined) return err('NO_RESOURCE')
    const next: GameState = {
      ...withPlayerHand(state, {
        ...player,
        items: player.items.filter((item) => item.id !== hut.id),
        ...(token.curieSubstitute === undefined ? {} : { curieSubstitute: null }),
      }),
      discardedItems: [...state.discardedItems, { ...hut, hidden: true }],
    }
    return ok({ state: next, spent: token })
  }

  const removed = removePiece(state, {
    playerId,
    pieceId: token.piece.id,
    ...(at === undefined ? {} : { at }),
  })
  if (!removed.ok) return err('NO_RESOURCE')
  const after = playerOf(removed.value, playerId)
  return ok({
    state:
      token.curieSubstitute === undefined || after === undefined
        ? removed.value
        : withPlayerHand(removed.value, { ...after, curieSubstitute: null }),
    spent: token,
  })
}

/** Puts a spent token back: the hut into the hand, or the piece onto the board where it was. */
export function returnResource(
  state: GameState,
  player: Playerhand,
  spent: SpentResource,
  at: string | null,
): Result<GameState, EngineError> {
  const restoredPlayer =
    spent.curieSubstitute === undefined ? player : { ...player, curieSubstitute: spent.curieSubstitute }
  if (spent.kind === 'hut') {
    const inDiscard = state.discardedItems.find((item) => item.id === spent.itemId)
    const inDeck = state.items.find((item) => item.id === spent.itemId)
    const item = inDiscard ?? inDeck
    if (item === undefined) return err({ kind: 'ITEM_NOT_FOUND', sheetName: 'HUTS' })
    return ok({
      ...withPlayerHand(state, { ...restoredPlayer, items: [...player.items, { ...item, hidden: true }] }),
      discardedItems: state.discardedItems.filter((candidate) => candidate.id !== item.id),
      items: state.items.filter((candidate) => candidate.id !== item.id),
    })
  }
  return ok(placeBack(state, restoredPlayer, spent.piece, at))
}
