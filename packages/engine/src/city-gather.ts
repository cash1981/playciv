/**
 * What a city can gather from the map for its action: culture for Devote to the Arts
 * and a resource for Harvest (base rules pp. 17 and 18, and "Scout Gathering" on p. 26).
 *
 * Read from the board only, never stored, so every view agrees and a move of a piece
 * is seen at once. The icons come from `tile-icons.json` (read by eye from the tile
 * images) and from the building table. Two things are never known: the culture of a
 * wonder or a Great Person on a square, and the one scout that is sent to a city this
 * turn, so a scout is offered to every city and the player says which.
 *
 * Pure: the phase and the supply of tokens are decided by the caller, not here.
 */

import { mapCellOf, pieceColorOf } from './blockade.js'
import type { Cell, CityFootprintView } from './blockade.js'
import { WHITE_SCOUT_ID, isMapCell, whiteFigureFor } from './board.js'
import type { BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import { buildingDataOf } from './building-data.js'
import type { GameState, Playerhand } from './state.js'
import { RESOURCE_KINDS, resourceName, squareIconsOfCell } from './tile-icons.js'
import type { ResourceKind } from './tile-icons.js'

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

/** One line of the sum a Devote to the Arts adds up. */
export interface CultureShare {
  /** For example "The city itself", "Temple at B3" or "Culture icon at C4". */
  readonly label: string
  readonly amount: number
}

/** A scout of the player's on a map square that gives culture, a resource or both. */
export interface ScoutSquare {
  readonly pieceId: string
  /** For example "E5". */
  readonly square: string
  readonly culture: number
  readonly resource: ResourceKind | null
}

export interface DevoteGathering {
  /** The city and its outskirts, with no scout sent: the sum of `parts`. */
  readonly culture: number
  readonly parts: readonly CultureShare[]
  /** What is not counted, in plain sentences. */
  readonly notes: readonly string[]
  /** The scouts whose square has culture, as the player may send any of them to this city. */
  readonly scouts: readonly ScoutSquare[]
}

export interface HarvestChoiceView {
  readonly resource: ResourceKind
  /** For example "Wheat at C4 and D5" or "Wheat under a scout at E5". */
  readonly label: string
  /** The scout whose square it is; `null` for a resource in the outskirts. */
  readonly scoutPieceId: string | null
  /** Whether the market still has a token of it. */
  readonly available: boolean
  /** Why not, when it is not available. */
  readonly unavailableReason: string | null
}

export interface HarvestGathering {
  readonly choices: readonly HarvestChoiceView[]
  readonly notes: readonly string[]
}

export interface CityGathering {
  readonly devote: DevoteGathering
  readonly harvest: HarvestGathering
}

interface SquareReading {
  readonly cell: Cell
  readonly label: string
  /** What stands on it and replaces its culture icons. */
  readonly covered: 'building' | 'wonder' | 'great person' | null
  /** The name of the building that gives `culture`, when it is a building. */
  readonly source: string
  /** Culture the square gives to a city that is not blockaded in it. */
  readonly culture: number
  /** The resource icon, unless something stands on the square: a building, wonder, Great Person or disaster token covers it (the human's ruling). */
  readonly resource: ResourceKind | null
  /** The resource that is printed on the square but covered, so it cannot be harvested. */
  readonly coveredResource: ResourceKind | null
  /** Whether the icons of the tile have been read. A square that something stands on is known either way. */
  readonly known: boolean
}

/** What a map square gives: the building's culture, else a natural wonder's icon, plus any resource. */
function readSquare(state: GameState, cell: Cell): SquareReading {
  const { board } = state
  const label = squareLabel(cell)
  const here = board.pieces.filter((piece) => {
    if (
      piece.category !== 'building' &&
      piece.category !== 'wonder' &&
      piece.category !== 'greatperson' &&
      piece.category !== 'disaster'
    ) {
      return false
    }
    const at = mapCellOf(board, piece)
    return at !== null && sameCell(at, cell)
  })
  const icons = squareIconsOfCell(board, cell)
  const printed = icons?.resource ?? null
  // Anything on the square covers its resource, for the city and for a scout alike
  const resource = here.length > 0 ? null : printed
  const coveredResource = here.length > 0 ? printed : null

  const buildings = here.filter((piece) => piece.category === 'building')
  if (buildings.length > 0) {
    const best = buildings.reduce((top, candidate) =>
      (buildingDataOf(candidate.assetId)?.culture ?? 0) > (buildingDataOf(top.assetId)?.culture ?? 0) ? candidate : top,
    )
    return {
      cell,
      label,
      covered: 'building',
      source: best.label,
      culture: buildingDataOf(best.assetId)?.culture ?? 0,
      resource,
      coveredResource,
      known: true,
    }
  }
  if (here.length > 0) {
    const wonder = here.some((piece) => piece.category === 'wonder')
    const person = here.some((piece) => piece.category === 'greatperson')
    // A disaster token alone covers the square's art, and with it the culture icon (the human's ruling). It is not named as a wonder or a person.
    if (!wonder && !person) {
      return { cell, label, covered: null, source: 'Culture icon', culture: 0, resource, coveredResource, known: icons !== null }
    }
    return { cell, label, covered: wonder ? 'wonder' : 'great person', source: '', culture: 0, resource, coveredResource, known: true }
  }
  return { cell, label, covered: null, source: 'Culture icon', culture: icons?.culture ?? 0, resource, coveredResource, known: icons !== null }
}

/** Whether the piece is a scout of this player: their colour's, or the white one of the Spanish. */
function isOwnScout(piece: BoardPiece, player: Playerhand): boolean {
  if (piece.category !== 'figure' || !piece.assetId.endsWith('scout')) return false
  if (piece.assetId === WHITE_SCOUT_ID) {
    return player.civilization !== null && whiteFigureFor(player.civilization.name) === WHITE_SCOUT_ID
  }
  return player.color !== null && pieceColorOf(piece) === player.color.toLowerCase()
}

const listSquares = (squares: readonly string[]): string =>
  squares.length <= 1 ? squares.join('') : `${squares.slice(0, -1).join(', ')} and ${squares.at(-1) ?? ''}`

/**
 * What one of the player's cities can gather. Outskirts squares that an enemy figure
 * stands in give nothing (base rules p. 27); a scout gathers from its own square even if
 * it is blockaded, so a scout's square is read with no blockade. A scout inside this
 * city's own outskirts adds nothing, as the square is already counted.
 */
export function cityGatheringOf(state: GameState, player: Playerhand, footprint: CityFootprintView): CityGathering {
  const { board } = state
  const isMetropolis = footprint.piece.assetId.includes('metropolis')
  const outskirts = footprint.outskirts.filter((cell) => isMapCell(board, cell.column, cell.row))
  const own = [...footprint.centers, ...outskirts]

  const parts: CultureShare[] = [{ label: isMetropolis ? 'The metropolis itself' : 'The city itself', amount: isMetropolis ? 2 : 1 }]
  const notes: string[] = []
  const blockadedWithIcons: string[] = []
  const coveredBy: string[] = []
  const unknown: string[] = []
  const coveredResources: string[] = []
  const found = new Map<ResourceKind, string[]>()

  for (const cell of outskirts) {
    const reading = readSquare(state, cell)
    const blockaded = footprint.hasEnemyFigureAt(cell)
    if (blockaded) {
      if (reading.culture > 0 || reading.resource !== null) blockadedWithIcons.push(reading.label)
      continue
    }
    if (reading.covered === 'wonder' || reading.covered === 'great person') coveredBy.push(reading.label)
    if (!reading.known) unknown.push(reading.label)
    if (reading.culture > 0) {
      parts.push({
        label: reading.covered === 'building' ? `${reading.source} at ${reading.label}` : `Culture icon at ${reading.label}`,
        amount: reading.culture,
      })
    }
    if (reading.coveredResource !== null) coveredResources.push(`${resourceName(reading.coveredResource)} at ${reading.label}`)
    if (reading.resource !== null) found.set(reading.resource, [...(found.get(reading.resource) ?? []), reading.label])
  }

  const blockadeNote =
    blockadedWithIcons.length === 0
      ? null
      : `${listSquares(blockadedWithIcons)} ${blockadedWithIcons.length === 1 ? 'is blockaded and gives' : 'are blockaded and give'} nothing.`
  if (blockadeNote !== null) notes.push(blockadeNote)
  if (coveredBy.length > 0) {
    notes.push(`${listSquares(coveredBy)} hold${coveredBy.length === 1 ? 's' : ''} a wonder or a Great Person. Its culture is not counted.`)
  }
  if (unknown.length > 0) {
    notes.push(`The icons of ${listSquares(unknown)} are not in the map data and count as none.`)
  }
  notes.push('Culture from civilization, government, tech and card effects is not counted.')

  const scouts: ScoutSquare[] = []
  const scoutChoices: HarvestChoiceView[] = []
  for (const piece of board.pieces) {
    if (!isOwnScout(piece, player)) continue
    const cell = mapCellOf(board, piece)
    if (cell === null || own.some((mine) => sameCell(mine, cell))) continue
    const reading = readSquare(state, cell)
    if (reading.culture > 0) scouts.push({ pieceId: piece.id, square: reading.label, culture: reading.culture, resource: reading.resource })
    if (reading.resource !== null) {
      scoutChoices.push({
        resource: reading.resource,
        label: `${resourceName(reading.resource)} under a scout at ${reading.label}`,
        scoutPieceId: piece.id,
        available: true,
        unavailableReason: null,
      })
    }
  }
  if (scouts.length > 0) {
    notes.push('A scout gathers from the turn after it was placed and is sent to one city. The game does not track that; send it only where you mean to.')
  }

  const choices: HarvestChoiceView[] = [
    ...RESOURCE_KINDS.flatMap((resource): HarvestChoiceView[] => {
      const squares = found.get(resource)
      if (squares === undefined) return []
      return [
        {
          resource,
          label: `${resourceName(resource)} at ${listSquares(squares)}`,
          scoutPieceId: null,
          available: true,
          unavailableReason: null,
        },
      ]
    }),
    ...scoutChoices,
  ]

  const harvestNotes: string[] = []
  if (scoutChoices.length > 0) harvestNotes.push('A scout gathers from the turn after it was placed and is sent to one city. The game does not track that; take from a scout only where you mean to.')
  if (blockadeNote !== null) harvestNotes.push(blockadeNote)
  if (unknown.length > 0) harvestNotes.push(`The icons of ${listSquares(unknown)} are not in the map data, so a resource there is not listed.`)
  if (coveredResources.length > 0) {
    harvestNotes.push(`${listSquares(coveredResources)} ${coveredResources.length === 1 ? 'is' : 'are'} covered by a building, wonder, Great Person or disaster token and cannot be harvested.`)
  }
  harvestNotes.push('The same resource icon cannot be harvested twice in a turn, also not by two cities. The game does not track that.')

  return {
    devote: {
      culture: parts.reduce((total, part) => total + part.amount, 0),
      parts,
      notes,
      scouts,
    },
    harvest: { choices, notes: harvestNotes },
  }
}
