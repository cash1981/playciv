/**
 * The culture events that put a disaster token on one map square: Drought (desert side),
 * Deforestation (grassland side) and Flooding (water side). The token makes the square that
 * terrain for the rest of the game (`DISASTER_TERRAIN`, newest token wins).
 *
 * Squares, from the card texts and the human's unofficial rulings:
 * - Drought: any non-mountain square (a water or desert square too) with no building or wonder.
 * - Deforestation: a forest square with no building or wonder.
 * - Both may hold a Great Person marker, a hut or village token, a city-state or city marker,
 *   another figure or earlier disaster tokens (the token goes under them), but never a relic
 *   token that is still on the map. Resource tokens do not block.
 * - Flooding (rulings 269-271): a non-mountain square (water too) with no figure, hut, village,
 *   relic token or Great Person marker and no disaster token (a disaster counts as a token; the
 *   ruling 271** variant that allows one is not implemented). Buildings, wonders, cities and
 *   city-states are not in the ruling's list, so they do not block it; the token goes under them.
 *
 * The token goes under every piece already on the square, so it survives the piece being killed
 * or removed. The engine lists the legal squares and checks the chosen one again on submit.
 */

import { mapCellOf } from './blockade.js'
import type { Cell } from './blockade.js'
import { blockingCells } from './empty-square.js'
import { isMapCell, findBoardAsset } from './board.js'
import type { BoardPiece } from './board.js'
import { placeUnchecked } from './actions/board.js'
import { squareCentre, squareLabel } from './build-options.js'
import { terrainAt } from './terrain.js'
import type { Terrain } from './terrain.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { GameState } from './state.js'

interface DisasterSpec {
  readonly assetId: string
  /** The terrain a legal square has now, or `null` for any except mountain. */
  readonly needs: Terrain | null
  /** What blocks the square, besides the terrain. */
  readonly blockedBy: 'buildings' | 'tokens'
}

const DISASTERS: ReadonlyMap<string, DisasterSpec> = new Map([
  ['Drought', { assetId: 'disasters/drought', needs: null, blockedBy: 'buildings' }],
  ['Deforestation', { assetId: 'disasters/grassland', needs: 'forest', blockedBy: 'buildings' }],
  ['Flooding', { assetId: 'disasters/water', needs: null, blockedBy: 'tokens' }],
])

export const DISASTER_CARDS: ReadonlySet<string> = new Set(DISASTERS.keys())

/** A square the token may go on, as the client lists it. */
export interface DisasterSquare {
  readonly column: number
  readonly row: number
  readonly label: string
}

/** What was placed, kept on the record so an undo takes off exactly this token. */
export interface DisasterEffect {
  readonly pieceId: string
  readonly historyId: string
  readonly square: DisasterSquare
}

const HUT_AND_VILLAGE: ReadonlySet<string> = new Set(['resources/hut', 'resources/village'])
/** The pieces the token goes under, when they stand on its square. */
const COVERS: ReadonlySet<string> = new Set(['figure', 'greatperson', 'citystate', 'city', 'building', 'wonder', 'relic'])
/** A disaster token lies on its square without covering it: a later token goes on top of it, and Flooding is refused on it. */
const isDisaster = (piece: BoardPiece): boolean => piece.category === 'disaster'

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

/** Every piece that stands on a map square, by square, with its place in the stack. */
function piecesBySquare(state: GameState): ReadonlyMap<string, readonly { readonly piece: BoardPiece; readonly index: number }[]> {
  const bySquare = new Map<string, { piece: BoardPiece; index: number }[]>()
  state.board.pieces.forEach((piece, index) => {
    const standsOn =
      COVERS.has(piece.category) || HUT_AND_VILLAGE.has(piece.assetId) || isDisaster(piece)
        ? piece.category === 'city'
          ? blockingCells(state.board, piece)
          : [mapCellOf(state.board, piece)].filter((cell): cell is Cell => cell !== null)
        : []
    for (const cell of standsOn) bySquare.set(keyOf(cell), [...(bySquare.get(keyOf(cell)) ?? []), { piece, index }])
  })
  return bySquare
}

type Scene = ReadonlyMap<string, readonly { readonly piece: BoardPiece; readonly index: number }[]>

