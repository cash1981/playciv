/**
 * What a city can gather from the map for its action: culture for Devote to the Arts
 * and a resource for Harvest (base rules pp. 17 and 18, and "Scout Gathering" on p. 26).
 *
 * Read from the board only, never stored, so every view agrees and a move of a piece
 * is seen at once. The icons come from `tile-icons.json` (read by eye from the tile
 * images), from the building table, and from the culture on wonder and Great Person
 * markers (`wonder-data.ts`, `great-person-data.ts`). The player's social policy
 * Urban Development adds culture to a city with two different buildings or wonders in its
 * outskirts. A scout gathers for the city it was sent to in the Start of Turn, else for the
 * capital (`scoutDestinationsOf`); without a capital on the map it is offered to every city.
 *
 * Pure: the phase and the supply of tokens are decided by the caller, not here.
 */

import { mapCellOf, pieceColorOf } from './blockade.js'
import type { Cell, CityFootprintView } from './blockade.js'
import { WHITE_SCOUT_ID, isMapCell, whiteFigureFor } from './board.js'
import { capitalOf, scoutDestinationsOf } from './sot.js'
import type { BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import { buildingDataOf, buildingNameOf } from './building-data.js'
import { greatPersonCultureOf } from './great-person-data.js'
import type { GameState, Playerhand } from './state.js'
import { RESOURCE_KINDS, resourceName, squareIconsOfCell } from './tile-icons.js'
import type { ResourceKind } from './tile-icons.js'
import { wonderCultureOf } from './wonder-data.js'

/** The social policy that adds culture to a Devote to the Arts. Its card is `Urban Development` on the sheet. */
const URBAN_DEVELOPMENT = 'Urban Development'
/** What Urban Development adds to a city that has the buildings it asks for. */
const URBAN_DEVELOPMENT_CULTURE = 2
/** How many different buildings or wonders in the outskirts Urban Development asks for. */
const URBAN_DEVELOPMENT_TILES = 2
/** The civilization whose cities produce 1 extra culture for each square with a resource in the outskirts when devoted. */
const INDIANS = 'Indians'

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
  /** What gives the culture: a building's or wonder's name, a Great Person's type, or "Culture icon". */
  readonly source: string
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
  /** What gives `culture`: the name of the building or wonder, the type of Great Person, or "Culture icon". */
  readonly source: string
  /** Culture the square gives to a city that is not blockaded in it. */
  readonly culture: number
  /** The building or wonder tile on it, which Urban Development counts; `null` when there is none. */
  readonly tile: { readonly assetId: string; readonly name: string } | null
  /** The resource icon, unless something stands on the square: a building, wonder, Great Person or disaster token covers it (the human's ruling). */
  readonly resource: ResourceKind | null
  /** The resource that is printed on the square but covered, so it cannot be harvested. */
  readonly coveredResource: ResourceKind | null
  /** Whether the icons of the tile have been read. A square that something stands on is known either way. */
  readonly known: boolean
}

/** The culture on a building, wonder or Great Person marker; 0 for an asset the tables do not know. */
function cultureOfPiece(piece: BoardPiece): number {
  if (piece.category === 'building') return buildingDataOf(piece.assetId)?.culture ?? 0
  if (piece.category === 'wonder') return wonderCultureOf(piece.assetId) ?? 0
  return greatPersonCultureOf(piece.assetId) ?? 0
}

/** "Temple", "The Louvre" or "Artist": the name a line of the sum gives its source. */
const nameOfPiece = (piece: BoardPiece): string =>
  piece.category === 'building' ? (buildingNameOf(piece.assetId) ?? piece.label) : piece.label

