/**
 * What a player can do with their cities besides building (task
 * `assisted-city-actions`, issue #264 and #250 slice C): start a Building Program,
 * and flip basic buildings to their upgraded form.
 *
 * Both are derived from the board and the player's revealed techs, never stored.
 * The upgrade depends on which techs the player has revealed, so the options belong
 * to the viewer's own projection and to nobody else's. The actions in `assisted.ts`
 * recompute them from the fresh state, so the projection and the action cannot
 * disagree.
 *
 * Import cycle with `assisted.ts`, as `build-options.ts` has: that file builds the
 * actions from this one, this one asks it whether City Management is open. Both only
 * call each other inside functions, never while the modules load.
 */

import { PHASE_REASON, openCityManagementTurn } from './assisted.js'
import { cityFootprintsOf, mapCellOf } from './blockade.js'
import type { Cell, CityFootprintView } from './blockade.js'
import type { BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import type { BuildSquare } from './build-options.js'
import { BUILDING_UPGRADES, buildingNameOf, techsUnlocking } from './building-data.js'
import { BUILDING_PROGRAM_ASSET_ID, cityProductionsOf } from './city-production.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import type { GameState, Playerhand } from './state.js'

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

// ---------------------------------------------------------------------------
// Start a Building Program
// ---------------------------------------------------------------------------

export const MARKER_PRESENT_REASON = 'This city already has a Building Program marker.'

export interface StartBuildingProgramOption {
  /** `wrong-phase` outside the player's open City Management phase, `unavailable` when the city already has the marker; `reason` says why. */
  readonly status: 'ready' | 'wrong-phase' | 'unavailable'
  readonly reason: string
  /** Whether a Building Program marker already stands on a centre square of the city. True also when the phase is closed. */
  readonly hasMarker: boolean
}

export interface CityActionOptions {
  readonly cityPieceId: string
  /** For example "Capital B3", as the production figure labels it. */
  readonly label: string
  readonly startBuildingProgram: StartBuildingProgramOption
}

/**
 * The Building Program marker on a centre of the city, if there is one. A metropolis
 * has two centre squares and a marker on either counts (`city-production.ts` reads it
 * the same way); whoever put it there.
 */
export function buildingProgramMarkerOf(state: GameState, footprint: CityFootprintView): BoardPiece | undefined {
  const centres = new Set(footprint.centers.map(keyOf))
  return state.board.pieces.find((piece) => {
    if (piece.assetId !== BUILDING_PROGRAM_ASSET_ID) return false
    const cell = mapCellOf(state.board, piece)
    return cell !== null && centres.has(keyOf(cell))
  })
}

/** The player's city footprint with this piece id, or `undefined` when it is not theirs or not on the map. */
export function ownCityFootprint(
  state: GameState,
  player: Playerhand,
  cityPieceId: string,
): CityFootprintView | undefined {
  if (player.color === null) return undefined
  return cityFootprintsOf(state, player.color.toLowerCase()).find((candidate) => candidate.piece.id === cityPieceId)
}

/**
 * One entry per city of the player on the map, in board order. Empty for a player
 * without a colour or a city. The viewer's own view only.
 */
export function cityActionsOf(state: GameState, player: Playerhand): readonly CityActionOptions[] {
  if (player.color === null) return []
  const footprints = cityFootprintsOf(state, player.color.toLowerCase())
  if (footprints.length === 0) return []

  const productions = cityProductionsOf(state, player)
  const open = openCityManagementTurn(state, player) !== undefined
  return footprints.flatMap((footprint) => {
    const city = productions.find((candidate) => candidate.pieceId === footprint.piece.id)
    if (city === undefined) return []
    const hasMarker = buildingProgramMarkerOf(state, footprint) !== undefined
    const startBuildingProgram: StartBuildingProgramOption = !open
      ? { status: 'wrong-phase', reason: PHASE_REASON, hasMarker }
      : hasMarker
        ? { status: 'unavailable', reason: MARKER_PRESENT_REASON, hasMarker }
        : { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker }
    return [{ cityPieceId: city.pieceId, label: city.label, startBuildingProgram }]
  })
}

// ---------------------------------------------------------------------------
// Upgrade buildings
// ---------------------------------------------------------------------------

/** A basic building in the outskirts of one of the player's cities whose upgraded form the player has revealed. */
export interface UpgradablePiece {
  readonly piece: BoardPiece
  readonly cell: Cell
  readonly basicAssetId: string
  readonly upgradedAssetId: string
}

export interface UpgradeFamilyOption {
  readonly basicAssetId: string
  readonly upgradedAssetId: string
  readonly basicLabel: string
  readonly upgradedLabel: string
  /** For example "Granary to Aqueduct". */
  readonly label: string
  /** How many basic buildings of the family would be flipped: `squares.length`. */
  readonly count: number
  /** The squares they stand on, in board order. */
  readonly squares: readonly BuildSquare[]
}

const nameOf = (assetId: string): string => buildingNameOf(assetId) ?? assetId

/** The families, basic to upgraded, whose upgraded form the player has unlocked with a revealed tech (base rules p. 22). */
function unlockedFamilies(player: Playerhand): readonly (readonly [basic: string, upgraded: string])[] {
  const revealed = new Set(player.techsChosen.filter((tech) => !tech.hidden).map((tech) => tech.name))
  return Object.entries(BUILDING_UPGRADES).filter(([, upgraded]) =>
    techsUnlocking(upgraded).some((tech) => revealed.has(tech)),
  )
}

/**
 * Every basic building the player may flip, in board order: it stands on a map
 * square in the outskirts of one of the player's own cities, and the tech of its
 * upgraded form is revealed. Ownership is the city, never `placedBy`, as the
 * blockade and the production figure read it. A building outside every outskirts or
 * in another player's is not listed. Blockade does not matter: flipping is
 * bookkeeping, not production.
 */
export function upgradablePiecesOf(state: GameState, player: Playerhand): readonly UpgradablePiece[] {
  if (player.color === null) return []
  const families = new Map(unlockedFamilies(player))
  if (families.size === 0) return []
  const outskirts = new Set(
    cityFootprintsOf(state, player.color.toLowerCase()).flatMap((footprint) => footprint.outskirts.map(keyOf)),
  )
  if (outskirts.size === 0) return []

  const found: UpgradablePiece[] = []
  for (const piece of state.board.pieces) {
    if (piece.category !== 'building') continue
    const upgradedAssetId = families.get(piece.assetId)
    if (upgradedAssetId === undefined) continue
    const cell = mapCellOf(state.board, piece)
    if (cell === null || !outskirts.has(keyOf(cell))) continue
    found.push({ piece, cell, basicAssetId: piece.assetId, upgradedAssetId })
  }
  return found
}

/** One entry per family that can be flipped now, in the order of `BUILDING_UPGRADES`. Empty when nothing can. The viewer's own view only. */
export function upgradeOptionsOf(state: GameState, player: Playerhand): readonly UpgradeFamilyOption[] {
  const pieces = upgradablePiecesOf(state, player)
  return Object.entries(BUILDING_UPGRADES).flatMap(([basicAssetId, upgradedAssetId]) => {
    const own = pieces.filter((candidate) => candidate.basicAssetId === basicAssetId)
    if (own.length === 0) return []
    const basicLabel = nameOf(basicAssetId)
    const upgradedLabel = nameOf(upgradedAssetId)
    const squares = own.map((candidate): BuildSquare => ({
      column: candidate.cell.column,
      row: candidate.cell.row,
      label: squareLabel(candidate.cell),
    }))
    return [
      { basicAssetId, upgradedAssetId, basicLabel, upgradedLabel, label: `${basicLabel} to ${upgradedLabel}`, count: own.length, squares },
    ]
  })
}

/**
 * What an upgrade would flip, or the plain reason it cannot be done. `family` is the
 * asset id of one basic building; without it every family that can be flipped is.
 * `apply` and `availability` of the action both ask this, so they cannot disagree.
 */
export function upgradePlanOf(
  state: GameState,
  player: Playerhand,
  family?: string,
): Result<readonly UpgradablePiece[], string> {
  if (family !== undefined) {
    const upgraded = Object.hasOwn(BUILDING_UPGRADES, family) ? BUILDING_UPGRADES[family] : undefined
    if (upgraded === undefined) return err(`${family} is not a building that has an upgraded form.`)
    if (!unlockedFamilies(player).some(([basic]) => basic === family)) {
      return err(`You have not revealed the tech of the ${nameOf(upgraded)}, so the ${nameOf(family)} cannot be upgraded.`)
    }
    const pieces = upgradablePiecesOf(state, player).filter((candidate) => candidate.basicAssetId === family)
    return pieces.length === 0
      ? err(`No ${nameOf(family)} of yours stands in the outskirts of your cities.`)
      : ok(pieces)
  }
  if (unlockedFamilies(player).length === 0) {
    return err('None of your revealed techs unlocks an upgraded building.')
  }
  const pieces = upgradablePiecesOf(state, player)
  return pieces.length === 0
    ? err('No basic building of yours stands in the outskirts of your cities with its upgrade unlocked.')
    : ok(pieces)
}

/** "Granary" stays, "Granaries", "Aqueducts", "Barracks": a plural for a building name, for the log. */
function pluralName(name: string, count: number): string {
  if (count === 1 || name.endsWith('s')) return name
  return /[^aeiou]y$/i.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`
}

/** "B3", "B3 and C4", "B3, C4 and D5". */
function listSquares(squares: readonly string[]): string {
  if (squares.length <= 1) return squares.join('')
  return `${squares.slice(0, -1).join(', ')} and ${squares.at(-1) ?? ''}`
}

/**
 * The sentence for what a flip changed, one clause per family in the order of
 * `BUILDING_UPGRADES`: "2 Granaries to Aqueducts at B3 and C4; 1 Library to
 * University at D5". The squares are in the order the buildings were given.
 */
export function describeUpgrades(
  flips: readonly { readonly basicAssetId: string; readonly squareLabel: string }[],
): string {
  return Object.entries(BUILDING_UPGRADES)
    .flatMap(([basicAssetId, upgradedAssetId]) => {
      const own = flips.filter((flip) => flip.basicAssetId === basicAssetId)
      if (own.length === 0) return []
      const count = own.length
      return [
        `${count} ${pluralName(nameOf(basicAssetId), count)} to ${pluralName(nameOf(upgradedAssetId), count)} ` +
          `at ${listSquares(own.map((flip) => flip.squareLabel))}`,
      ]
    })
    .join('; ')
}
