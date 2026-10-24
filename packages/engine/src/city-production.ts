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
import { greatPersonProductionOf, greatPersonTradeOf } from './great-person-data.js'
import { cityFootprintsOf, blockadedGreatPersonTypes, isOwnWonderBlockaded, mapCellOf } from './blockade.js'
import type { Cell } from './blockade.js'
import { columnLabel, isMapCell, mapTop, squareOf } from './board.js'
import type { Board, BoardPiece } from './board.js'
import { coinSourcesOf, totalCoins } from './coins.js'
import { figuresOnMap, scoutDestinationsOf } from './sot.js'
import type { GameState, Playerhand } from './state.js'
import { disasterAt, terrainAt } from './terrain.js'
import { squareIconsOfCell } from './tile-icons.js'
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
  /** Set when one of the player's scouts sends this square to another of their cities this turn: the label of that city. */
  readonly sentTo?: string
  /** Set on a square outside the outskirts that one of the player's scouts sends to this city this turn. */
  readonly scout?: true
}

/** One thing added to every city. `amount` is what is counted, so it is 0 when `applied` is false. */
export interface CityModifier {
  readonly label: string
  readonly amount: number
  readonly applied: boolean
  /** Why it is switched off, or a remark about the amount. `null` when there is nothing to add. */
  readonly note: string | null
}

/** One square of a city's outskirts that gives trade. */
export interface TradeSquare {
  readonly square: string
  /** A building's label, or "map icon" for the trade icon printed on the square. */
  readonly source: string
  /** Trade counted for the square. 0 when it is blockaded. */
  readonly amount: number
  readonly blockaded: boolean
}

/**
 * The trade around one city: the trade icons in its outskirts, with a building
 * replacing the icons of its square. What the Trade phase collects is this summed
 * over the cities; it is an estimate, and `notes` names what it leaves out.
 */
export interface CityTrade {
  readonly outskirts: number
  readonly detail: readonly TradeSquare[]
  /** What the estimate does not count, in plain sentences. Never empty. */
  readonly notes: readonly string[]
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
  /** The trade in the city's outskirts, counted the same way as the production. */
  readonly trade: CityTrade
}

const TERRAIN_PRODUCTION: Readonly<Record<Terrain, number>> = {
  water: 0,
  grassland: 0,
  forest: 2,
  mountain: 1,
  desert: 0,
}

/** The Building Program marker (Wisdom and Warfare p. 7). */
export const BUILDING_PROGRAM_ASSET_ID = 'markers/Building Program'
const CHICHEN_ITZA_ASSET_ID = 'wonders/chichenitza'
const GREAT_LIGHTHOUSE_ASSET_ID = 'wonders/greatlighthouse'

/**
 * The trade printed on each disaster token, read by eye from the token images. A token turns
 * its square into its own terrain and covers what the tile printed there, so the square
 * gives this and not the tile's icon: the Drought (desert) and Water tokens show one trade
 * icon, the Forest and Grassland tokens none.
 */
const DISASTER_TRADE: Readonly<Record<string, number>> = {
  'disasters/drought': 1,
  'disasters/forest': 0,
  'disasters/grassland': 0,
  'disasters/water': 1,
}

const MAX_INFRASTRUCTURE = 3
const DESPOTISM_BONUS = 1
const CHICHEN_ITZA_BONUS = 3
const SUSAN_B_ANTHONY_BONUS = 2
const COINS_PER_MILITARY_SCIENCE_POINT = 3

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

/**
 * The Great Person marker that stands for a square, when everything on it is a marker whose icons are
 * in the data (the one with most production, should old data hold two). `undefined` with a wonder on it,
 * a marker that is not one of the six, or nothing.
 */
function knownGreatPerson(here: readonly BoardPiece[]): BoardPiece | undefined {
  const persons = here.filter((other) => other.category === 'greatperson')
  if (persons.length === 0 || persons.length !== here.length) return undefined
  if (persons.some((person) => greatPersonProductionOf(person.assetId) === undefined)) return undefined
  return persons.reduce((top, candidate) =>
    (greatPersonProductionOf(candidate.assetId) ?? 0) > (greatPersonProductionOf(top.assetId) ?? 0) ? candidate : top,
  )
}

/**
 * What a square gives a city that a scout sends it: the production of the building that
 * stands there (a building replaces every icon of its square), that of a Great Person marker,
 * nothing for a wonder (its icons are not in the data), otherwise the terrain's. The same rules
 * as an outskirts square, without the blockade: a scout may gather a blockaded square.
 */
