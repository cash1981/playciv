/**
 * A figure ends its move on a hut or village (issue #364): the token leaves the square for the player's
 * area and the card it gives goes into the hand.
 *
 * The player confirms first (the web asks), and the move is the ordinary `travelFigure`. The board then
 * holds two entries, in this order: the figure's move and the token's. The first board Undo puts the token
 * back and returns the card (`tokenCollections`), the second takes the move back, as the exploration does.
 * Flight cannot end on a hut or village, so it never collects one.
 *
 * An army that ends on a relic and is confirmed takes the marker off the board instead (`takeRelic`).
 */

import { performAssistedAction } from '../assisted.js'
import { IMMEDIATE_RELIC_CLAIMS } from '../assisted-relics.js'
import { mapCellOf } from '../blockade.js'
import { areaSlotRegion, boardAreas, nextFreeSlot } from '../board.js'
import { squareLabel } from '../build-options.js'
import type { EngineError } from '../errors.js'
import type { Result } from '../result.js'
import { ok } from '../result.js'
import type { GameState, TokenCollection } from '../state.js'
import { findPlayer, withPlayer } from '../state.js'
import { appendPublicLog } from '../log.js'
import { occupancyOf } from '../movement.js'
import { mapTokensOf } from '../zheng-he.js'
import { movePieceUnchecked, removePiece, travelFigure } from './board.js'
import type { TravelFigureInput } from './board.js'
import { draw } from './draw.js'

/** The Chinese gain this much culture each time a figure collects a hut. */
const CHINESE = 'Chinese'
const CHINESE_HUT_CULTURE = 3

export interface TravelCollectingInput extends TravelFigureInput {
  /** The player agreed to draw the hut or village the figure ends on. Without it the token stays where it is. */
  readonly collectToken?: boolean
}

/** What the owner gains by removing a relic marker (Fame and Fortune p. 9, Wisdom and Warfare). */
const RELIC_GAINS: Readonly<Record<string, string>> = {
  'relics/atlantis': 'a free tech of their choice from the Start of Turn tab',
  'relics/school_of_confucius': 'Great Persons',
  'relics/seven_cities_of_gold': 'two investment markers for free from the Start of Turn tab',
  'relics/ark_of_the_covenant': 'two free culture track advances',
  'relics/attilas_village': 'two free units they have unlocked',
}

/** Another player's figures on the square: a battle comes first, so nothing is collected or taken until it is settled. */
function contested(state: GameState, input: TravelCollectingInput): boolean {
  const player = findPlayer(state, input.playerId)
  return player !== undefined && occupancyOf(state.board, player).foreign.has(`${input.column},${input.row}`)
}

/** The relic marker on the map square an army moves to, or `undefined` for a scout or a square without one. */
function relicForArmyAt(state: GameState, input: TravelCollectingInput) {
  const mover = state.board.pieces.find((piece) => piece.id === input.pieceId)
  if (mover === undefined || !mover.assetId.endsWith('army')) return undefined
  return state.board.pieces.find((piece) => {
    const cell = piece.category === 'relic' ? mapCellOf(state.board, piece) : null
    return cell !== null && cell.column === input.column && cell.row === input.row
  })
}

