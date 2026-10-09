/**
 * What each city produces, as an honest estimate.
 *
 * Production is the number of production icons in a city's outskirts (base rules
 * p. 15), plus the modifiers that add to every city. The map data does not hold
 * every icon: the terrain is in `tile-terrain.json`, buildings in
 * `building-data.ts`, and nothing records the icons of a wonder or a great
 * person. So the number is always an estimate and `notes` names what it leaves
 * out. A number typed in by the players (`BoardPiece.productionOverride`) wins.
 *
 * Derived from the public board and from revealed cards only, like the combat
 * bonus and the culture hand size, so every viewer gets the same figures and the
 * projection can carry them for every player. Nothing here is stored.
 */

import { buildingDataOf } from './building-data.js'
import { cityFootprintsOf, blockadedGreatPersonTypes, isOwnWonderBlockaded, mapCellOf } from './blockade.js'
import type { Cell } from './blockade.js'
import { TILE_SQUARES, columnLabel, mapTop, squareOf } from './board.js'
import type { Board, BoardPiece } from './board.js'
import { coinSourcesOf, totalCoins } from './coins.js'
import type { GameState, Playerhand } from './state.js'
import { terrainAt } from './terrain.js'
import type { Terrain } from './terrain.js'

/** One square of a city's outskirts that gives something, is unknown, or explains a replaced icon. */
export interface OutskirtsSquare {
  /** The square's label, for example "D5". */
  readonly square: string
  /** Where the number comes from: a terrain, a building's label, "wonder", "great person" or "unknown terrain". */
  readonly source: string
  /** Production counted for the square. 0 when it is blockaded or its icons are not in the data. */
  readonly amount: number
  readonly blockaded: boolean
}

/** One thing added to every city. `amount` is what is counted, so it is 0 when `applied` is false. */
export interface CityModifier {
  readonly label: string
  readonly amount: number
  readonly applied: boolean
  /** Why it is switched off, or a remark about the amount. `null` when there is nothing to add. */
  readonly note: string | null
}

export interface CityProduction {
  readonly pieceId: string
  /** For example "Capital D5" or "Metropolis F8". */
  readonly label: string
  /** The sum of the outskirts squares. */
  readonly outskirts: number
  readonly outskirtsDetail: readonly OutskirtsSquare[]
  readonly modifiers: readonly CityModifier[]
  /** Whether a Building Program marker stands on a centre square of the city. */
  readonly buildingProgram: boolean
  /** The outskirts plus the applied modifiers. Never a complete count; see `notes`. */
  readonly estimate: number
  /**
   * What the city produces when it builds with the Building Program (Wisdom and
   * Warfare p. 7): the outskirts doubled, the modifiers not. `null` without the marker.
   */
  readonly withBuildingProgram: number | null
  /** The number the players typed in, or `null`. */
  readonly override: number | null
  /** The override when there is one, otherwise the estimate. */
  readonly effective: number
  /** What the estimate does not count, in plain sentences. Never empty. */
  readonly notes: readonly string[]
}

const TERRAIN_PRODUCTION: Readonly<Record<Terrain, number>> = {
  water: 0,
  grassland: 0,
  forest: 2,
  mountain: 1,
  desert: 0,
}

const BUILDING_PROGRAM_ASSET_ID = 'markers/Building Program'
const CHICHEN_ITZA_ASSET_ID = 'wonders/chichenitza'
const GREAT_LIGHTHOUSE_ASSET_ID = 'wonders/greatlighthouse'

const MAX_INFRASTRUCTURE = 3
const DESPOTISM_BONUS = 1
const CHICHEN_ITZA_BONUS = 3
const SUSAN_B_ANTHONY_BONUS = 2
const COINS_PER_MILITARY_SCIENCE_POINT = 3

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

const squareLabel = (cell: Cell): string => `${columnLabel(cell.column)}${cell.row + 1}`

/** Whether the square lies on a playable slot. A city at the edge has outskirts off the map, which are not squares at all. */
const isOnMap = (board: Board, cell: Cell): boolean =>
  board.slots.some(
    (slot) =>
      cell.column >= slot.x &&
      cell.column < slot.x + TILE_SQUARES &&
      cell.row >= slot.y &&
      cell.row < slot.y + TILE_SQUARES,
  )

const terrainOfCell = (board: Board, cell: Cell): Terrain | null =>
  terrainAt(
    board,
    (cell.column + 0.5) * board.squareSize,
    mapTop(board) + (cell.row + 0.5) * board.squareSize,
  )

