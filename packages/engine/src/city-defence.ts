/**
 * The combat bonus of a defended city (base rules p. 23; Fame and Fortune p. 7
 * and p. 9), derived from the board like the rest of the combat bonus.
 *
 * A battle has no square of its own. The human ruled that a battle is for a
 * city when one of the attacker's armies stands on a centre square of one of the
 * defender's cities: the attacker moved into it. The defender then adds:
 *
 * - +6 for a city, or +12 for a capital; a metropolis is the capital (#319),
 * - +4 when the city is walled (stacks with either),
 * - +2 for a metropolis (F&F p. 9),
 * - +2 for a fortification marker on the city centre (F&F p. 7).
 */

import type { Battle } from './battle.js'
import { mapCellOf } from './blockade.js'
import type { BoardPiece } from './board.js'
import { FORTIFICATION_ASSET_ID, FORTIFICATION_BONUS, cityCentredAt, cityLabelOf, cityMarkerOf, figureKindOf } from './disband.js'
import { figureBelongsTo } from './movement.js'
import type { GameState } from './state.js'
import { findPlayer } from './state.js'

const CITY_BONUS = 6
const CAPITAL_BONUS = 12
const WALLS_BONUS = 4
const METROPOLIS_BONUS = 2

export interface CityDefencePart {
  readonly label: string
  readonly amount: number
}

/** The city a battle is fought for, and what it adds to the defender's combat bonus. */
export interface CityDefence {
  readonly cityPieceId: string
  /** For example "Capital D5". */
  readonly cityLabel: string
  readonly parts: readonly CityDefencePart[]
  readonly total: number
  /** The fortification marker on the city, which the end of the battle removes. */
  readonly fortificationPieceId: string | null
}

const isMetropolis = (city: BoardPiece): boolean => city.assetId.includes('metropolis')
const isCapital = (city: BoardPiece): boolean => isMetropolis(city) || city.assetId.includes('capital')
const isWalled = (city: BoardPiece): boolean => city.assetId.includes('walled')

/** The defender's city an attacking army stands on, if the battle is for one. */
function defendedCityOf(state: GameState, battle: Battle): BoardPiece | undefined {
  if (battle.attacker.kind !== 'player' || battle.defender.kind !== 'player') return undefined
  const attacker = findPlayer(state, battle.attacker.playerId)
  const defenderColour = findPlayer(state, battle.defender.playerId)?.color?.toLowerCase()
  if (attacker === undefined || defenderColour === undefined) return undefined
  const { board } = state
  for (const piece of board.pieces) {
    if (figureKindOf(piece) !== 'army' || !figureBelongsTo(attacker, piece)) continue
    const cell = mapCellOf(board, piece)
    if (cell === null) continue
    const city = cityCentredAt(board, defenderColour, cell)
    if (city !== undefined) return city
  }
  return undefined
}

/**
 * The defended city's bonus for the battle, or `null` when the battle is not for
 * one of the defender's cities (barbarians on either side included).
 */
export function cityDefenceOf(state: GameState, battle: Battle): CityDefence | null {
  const city = defendedCityOf(state, battle)
  if (city === undefined) return null
  const parts: CityDefencePart[] = [
    isCapital(city) ? { label: 'Defending a capital', amount: CAPITAL_BONUS } : { label: 'Defending a city', amount: CITY_BONUS },
  ]
  if (isWalled(city)) parts.push({ label: 'City Walls', amount: WALLS_BONUS })
  if (isMetropolis(city)) parts.push({ label: 'Metropolis', amount: METROPOLIS_BONUS })
  const fortification = cityMarkerOf(state.board, city, FORTIFICATION_ASSET_ID)
  if (fortification !== undefined) parts.push({ label: 'Fortification', amount: FORTIFICATION_BONUS })
  return {
    cityPieceId: city.id,
    cityLabel: cityLabelOf(state.board, city),
    parts,
    total: parts.reduce((sum, part) => sum + part.amount, 0),
    fortificationPieceId: fortification?.id ?? null,
  }
}