/**
 * What a map square gives: the culture of the building, wonder or Great Person that stands
 * on it (which replaces the icons printed there), else a natural wonder's icon, plus any
 * resource.
 */
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

  const standing = here.filter((piece) => piece.category !== 'disaster')
  if (standing.length > 0) {
    // One piece to a square; should old data hold two, the one that gives most culture is read
    const best = standing.reduce((top, candidate) => (cultureOfPiece(candidate) > cultureOfPiece(top) ? candidate : top))
    const tilePiece = best.category === 'greatperson' ? undefined : best
    return {
      cell,
      label,
      covered: best.category === 'building' ? 'building' : best.category === 'wonder' ? 'wonder' : 'great person',
      source: nameOfPiece(best),
      culture: cultureOfPiece(best),
      tile: tilePiece === undefined ? null : { assetId: tilePiece.assetId, name: nameOfPiece(tilePiece) },
      resource,
      coveredResource,
      known: true,
    }
  }
  // A disaster token alone covers the square's art, and with it the culture icon (the human's ruling)
  const culture = here.length > 0 ? 0 : (icons?.culture ?? 0)
  return { cell, label, covered: null, source: 'Culture icon', culture, tile: null, resource, coveredResource, known: icons !== null }
}

/** Whether the piece is a scout of this player: their colour's, or the white one of the Spanish. */
function isOwnScout(piece: BoardPiece, player: Playerhand): boolean {
  if (piece.category !== 'figure' || !piece.assetId.endsWith('scout')) return false
  if (piece.assetId === WHITE_SCOUT_ID) {
    return player.civilization !== null && whiteFigureFor(player.civilization.name) === WHITE_SCOUT_ID
  }
  return player.color !== null && pieceColorOf(piece) === player.color.toLowerCase()
}

/** "Temple", "The Louvre", "Artist (Great Person)" or "Culture icon": what a line of the sum names as the source. */
const sourceLabel = (reading: SquareReading): string =>
  reading.covered === 'great person' ? `${reading.source} (Great Person)` : reading.source

const listSquares = (squares: readonly string[]): string =>
  squares.length <= 1 ? squares.join('') : `${squares.slice(0, -1).join(', ')} and ${squares.at(-1) ?? ''}`

/**
 * What one of the player's cities can gather. Outskirts squares that an enemy figure
 * stands in give nothing (base rules p. 27); a scout gathers from its own square even if
 * it is blockaded, so a scout's square is read with no blockade. A scout inside this
 * city's own outskirts adds nothing, as the square is already counted.
 *
 * Urban Development (a social policy the player has revealed; a chosen one that is still hidden does not count, nor does any policy under Anarchy) adds 2 culture
 * when two different buildings or wonders stand in the outskirts: two of the same building
 * count once, a Great Person is not a building, and a blockaded square is not used by the
 * city, so it does not count.
 */