function kindOf(piece: BoardPiece): string {
  if (piece.assetId.includes('metropolis')) return 'Metropolis'
  if (piece.assetId.includes('capital')) return 'Capital'
  return 'City'
}

/** Square labels as one phrase: "D5", "D5 and E6", "D5, E6 and F7". */
function listSquares(squares: readonly string[]): string {
  if (squares.length <= 1) return squares.join('')
  return `${squares.slice(0, -1).join(', ')} and ${squares.at(-1) ?? ''}`
}

/** What applies to every one of a player's cities, worked out once. */
function modifiersOf(state: GameState, player: Playerhand): readonly CityModifier[] {
  const modifiers: CityModifier[] = []

  const infra = Math.max(player.stats.infra, 0)
  if (infra > 0) {
    modifiers.push({
      label: 'Infrastructure',
      amount: Math.min(infra, MAX_INFRASTRUCTURE),
      applied: true,
      note: infra > MAX_INFRASTRUCTURE ? `The status board shows ${infra}; at most ${MAX_INFRASTRUCTURE} count.` : null,
    })
  }

  if (player.government === 'Despotism') {
    modifiers.push({ label: 'Despotism', amount: DESPOTISM_BONUS, applied: true, note: null })
  }

  const ownsChichenItza = state.board.pieces.some(
    (piece) => piece.assetId === CHICHEN_ITZA_ASSET_ID && piece.ownerId === player.playerId,
  )
  if (ownsChichenItza) {
    const blockaded = isOwnWonderBlockaded(state, player, CHICHEN_ITZA_ASSET_ID)
    modifiers.push({
      label: 'Chichen Itza',
      amount: blockaded ? 0 : CHICHEN_ITZA_BONUS,
      applied: !blockaded,
      note: blockaded ? `Blockaded, so its +${CHICHEN_ITZA_BONUS} is switched off.` : null,
    })
  }

  // Only a revealed card counts: a hidden one would show what the player holds.
  const hasSusan = player.items.some(
    (item) => item.kind === 'greatperson' && item.name === 'Susan B. Anthony' && !item.hidden,
  )
  if (hasSusan) {
    const blockaded = blockadedGreatPersonTypes(state, player).includes('Humanitarian')
    modifiers.push({
      label: 'Susan B. Anthony',
      amount: blockaded ? 0 : SUSAN_B_ANTHONY_BONUS,
      applied: !blockaded,
      note: blockaded
        ? `Every Humanitarian token is blockaded, so her +${SUSAN_B_ANTHONY_BONUS} is switched off.`
        : null,
    })
  }

  if (player.techsChosen.some((tech) => tech.name === 'Military Science' && !tech.hidden)) {
    const coins = Math.max(totalCoins(coinSourcesOf(state, player)), 0)
    const amount = Math.floor(coins / COINS_PER_MILITARY_SCIENCE_POINT)
    modifiers.push({
      label: 'Military Science',
      amount,
      applied: true,
      note: `${coins} ${coins === 1 ? 'coin' : 'coins'}, +1 for every ${COINS_PER_MILITARY_SCIENCE_POINT}.`,
    })
  }

  return modifiers
}

/**
 * One `CityProduction` per city piece of the player, in board order. Empty for
 * a player without a colour, who has no cities. A city's owner is the player
 * whose colour its piece has, as `cityCountOf` reads it.
 */
