/**
 * Hut, village and relic markers on the map tiles (issue #364).
 *
 * The icons are printed on the tile images and recorded in `data/tile-icons.json`. A tile laid on a
 * map slot gets one `resources/hut`, `resources/village` or `relics/…` piece on each of those squares,
 * once. The markers turn with the tile, so they stay on the same printed squares.
 *
 * Seeding writes one board history entry per marker after the tile's own entry, so the board Undo takes
 * the markers off first and the tile after them.
 */

import { findBoardAsset, findPiece, nearestSlotOrigin } from '../board.js'
import type { Board, BoardPiece, Rotation } from '../board.js'
import { appendPublicLog } from '../log.js'
import type { HutItem, VillageItem } from '../item.js'
import type { GameState, TokenCollection } from '../state.js'
import { findPlayer, withPlayer } from '../state.js'
import { displayedSquare, printedSquare, tileSquareAt } from '../terrain.js'
import { tileTokenSquares } from '../tile-icons.js'
import { placeUnchecked } from './board.js'

export const TOKEN_ASSET_IDS: Readonly<Record<'hut' | 'village', string>> = {
  hut: 'resources/hut',
  village: 'resources/village',
}

const isTokenPiece = (piece: BoardPiece): boolean =>
  piece.assetId === TOKEN_ASSET_IDS.hut || piece.assetId === TOKEN_ASSET_IDS.village || piece.category === 'relic'

/** Whether the tile sits exactly on a map slot, as a laid tile does. */
export function tileOnMap(board: Board, tile: BoardPiece): boolean {
  const origin = nearestSlotOrigin(board, tile.x, tile.y)
  return origin !== undefined && origin[0] === tile.x && origin[1] === tile.y
}

/** Whether a token was ever put on this tile and the placement is still in the history (an undone one is not). */
export function tileTokensSeeded(board: Board, tileId: string): boolean {
  return board.history.some((entry) => entry.change.kind === 'place' && entry.change.piece.tileId === tileId)
}

/**
 * Puts a hut or village on every square of the tile that shows one. Nothing happens when the tile is
 * not an exploration tile on a map slot, has no such icon or has been given its tokens before.
 */
export function seedTileTokens(state: GameState, tileId: string, playerId: string, at?: string): GameState {
  const tile = findPiece(state.board, tileId)
  if (tile === undefined || tile.category !== 'tile') return state
  const squares = tileTokenSquares(tile.assetId)
  if (squares.length === 0 || !tileOnMap(state.board, tile) || tileTokensSeeded(state.board, tile.id)) return state

  const size = state.board.squareSize
  let current = state
  for (const square of squares) {
    const asset = findBoardAsset(square.assetId)
    if (asset === undefined) continue
    // A relic exists once: one already on the map (placed by hand) is not laid again
    if (asset.category === 'relic' && current.board.pieces.some((piece) => piece.assetId === asset.id)) continue
    const [row, column] = displayedSquare(square.row, square.column, tile.rotation)
    const placed = placeUnchecked(current, {
      playerId,
      assetId: asset.id,
      x: Math.round(tile.x + column * size + (size - asset.width) / 2),
      y: Math.round(tile.y + row * size + (size - asset.height) / 2),
      tileId: tile.id,
      ...(at === undefined ? {} : { at }),
    })
    if (placed !== undefined) current = placed
  }
  return current
}

/** The hut and village pieces lying on a map tile, with the printed square each covers. */
function tokensOnTile(
  board: Board,
  tile: BoardPiece,
  collected: ReadonlySet<string>,
): readonly { readonly piece: BoardPiece; readonly row: number; readonly column: number }[] {
  const found: { piece: BoardPiece; row: number; column: number }[] = []
  const printed = tileTokenSquares(tile.assetId)
  for (const piece of board.pieces) {
    if (!isTokenPiece(piece)) continue
    const centreX = piece.x + piece.width / 2
    const centreY = piece.y + piece.height / 2
    if (centreX < tile.x || centreX >= tile.x + tile.width || centreY < tile.y || centreY >= tile.y + tile.height) continue
    const displayedRow = Math.floor((centreY - tile.y) / board.squareSize)
    const displayedColumn = Math.floor((centreX - tile.x) / board.squareSize)
    const [row, column] = printedSquare(displayedRow, displayedColumn, tile.rotation)
    // On the map the topmost tile under the token is the one it belongs to
    const under = tileSquareAt(board, centreX, centreY)
    if (under !== null) {
      if (under.assetId === tile.assetId) found.push({ piece, row, column })
      continue
    }
    // Off the map the footprint can cover other pieces of an area (a token already collected, a loose one):
    // only a token this tile was given, still centred on its printed square, goes with it
    const centred =
      Math.abs(centreX - (tile.x + (displayedColumn + 0.5) * board.squareSize)) <= 1 &&
      Math.abs(centreY - (tile.y + (displayedRow + 0.5) * board.squareSize)) <= 1
    if (
      piece.tileId === tile.id &&
      centred &&
      !collected.has(piece.id) &&
      printed.some((square) => square.row === row && square.column === column && square.assetId === piece.assetId)
    ) {
      found.push({ piece, row, column })
    }
  }
  return found
}

