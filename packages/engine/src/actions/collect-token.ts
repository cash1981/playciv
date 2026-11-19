/**
 * A figure (or a Zulu city) takes a hut or village token off the map: the token goes to the player's area and the card
 * it gives is drawn into the hand. Shared by the figure's move (`travelFigureCollecting`) and by the Zulu cities.
 */

import { countLinesIn } from '../assisted-culture.js'
import { areaSlotRegion, boardAreas, nextFreeSlot } from '../board.js'
import { squareLabel } from '../build-options.js'
import type { GameState, TokenCollection } from '../state.js'
import { findPlayer, withPlayer } from '../state.js'
import { appendPublicLog } from '../log.js'
import type { MapToken } from '../zheng-he.js'
import { movePieceUnchecked } from './board.js'
import { draw } from './draw.js'

/** The Chinese gain this much culture each time a figure collects a hut. */
const CHINESE = 'Chinese'
const CHINESE_HUT_CULTURE = 3

/**
 * Collects the token for the player. `culture` says whether the Chinese hut culture applies: a Zulu city never gives it,
 * only a Chinese figure does. `undefined` when it cannot be done (no card left in the deck, no area): nothing is changed.
 */
export function collectMapToken(
  moved: GameState,
  playerId: string,
  token: MapToken,
  options: { readonly at?: string | undefined; readonly chineseCulture: boolean },
): GameState | undefined {
  const player = findPlayer(moved, playerId)
  if (player === undefined) return undefined
  const area = boardAreas(moved.board, moved.players).find((candidate) => candidate.playerId === playerId)
  if (area === undefined) return undefined

  const under = (moved.underTokens ?? []).find((candidate) => candidate.pieceId === token.piece.id) ?? null
  const held = new Set(player.items.map((item) => item.id))
  const drawn = draw(moved, {
    playerId,
    sheetName: token.sheet,
    fromPieceId: token.piece.id,
    confirmedOutOfTurn: true,
  })
  // No hut or village left in the deck: the move stands and the token stays on its square
  if (!drawn.ok) return undefined
  const card = findPlayer(drawn.value, playerId)?.items.find((item) => !held.has(item.id))
  if (card === undefined) return undefined

  // A full area still takes the token, at the area's first slot: it must leave the map either way
  const region = areaSlotRegion(area)
  const [x, y] = nextFreeSlot(drawn.value.board, area, drawn.value.board.pieces, { x: region.x, y: region.y })
  const placed = movePieceUnchecked(drawn.value, {
    playerId,
    pieceId: token.piece.id,
    x,
    y,
    snap: false,
    ...(options.at === undefined ? {} : { at: options.at }),
  })
  // The draw's own log line cannot be voted back on its own: the board Undo returns the token and the card together
  const sealed =
    placed === undefined
      ? undefined
      : { ...placed, log: placed.log.map((line) => (line.item?.id === card.id && line.logType === 'ITEM' ? { ...line, undo: null, superseded: true } : line)) }
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || sealed === undefined || entry === undefined) return undefined
  // The Chinese gain 3 culture for a hut (civilization card); a village is not a hut, and a relic is handled above
  const culture = options.chineseCulture && token.sheet === 'HUTS' && player.civilization?.name === CHINESE ? CHINESE_HUT_CULTURE : 0
  const collection: TokenCollection = {
    ...(culture === 0 ? {} : { culture }),
    historyId: entry.id,
    playerId,
    pieceId: token.piece.id,
    itemId: card.id,
    under,
    square: squareLabel(token.cell),
  }
  const holder = findPlayer(sealed, playerId)
  const written =
    culture === 0 || holder === undefined
      ? sealed
      : appendPublicLog(
          withPlayer(sealed, { ...holder, stats: { ...holder.stats, culture: holder.stats.culture + culture } }),
          holder.username,
          holder.playerId,
          `gained ${culture} (${holder.stats.culture + culture}) culture from the hut on ${collection.square} as the Chinese`,
        )
  // The line was written after the token's board entry: count it in, as the culture advance does
  const gained = culture === 0 ? written : countLinesIn(written, [entry.id])
  return { ...gained, tokenCollections: [...(gained.tokenCollections ?? []), collection] }
}