function scoutSquareProduction(board: Board, cell: Cell): { readonly source: string; readonly amount: number } {
  const here = board.pieces.filter((other) => {
    if (other.category !== 'building' && other.category !== 'wonder' && other.category !== 'greatperson') return false
    const at = mapCellOf(board, other)
    return at !== null && sameCell(at, cell)
  })
  const buildings = here.filter((other) => other.category === 'building')
  if (buildings.length > 0) {
    const best = buildings.reduce((top, candidate) =>
      (buildingDataOf(candidate.assetId)?.production ?? 0) > (buildingDataOf(top.assetId)?.production ?? 0) ? candidate : top,
    )
    return { source: best.label, amount: buildingDataOf(best.assetId)?.production ?? 0 }
  }
  const marker = knownGreatPerson(here)
  if (marker !== undefined) return { source: `${marker.label} (great person)`, amount: greatPersonProductionOf(marker.assetId) ?? 0 }
  if (here.length > 0) return { source: here.some((other) => other.category === 'wonder') ? 'wonder' : 'great person', amount: 0 }
  const terrain = terrainOfCell(board, cell)
  return terrain === null ? { source: 'unknown terrain', amount: 0 } : { source: terrain, amount: TERRAIN_PRODUCTION[terrain] }
}

/** What the map gives a square with nothing standing on it: a disaster token's trade, else the tile's printed icon. */
function bareSquareTrade(board: Board, cell: Cell): { readonly source: string; readonly amount: number } {
  const x = (cell.column + 0.5) * board.squareSize
  const y = mapTop(board) + (cell.row + 0.5) * board.squareSize
  const disaster = disasterAt(board, x, y)
  if (disaster !== undefined) return { source: 'disaster token', amount: DISASTER_TRADE[disaster.assetId] ?? 0 }
  return { source: 'map icon', amount: squareIconsOfCell(board, cell)?.trade ?? 0 }
}