/** Why the token cannot go on this square, or `undefined` when it can. */
function problemOf(state: GameState, scene: Scene, name: string, spec: DisasterSpec, cell: Cell): string | undefined {
  const where = squareLabel(cell)
  if (!Number.isInteger(cell.column) || !Number.isInteger(cell.row) || !isMapCell(state.board, cell.column, cell.row)) {
    return `${where} is not a square of the map.`
  }
  const centre = squareCentre(state.board, cell)
  const terrain = terrainAt(state.board, centre.x, centre.y)
  if (terrain === null) return `${where} has no known terrain (no tile, or a tile that is still facedown).`
  if (terrain === 'mountain') return `${where} is a mountain square, and ${name} cannot go on a mountain.`
  if (spec.needs !== null && terrain !== spec.needs) {
    return `${where} is a ${terrain} square, and ${name} needs a ${spec.needs} square.`
  }
  const here = (scene.get(keyOf(cell)) ?? []).map((entry) => entry.piece)
  const relic = here.find((piece) => piece.category === 'relic')
  if (relic !== undefined) return `${where} holds the ${relic.label} relic token. Take the relic first.`
  if (spec.blockedBy === 'buildings') {
    const built = here.find((piece) => piece.category === 'building' || piece.category === 'wonder')
    if (built !== undefined) return `${where} holds a ${built.category} (${built.label}), and ${name} needs a square with no building or wonder.`
  } else {
    const occupant = here.find(
      (piece) =>
        piece.category === 'figure' || piece.category === 'greatperson' || HUT_AND_VILLAGE.has(piece.assetId) || isDisaster(piece),
    )
    if (occupant !== undefined) {
      return `${where} holds ${occupant.label}, and ${name} needs a square with no figure, hut, village or Great Person marker and no disaster token.`
    }
  }
  return undefined
}

/** The squares the card's token may go on now, in reading order. Empty for a card that is not a disaster. */
export function disasterSquaresOf(state: GameState, name: string): readonly DisasterSquare[] {
  const spec = DISASTERS.get(name)
  if (spec === undefined) return []
  const scene = piecesBySquare(state)
  const squares: DisasterSquare[] = []
  for (let row = 0; row < state.board.rows; row += 1) {
    for (let column = 0; column < state.board.columns; column += 1) {
      const cell = { column, row }
      if (isMapCell(state.board, column, row) && problemOf(state, scene, name, spec, cell) === undefined) {
        squares.push({ column, row, label: squareLabel(cell) })
      }
    }
  }
  return squares
}

export interface AppliedDisaster {
  readonly state: GameState
  readonly effect: DisasterEffect
  readonly said: string
}

/** Puts the card's token on the chosen square, under what stands there. `Err` is a sentence for the player. */
export function applyDisaster(
  state: GameState,
  playerId: string,
  name: string,
  chosen: Cell | undefined,
  at: string | undefined,
): Result<AppliedDisaster, string> {
  const spec = DISASTERS.get(name)
  if (spec === undefined) return err(`${name} is not a disaster card.`)
  if (chosen === undefined) return err('Choose the square for the disaster token on the map.')
  const cell = { column: chosen.column, row: chosen.row }
  const scene = piecesBySquare(state)
  const problem = problemOf(state, scene, name, spec, cell)
  if (problem !== undefined) return err(problem)
  const asset = findBoardAsset(spec.assetId)
  if (asset === undefined) return err(`The ${name} token has no artwork to put on the board.`)

  // Under the lowest piece on the square, so it is still there when a figure is killed, but above every disaster token
  // already there (the newest decides the terrain, also when a hand-placed token lies above a city); on top when nothing stands there
  const here = scene.get(keyOf(cell)) ?? []
  const covers = here.filter((entry) => !isDisaster(entry.piece)).map((entry) => entry.index)
  const disasters = here.filter((entry) => isDisaster(entry.piece)).map((entry) => entry.index)
  const index = covers.length === 0 ? undefined : Math.max(Math.min(...covers), ...disasters.map((at) => at + 1))
  const centre = squareCentre(state.board, cell)
  const placed = placeUnchecked(state, {
    playerId,
    assetId: spec.assetId,
    x: centre.x - asset.width / 2,
    y: centre.y - asset.height / 2,
    ...(index === undefined ? {} : { index }),
    ...(at === undefined ? {} : { at }),
  })
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
    return err(`The ${name} token could not be placed on ${squareLabel(cell)}.`)
  }
  const landed = mapCellOf(placed.board, entry.change.piece)
  if (landed === null || landed.column !== cell.column || landed.row !== cell.row) {
    return err(`The ${name} token could not be placed on ${squareLabel(cell)}.`)
  }
  const where = squareLabel(cell)
  return ok({
    state: placed,
    effect: { pieceId: entry.change.piece.id, historyId: entry.id, square: { ...cell, label: where } },
    said: `, placing a disaster token on ${where}, which is now ${spec.assetId === 'disasters/drought' ? 'a desert' : spec.assetId === 'disasters/water' ? 'a water' : 'a grassland'} square`,
  })
}
