/**
 * The passive and triggered Great Person effects that the game derives from a
 * revealed card, rather than applying when a card is played.
 *
 * A Great Person card is active only while it is faceup in its owner's hand and
 * at least one token of its type is on the map and not blockaded (FAQ 2.0). The
 * helpers here are the single place that decides that, so a new passive effect
 * cannot disagree with the card-play and Start of Turn checks.
 */

import { blockadedGreatPersonTypes, cityFootprintsOf, GREAT_PERSON_CARD_TYPES, mapCellOf } from './blockade.js'
import { findBoardAsset, remainingBoardAssetCount } from './board.js'
import type { GreatPersonItem, Item } from './item.js'
import type { GameState, Playerhand } from './state.js'

/** Whether `name` is a revealed Great Person whose type is not fully blockaded. */
export function activeGreatPerson(
  state: GameState,
  player: Playerhand,
  name: string,
): boolean {
  const card = player.items.find(
    (item): item is GreatPersonItem => item.kind === 'greatperson' && item.name === name,
  )
  if (card === undefined || card.hidden) return false
  return card.type === null || !blockadedGreatPersonTypes(state, player).includes(card.type)
}

/**
 * Louis Pasteur: "Your stacking limit is increased by 1." The manual stacking
 * number stays the player's bookkeeping; Build uses this effective value.
 */
export function stackingLimitOf(state: GameState, player: Playerhand): number {
  return player.stats.stacking + (activeGreatPerson(state, player, 'Louis Pasteur') ? 1 : 0)
}

/** The techs another player has revealed, for Thomas Edison's free research. */
export function revealedTechNamesOfOthers(state: GameState, playerId: string): readonly string[] {
  const names = new Set<string>()
  for (const candidate of state.players) {
    if (candidate.playerId === playerId) continue
    for (const tech of candidate.techsChosen) {
      if (!tech.hidden) names.add(tech.name)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}


/** The Great Person marker a card takes, by its type, or `undefined` for another card. */
export function greatPersonMarkerAssetId(item: Item): string | undefined {
  if (item.kind !== 'greatperson') return undefined
  return GREAT_PERSON_CARD_TYPES.find(([, cardType]) => cardType === item.type)?.[0]
}

/** How many markers of one kind are still in the supply. The box holds 3. */
export function greatPersonMarkersLeft(state: GameState, assetId: string): number {
  const asset = findBoardAsset(assetId)
  return asset === undefined ? 0 : (remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers) ?? 0)
}

/** "scientist" or "merchant": the marker's artwork label, as the public lines name it. */
export function greatPersonMarkerLabel(assetId: string): string {
  return (findBoardAsset(assetId)?.label ?? 'Great Person').toLowerCase()
}

/** True while at least one Great Person marker type still has a piece in the supply. */
export function anyGreatPersonMarkerLeft(state: GameState): boolean {
  return GREAT_PERSON_CARD_TYPES.some(([assetId]) => greatPersonMarkersLeft(state, assetId) > 0)
}

/** A Great Person card is valid while the marker of its type is in the supply. */
export function hasGreatPersonMarkerLeft(state: GameState, item: Item): boolean {
  const assetId = greatPersonMarkerAssetId(item)
  return assetId !== undefined && greatPersonMarkersLeft(state, assetId) > 0
}

/**
 * Frank Lloyd Wright: the buildings in the player's cities, that is on a map square in
 * the outskirts of one of their own cities. Ownership is the city, never `placedBy`, as
 * `upgradablePiecesOf` reads it: a building outside every outskirts, off the map or in
 * another player's city does not count.
 */
export function buildingsInCitiesOf(state: GameState, player: Playerhand): number {
  if (player.color === null) return 0
  const outskirts = new Set(
    cityFootprintsOf(state, player.color.toLowerCase()).flatMap((footprint) =>
      footprint.outskirts.map((cell) => `${cell.column},${cell.row}`),
    ),
  )
  if (outskirts.size === 0) return 0
  return state.board.pieces.filter((piece) => {
    if (piece.category !== 'building') return false
    const cell = mapCellOf(state.board, piece)
    return cell !== null && outskirts.has(`${cell.column},${cell.row}`)
  }).length
}