export function cityProductionsOf(state: GameState, player: Playerhand): readonly CityProduction[] {
  if (player.color === null) return []
  const colour = player.color.toLowerCase()
  const footprints = cityFootprintsOf(state, colour)
  if (footprints.length === 0) return []

  const { board } = state
  const modifiers = modifiersOf(state, player)
  const modifierTotal = modifiers.reduce((total, modifier) => total + (modifier.applied ? modifier.amount : 0), 0)

  const buildingProgramCells = board.pieces
    .filter((piece) => piece.assetId === BUILDING_PROGRAM_ASSET_ID)
    .flatMap((piece) => {
      const cell = mapCellOf(board, piece)
      return cell === null ? [] : [cell]
    })

  // Notes about the player rather than a city, repeated on each city.
  const playerNotes: string[] = []
  if (player.government === 'Communism') {
    playerNotes.push('Communism is the government. Its effect on production is not counted.')
  }
  if (player.socialPolicies.some((policy) => policy.name === 'Urban Development' && !policy.hidden)) {
    playerNotes.push('Urban Development is revealed. Its extra production is not counted.')
  }
  if (state.board.pieces.some((piece) => piece.assetId === GREAT_LIGHTHOUSE_ASSET_ID && piece.ownerId === player.playerId)) {
    playerNotes.push('The Great Lighthouse is owned. Any effect on production is not counted.')
  }
  const ownScoutId = `figures/${colour}scout`
  if (board.pieces.some((piece) => piece.assetId === ownScoutId && mapCellOf(board, piece) !== null)) {
    playerNotes.push('A scout can send a square to another city. That is not tracked.')
  }

  return footprints.map((footprint): CityProduction => {
    const { piece, centers, outskirts } = footprint
    const detail: OutskirtsSquare[] = []
    const wonderOrPersonSquares: string[] = []
    const unknownSquares: string[] = []
    const doubleBuildingSquares: string[] = []
    const sharedSquares: string[] = []
    let unknownBuilding = false

    const otherOwn = footprints.filter((other) => other.piece.id !== piece.id)

    for (const cell of outskirts) {
      if (!isOnMap(board, cell)) continue
      const square = squareLabel(cell)
      const blockaded = footprint.hasEnemyFigureAt(cell)
      // Counted for each city, as old data may overlap; the note says so.
      if (otherOwn.some((other) => [...other.centers, ...other.outskirts].some((c) => sameCell(c, cell)))) {
        sharedSquares.push(square)
      }

      const here = board.pieces.filter((other) => {
        if (other.category !== 'building' && other.category !== 'wonder' && other.category !== 'greatperson') return false
        const at = mapCellOf(board, other)
        return at !== null && sameCell(at, cell)
      })
      const buildings = here.filter((other) => other.category === 'building')
      const hasWonderOrPerson = here.some((other) => other.category !== 'building')
      if (hasWonderOrPerson) wonderOrPersonSquares.push(square)

      if (buildings.length > 0) {
        // A building replaces every icon the square had (base rules p. 16).
        if (buildings.length > 1) doubleBuildingSquares.push(square)
        const best = buildings.reduce((top, candidate) =>
          (buildingDataOf(candidate.assetId)?.production ?? 0) > (buildingDataOf(top.assetId)?.production ?? 0)
            ? candidate
            : top,
        )
        const data = buildingDataOf(best.assetId)
        if (data === undefined) unknownBuilding = true
        detail.push({
          square,
          source: best.label,
          amount: blockaded ? 0 : (data?.production ?? 0),
          blockaded,
        })
        continue
      }

      if (hasWonderOrPerson) {
        const wonder = here.some((other) => other.category === 'wonder')
        detail.push({ square, source: wonder ? 'wonder' : 'great person', amount: 0, blockaded })
        continue
      }

      const terrain = terrainOfCell(board, cell)
      if (terrain === null) {
        unknownSquares.push(square)
        detail.push({ square, source: 'unknown terrain', amount: 0, blockaded })
        continue
      }
      const icons = TERRAIN_PRODUCTION[terrain]
      if (icons > 0) detail.push({ square, source: terrain, amount: blockaded ? 0 : icons, blockaded })
    }

    const outskirtsTotal = detail.reduce((total, entry) => total + entry.amount, 0)
    const estimate = outskirtsTotal + modifierTotal
    const buildingProgram = buildingProgramCells.some((marker) => centers.some((centre) => sameCell(centre, marker)))
    const override = piece.productionOverride ?? null

    const notes = [
      'Not a complete count: the map data does not hold every icon, and one-turn effects such as event cards are not counted.',
    ]
    if (wonderOrPersonSquares.length > 0) {
      notes.push(
        `${listSquares(wonderOrPersonSquares)} hold${wonderOrPersonSquares.length === 1 ? 's' : ''} a wonder or a great person. Their icons are not in the data and count as 0.`,
      )
    }
    if (unknownSquares.length > 0) {
      notes.push(`The terrain of ${listSquares(unknownSquares)} is unknown and counts as 0.`)
    }
    if (unknownBuilding) notes.push('A building in the outskirts is not in the building table and counts as 0.')
    if (doubleBuildingSquares.length > 0) {
      notes.push(`${listSquares(doubleBuildingSquares)} hold more than one building. Only the one with most production counts.`)
    }
    if (sharedSquares.length > 0) {
      notes.push(`${listSquares(sharedSquares)} also belong to another of your cities. They count for each city.`)
    }
    notes.push(...playerNotes)

    return {
      pieceId: piece.id,
      label: `${kindOf(piece)} ${squareOf(board, piece) ?? ''}`.trim(),
      outskirts: outskirtsTotal,
      outskirtsDetail: detail,
      modifiers,
      buildingProgram,
      estimate,
      withBuildingProgram: buildingProgram ? outskirtsTotal * 2 + modifierTotal : null,
      override,
      effective: override ?? estimate,
      notes,
    }
  })
}