const squareLabel = (cell: Cell): string => `${columnLabel(cell.column)}${cell.row + 1}`

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
  const assignments = scoutDestinationsOf(state, player)
  const cityLabels = new Map(
    footprints.map((footprint) => [footprint.piece.id, `${kindOf(footprint.piece)} ${squareOf(board, footprint.piece) ?? ''}`.trim()] as const),
  )
  if (assignments.length > 0) {
    const toCapital = assignments.some((assignment) => !assignment.chosen)
    playerNotes.push(
      `A square a scout sends is counted for production here${toCapital ? '; a scout you did not send counts for your capital' : ''}. Its culture and resource icons are offered to Devote to the Arts and Harvest of that city; its trade and coin icons are not counted.`,
    )
  } else if (figuresOnMap(state, player, 'scout').length > 0) {
    playerNotes.push(
      'A scout sends its square to a city in the Start of Turn, and goes to the capital when it is not sent. None is counted now, because no capital is marked on the map.',
    )
  }

  return footprints.map((footprint): CityProduction => {
    const { piece, centers, outskirts } = footprint
    const detail: OutskirtsSquare[] = []
    const tradeDetail: TradeSquare[] = []
    const addTrade = (square: string, source: string, icons: number, blockaded: boolean): void => {
      if (icons > 0 && !assignments.some((assignment) => squareLabel(assignment) === square)) {
        tradeDetail.push({ square, source, amount: blockaded ? 0 : icons, blockaded })
      }
    }
    const wonderOrPersonSquares: string[] = []
    // Squares whose trade is not in the data: a wonder, or a great person that is not one of the six markers
    const tradeUnknownSquares: string[] = []
    const unknownSquares: string[] = []
    const doubleBuildingSquares: string[] = []
    const sharedSquares: string[] = []
    let unknownBuilding = false

    const otherOwn = footprints.filter((other) => other.piece.id !== piece.id)

    for (const cell of outskirts) {
      // A city at the edge has outskirts off the map, which are not squares at all.
      if (!isMapCell(board, cell.column, cell.row)) continue
      const square = squareLabel(cell)
      // One of the player's own scouts sends this square to another of their cities: it leaves this one
      const sentAway = assignments.find((assignment) => sameCell(assignment, cell) && assignment.cityPieceId !== piece.id)
      if (sentAway !== undefined) {
        detail.push({
          square,
          source: 'sent by your scout',
          amount: 0,
          blockaded: false,
          sentTo: cityLabels.get(sentAway.cityPieceId) ?? 'another city',
        })
        continue
      }
      const blockaded = footprint.hasEnemyFigureAt(cell)
      // Counted for each city, as old data may overlap; the note says so. Another city's
      // centre is not a shared square: the centre is not outskirts, so only this city counts it.
      if (otherOwn.some((other) => other.outskirts.some((c) => sameCell(c, cell)))) {
        sharedSquares.push(square)
      }

      const here = board.pieces.filter((other) => {
        if (other.category !== 'building' && other.category !== 'wonder' && other.category !== 'greatperson') return false
        const at = mapCellOf(board, other)
        return at !== null && sameCell(at, cell)
      })
      const buildings = here.filter((other) => other.category === 'building')
      const hasWonderOrPerson = here.some((other) => other.category !== 'building')

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
        // The building's trade, not the printed icon's: the most productive one stands for the square
        addTrade(square, best.label, data?.trade ?? 0, blockaded)
        continue
      }

      if (hasWonderOrPerson) {
        // Only here: a square with a building was counted from the building's table row.
        const marker = knownGreatPerson(here)
        if (marker !== undefined) {
          // Like a building, the marker gives the icons printed on it
          const source = `${marker.label} (great person)`
          detail.push({ square, source, amount: blockaded ? 0 : (greatPersonProductionOf(marker.assetId) ?? 0), blockaded })
          addTrade(square, source, greatPersonTradeOf(marker.assetId) ?? 0, blockaded)
          continue
        }
        wonderOrPersonSquares.push(square)
        tradeUnknownSquares.push(square)
        detail.push({ square, source: here.some((other) => other.category === 'wonder') ? 'wonder' : 'great person', amount: 0, blockaded })
        continue
      }

      const bare = bareSquareTrade(board, cell)
      addTrade(square, bare.source, bare.amount, blockaded)

      const terrain = terrainOfCell(board, cell)
      if (terrain === null) {
        unknownSquares.push(square)
        detail.push({ square, source: 'unknown terrain', amount: 0, blockaded })
        continue
      }
      const icons = TERRAIN_PRODUCTION[terrain]
      if (icons > 0) detail.push({ square, source: terrain, amount: blockaded ? 0 : icons, blockaded })
    }

    // The squares scouts send to this city from outside its outskirts
    for (const assignment of assignments) {
      if (assignment.cityPieceId !== piece.id || [...centers, ...outskirts].some((cell) => sameCell(cell, assignment))) continue
      const gathered = scoutSquareProduction(board, assignment)
      detail.push({
        square: squareLabel(assignment),
        source: `${gathered.source}, sent by your scout`,
        amount: gathered.amount,
        blockaded: false,
        scout: true,
      })
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
      const one = doubleBuildingSquares.length === 1
      notes.push(
        `${listSquares(doubleBuildingSquares)} ${one ? 'holds' : 'hold'} more than one building. Only the one with most production counts.`,
      )
    }
    if (sharedSquares.length > 0) {
      notes.push(
        sharedSquares.length === 1
          ? `${listSquares(sharedSquares)} also belongs to another of your cities. It counts for each city.`
          : `${listSquares(sharedSquares)} also belong to another of your cities. They count for each city.`,
      )
    }
    notes.push(...playerNotes)

    const tradeNotes = [
      'Not a complete count: only the trade icons printed on the map and in the building table. Trade from governments, techs, social policies, wonders, the abilities of Great Person cards and event cards is not counted, and neither is any limit on how much trade is collected.',
    ]
    if (tradeUnknownSquares.length > 0) {
      tradeNotes.push(
        `${listSquares(tradeUnknownSquares)} hold${tradeUnknownSquares.length === 1 ? 's' : ''} a wonder, whose trade is not in the data and counts as 0.`,
      )
    }
    if (unknownBuilding) tradeNotes.push('A building in the outskirts is not in the building table and counts as 0.')
    if (doubleBuildingSquares.length > 0) {
      tradeNotes.push(
        `${listSquares(doubleBuildingSquares)} ${doubleBuildingSquares.length === 1 ? 'holds' : 'hold'} more than one building. Only the one with most production counts.`,
      )
    }
    if (sharedSquares.length > 0) {
      tradeNotes.push(
        sharedSquares.length === 1
          ? `${listSquares(sharedSquares)} also belongs to another of your cities. It counts for each city.`
          : `${listSquares(sharedSquares)} also belong to another of your cities. They count for each city.`,
      )
    }
    if (assignments.length > 0) {
      tradeNotes.push('A square a scout sends counts for no trade, here or in the city it is sent to.')
    }
    const tradeOutskirts = tradeDetail.reduce((total, entry) => total + entry.amount, 0)

    return {
      pieceId: piece.id,
      label: cityLabels.get(piece.id) ?? `${kindOf(piece)} ${squareOf(board, piece) ?? ''}`.trim(),
      outskirts: outskirtsTotal,
      outskirtsDetail: detail,
      modifiers,
      buildingProgram,
      estimate,
      withBuildingProgram: buildingProgram ? outskirtsTotal * 2 + modifierTotal : null,
      override,
      effective: override ?? estimate,
      notes,
      trade: { outskirts: tradeOutskirts, detail: tradeDetail, notes: tradeNotes },
    }
  })
}