export function cityGatheringOf(state: GameState, player: Playerhand, footprint: CityFootprintView): CityGathering {
  const { board } = state
  const isMetropolis = footprint.piece.assetId.includes('metropolis')
  const outskirts = footprint.outskirts.filter((cell) => isMapCell(board, cell.column, cell.row))
  const own = [...footprint.centers, ...outskirts]

  const parts: CultureShare[] = [{ label: isMetropolis ? 'The metropolis itself' : 'The city itself', amount: isMetropolis ? 2 : 1 }]
  const notes: string[] = []
  const blockadedWithIcons: string[] = []
  const urbanTiles = new Map<string, string>()
  const resourceSquares: string[] = []
  const unknown: string[] = []
  const coveredResources: string[] = []
  const found = new Map<ResourceKind, string[]>()
  const sentTo = new Map(scoutDestinationsOf(state, player).map((assignment) => [assignment.scoutPieceId, assignment]))
  const sentAway: string[] = []

  for (const cell of outskirts) {
    const reading = readSquare(state, cell)
    // A scout on the square sends it to another city: it leaves this one (base rules p. 26)
    const leaves = [...sentTo.values()].some((assignment) => sameCell(assignment, cell) && assignment.cityPieceId !== footprint.piece.id)
    if (leaves) {
      sentAway.push(reading.label)
      continue
    }
    const blockaded = footprint.hasEnemyFigureAt(cell)
    if (blockaded) {
      if (reading.culture > 0 || reading.resource !== null) blockadedWithIcons.push(reading.label)
      continue
    }
    if (!reading.known) unknown.push(reading.label)
    if (reading.tile !== null) urbanTiles.set(reading.tile.assetId, reading.tile.name)
    if (reading.culture > 0) parts.push({ label: `${sourceLabel(reading)} at ${reading.label}`, amount: reading.culture })
    if (reading.coveredResource !== null) coveredResources.push(`${resourceName(reading.coveredResource)} at ${reading.label}`)
    if (reading.resource !== null) resourceSquares.push(reading.label)
    if (reading.resource !== null) found.set(reading.resource, [...(found.get(reading.resource) ?? []), reading.label])
  }

  const blockadeNote =
    blockadedWithIcons.length === 0
      ? null
      : `${listSquares(blockadedWithIcons)} ${blockadedWithIcons.length === 1 ? 'is blockaded and gives' : 'are blockaded and give'} nothing.`
  if (blockadeNote !== null) notes.push(blockadeNote)
  const sentAwayNote =
    sentAway.length === 0
      ? null
      : `${listSquares(sentAway)} ${sentAway.length === 1 ? 'is' : 'are'} sent to another city by a scout and give${sentAway.length === 1 ? 's' : ''} nothing here.`
  if (sentAwayNote !== null) notes.push(sentAwayNote)
  if (unknown.length > 0) {
    notes.push(`The icons of ${listSquares(unknown)} are not in the map data and count as none.`)
  }
  if (player.civilization?.name === INDIANS && resourceSquares.length > 0) {
    parts.push({ label: `Indians: resources at ${listSquares(resourceSquares)}`, amount: resourceSquares.length })
  }
  if (player.socialPolicies.some((policy) => policy.name === URBAN_DEVELOPMENT && !policy.hidden) && player.government !== 'Anarchy') {
    if (urbanTiles.size >= URBAN_DEVELOPMENT_TILES) {
      parts.push({ label: `${URBAN_DEVELOPMENT} (${listSquares([...urbanTiles.values()])})`, amount: URBAN_DEVELOPMENT_CULTURE })
    } else {
      notes.push(
        `${URBAN_DEVELOPMENT} needs ${URBAN_DEVELOPMENT_TILES} different buildings or wonders in the outskirts, and this city has ${urbanTiles.size === 0 ? 'none' : 'one'}.`,
      )
    }
  }
  notes.push('Culture from other civilization, government, tech and card effects is not counted.')

  const scouts: ScoutSquare[] = []
  const scoutChoices: HarvestChoiceView[] = []
  // A scout gathers for the city it was sent to in the Start of Turn, and for the capital when it was
  // not sent (base rules p. 26). Without a capital on the map it is offered to every city. With
  // one, a scout `scoutDestinationsOf` gives no city (a second scout on a square, or one on a
  // city centre) sends nothing.
  const hasCapital = capitalOf(state, player) !== undefined
  let sentHere = false
  let defaultHere = false
  let unsent = false
  for (const piece of board.pieces) {
    if (!isOwnScout(piece, player)) continue
    const destination = sentTo.get(piece.id)
    if (destination !== undefined && destination.cityPieceId !== footprint.piece.id) continue
    if (destination === undefined && hasCapital) continue
    const cell = mapCellOf(board, piece)
    if (cell === null || own.some((mine) => sameCell(mine, cell))) continue
    if (destination === undefined) unsent = true
    else if (destination.chosen) sentHere = true
    else defaultHere = true
    const reading = readSquare(state, cell)
    if (reading.culture > 0) scouts.push({
        pieceId: piece.id,
        square: reading.label,
        source: sourceLabel(reading),
        culture: reading.culture,
        resource: reading.resource,
      })
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
  const scoutNotes: string[] = []
  if (sentHere || defaultHere || unsent) scoutNotes.push('A scout gathers from the turn after it was placed.')
  if (sentHere) scoutNotes.push('A scout you sent to this city in the Start of Turn gathers here and for no other city.')
  if (defaultHere) {
    scoutNotes.push('A scout you did not send anywhere gathers for your capital and for no other city. Send it to another city in the Start of Turn to change that.')
  }
  if (unsent) {
    scoutNotes.push('Your capital is not marked on the map, so a scout you did not send is offered to every city. Send it to a city in the Start of Turn so the game tracks it.')
  }
  if (scouts.length > 0) notes.push(...scoutNotes)

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
  if (scoutChoices.length > 0) harvestNotes.push(...scoutNotes)
  if (blockadeNote !== null) harvestNotes.push(blockadeNote)
  if (sentAwayNote !== null) harvestNotes.push(sentAwayNote)
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