const NONE: ReadonlySet<string> = new Set()

type TokenShift = { readonly pieceId: string; readonly from: { readonly x: number; readonly y: number }; readonly to: { readonly x: number; readonly y: number } }

/**
 * Where the hut and village pieces lying on a tile go when it is turned to `rotation`: the printed square
 * under each stays the same, and the piece is centred on its new square.
 */
export function turnedTileTokens(board: Board, tile: BoardPiece, rotation: Rotation, collected: ReadonlySet<string> = NONE): readonly TokenShift[] {
  const size = board.squareSize
  return tokensOnTile(board, tile, collected).map(({ piece, row, column }) => {
    const [displayedRow, displayedColumn] = displayedSquare(row, column, rotation)
    return {
      pieceId: piece.id,
      from: { x: piece.x, y: piece.y },
      to: {
        x: Math.round(tile.x + displayedColumn * size + (size - piece.width) / 2),
        y: Math.round(tile.y + displayedRow * size + (size - piece.height) / 2),
      },
    }
  })
}

/** The hut and village pieces on a tile, moved by the same step as the tile when it goes to (x, y). */
export function carriedTileTokens(board: Board, tile: BoardPiece, x: number, y: number, collected: ReadonlySet<string> = NONE): readonly TokenShift[] {
  if (tile.category !== 'tile') return []
  return tokensOnTile(board, tile, collected).map(({ piece }) => ({
    pieceId: piece.id,
    from: { x: piece.x, y: piece.y },
    to: { x: piece.x + (x - tile.x), y: piece.y + (y - tile.y) },
  }))
}

/**
 * The state part of taking a collected token back: the card leaves the hand and is bound back under the piece
 * (what Zheng He had seen there, or the card the player drew), and a public line says so. The pieces are
 * the caller's. `undefined` when the card is no longer in that player's hand.
 */
export function returnCollectedCard(state: GameState, collection: TokenCollection): GameState | undefined {
  const player = findPlayer(state, collection.playerId)
  const card = player?.items.find((item) => item.id === collection.itemId)
  if (player === undefined || card === undefined) return undefined
  const culture = collection.culture ?? 0
  // The culture a hut gave the Chinese goes back with it, as far as it is still there: what they have spent since stays
  // spent, like the Aztec and Arab gains, so the card and the token can always be returned
  const tookBack = Math.min(player.stats.culture, culture)
  const withoutCard = withPlayer(state, {
    ...player,
    items: player.items.filter((item) => item !== card),
    stats: { ...player.stats, culture: player.stats.culture - tookBack },
  })
  const rest = (withoutCard.tokenCollections ?? []).filter((other) => other !== collection)
  // The card stays with its token, so what the player saw is not the next card anyone draws (issue #364)
  const bound = collection.under ?? { pieceId: collection.pieceId, item: card as HutItem | VillageItem, square: collection.square }
  const back: GameState = {
    ...withoutCard,
    underTokens: [...(withoutCard.underTokens ?? []), { ...bound, item: { ...bound.item, hidden: true, ownerId: null } }],
    tokenCollections: rest,
    // The draw's own line can no longer be voted back: the card is not in the hand
    log: withoutCard.log.map((entry) => (entry.item?.id === collection.itemId && entry.logType === 'ITEM' ? { ...entry, undo: null, superseded: true } : entry)),
  }
  return appendPublicLog(back, player.username, player.playerId, `put the ${card.kind === 'village' ? 'village' : 'hut'} token on ${collection.square} back and returned its card${culture > 0 ? `, and took back ${tookBack === culture ? tookBack : `${tookBack} of ${culture}`} (${player.stats.culture - tookBack}) culture` : ''}`)
}

/** The pieces of hut and village tokens a figure collected: they belong to a player's area now, not to a tile. */
export const collectedTokenIds = (state: GameState): ReadonlySet<string> =>
  new Set((state.tokenCollections ?? []).map((collection) => collection.pieceId))