export function travelFigureCollecting(state: GameState, input: TravelCollectingInput): Result<GameState, EngineError> {
  const collecting = input.collectToken === true && input.disband !== true && !contested(state, input)
  const relic = collecting ? relicForArmyAt(state, input) : undefined
  const travelled = travelFigure(state, relic === undefined ? input : { ...input, endsMove: true })
  if (relic !== undefined) return travelled.ok ? takeRelic(travelled.value, input, relic.id) : travelled
  if (!travelled.ok || !collecting) return travelled
  const moved = travelled.value
  const player = findPlayer(moved, input.playerId)
  const token = mapTokensOf(moved.board).find(
    (candidate) => candidate.cell.column === input.column && candidate.cell.row === input.row,
  )
  if (player === undefined || token === undefined) return travelled
  const area = boardAreas(moved.board, moved.players).find((candidate) => candidate.playerId === input.playerId)
  if (area === undefined) return travelled

  const under = (moved.underTokens ?? []).find((candidate) => candidate.pieceId === token.piece.id) ?? null
  const held = new Set(player.items.map((item) => item.id))
  const drawn = draw(moved, {
    playerId: input.playerId,
    sheetName: token.sheet,
    fromPieceId: token.piece.id,
    confirmedOutOfTurn: true,
  })
  // No hut or village left in the deck: the move stands and the token stays on its square
  if (!drawn.ok) return travelled
  const card = findPlayer(drawn.value, input.playerId)?.items.find((item) => !held.has(item.id))
  if (card === undefined) return travelled

  // A full area still takes the token, at the area's first slot: it must leave the map either way
  const region = areaSlotRegion(area)
  const [x, y] = nextFreeSlot(drawn.value.board, area, drawn.value.board.pieces, { x: region.x, y: region.y })
  const placed = movePieceUnchecked(drawn.value, {
    playerId: input.playerId,
    pieceId: token.piece.id,
    x,
    y,
    snap: false,
    ...(input.at === undefined ? {} : { at: input.at }),
  })
  // The draw's own log line cannot be voted back on its own: the board Undo returns the token and the card together
  const sealed =
    placed === undefined
      ? undefined
      : { ...placed, log: placed.log.map((line) => (line.item?.id === card.id && line.logType === 'ITEM' ? { ...line, undo: null, superseded: true } : line)) }
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || sealed === undefined || entry === undefined) return travelled
  // The Chinese gain 3 culture for a hut (civilization card); a village is not a hut, and a relic is handled above
  const culture = token.sheet === 'HUTS' && player.civilization?.name === CHINESE ? CHINESE_HUT_CULTURE : 0
  const collection: TokenCollection = {
    ...(culture === 0 ? {} : { culture }),
    historyId: entry.id,
    playerId: input.playerId,
    pieceId: token.piece.id,
    itemId: card.id,
    under,
    square: squareLabel(token.cell),
  }
  const holder = findPlayer(sealed, input.playerId)
  const gained =
    culture === 0 || holder === undefined
      ? sealed
      : appendPublicLog(
          withPlayer(sealed, { ...holder, stats: { ...holder.stats, culture: holder.stats.culture + culture } }),
          holder.username,
          holder.playerId,
          `gained ${culture} (${holder.stats.culture + culture}) culture from the hut on ${collection.square} as the Chinese`,
        )
  return ok({ ...gained, tokenCollections: [...(gained.tokenCollections ?? []), collection] })
}

/**
 * An army ended its move on a relic: the marker leaves the board as the next history entry, credited to the
 * player (`relicTakenBlock` reads that), so the first board Undo puts it back. Atlantis and the Seven Cities of
 * Gold are claimed from the Start of Turn tab; the others are claimed from a button in any tab, and the one that
 * needs no choice (the Ark's first advance, the School of Confucius) is claimed here, at once. A claim that is
 * stopped, a hand over its size say, leaves its button with the reason.
 */
function takeRelic(moved: GameState, input: TravelCollectingInput, relicId: string): Result<GameState, EngineError> {
  const relic = moved.board.pieces.find((piece) => piece.id === relicId)
  const player = findPlayer(moved, input.playerId)
  if (relic === undefined || player === undefined) return ok(moved)
  const removed = removePiece(moved, { playerId: input.playerId, pieceId: relicId, ...(input.at === undefined ? {} : { at: input.at }) })
  if (!removed.ok) return ok(moved)
  const gain = RELIC_GAINS[relic.assetId]
  const said = `took the ${relic.label} relic on ${squareLabel({ column: input.column, row: input.row })}` + (gain === undefined ? '' : `, gaining ${gain}`)
  const logged = appendPublicLog(removed.value, player.username, player.playerId, said)
  const claim = IMMEDIATE_RELIC_CLAIMS[relic.assetId]
  const takenAt = removed.value.board.history.at(-1)?.id
  if (claim === undefined || takenAt === undefined) return ok(logged)
  const claimed = performAssistedAction(logged, {
    playerId: input.playerId,
    action: claim,
    requestId: `relic:${takenAt}`,
    ...(input.at === undefined ? {} : { at: input.at }),
  })
  return ok(claimed.ok ? claimed.value : logged)
}
