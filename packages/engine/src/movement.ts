/**
 * Figure movement on the map (issue #302).
 *
 * A player's own army or scout steps one map square north, west, south or east
 * at a time. Its travel speed is the total of the `mvmt` status expression plus
 * the bonuses the rules and faceup cards add. Water is entered only with a
 * revealed Sailing, Steam Power or Flight; England may cross it but not end
 * there.
 *
 * Nothing here is saved: the destinations are derived from the board and the
 * player every time. What is saved on the piece is how much of this turn's
 * allowance it has used and whether it is locked, in `BoardPiece.movement`.
 * The turn number makes a stale value fresh again on the next turn without a
 * reset step.
 */

import { cityCenterCells, mapCellOf, pieceColorOf } from './blockade.js'
import type { Cell } from './blockade.js'
import type { Board, BoardPiece, PieceMovement } from './board.js'
import { columnLabel, isMapCell, mapTop, whiteFigureCivilization } from './board.js'
import { WATER_TECHS } from './build-options.js'
import { terrainAt } from './terrain.js'
import { isEmptySquare } from './empty-square.js'
import { exploreTargetsFrom, isUnexploredCell } from './explore.js'

/**
 * The parts of a player the movement rules read. Narrower than `Playerhand` so
 * the client can pass its own view of the seat without importing private fields.
 */
export interface MovementPlayer {
  readonly color: string | null
  readonly civilization: { readonly name: string } | null
  readonly stats: { readonly mvmt: string }
  readonly items: readonly {
    readonly kind: string
    readonly name?: string | null
    readonly hidden: boolean
  }[]
  readonly activeGreatPersonNames?: readonly string[]
  /**
   * The effective stacking limit (status number plus a faceup Louis Pasteur). Unknown
   * counts as 1, which keeps every occupied square closed as it was before stacking.
   */
  readonly stackingLimit?: number
  readonly socialPolicies: readonly { readonly name: string; readonly hidden: boolean }[]
  readonly techsChosen: readonly { readonly name: string; readonly hidden: boolean }[]
  readonly government?: string
  readonly playerTurns: readonly {
    readonly turnNumber: number
    readonly usedActions: readonly string[]
  }[]
}

/** One square a figure can reach, and the cardinal distance to it. */
export interface MovementDestination extends Cell {
  readonly label: string
  readonly distance: number
  /** Another player's figures stand here: moving in ends the move and starts a battle, settled by hand. */
  readonly contact?: boolean
  /** Landing here ends the figure's movement for the turn: a hut, a village or another player's figures. */
  readonly ends?: boolean
}

/** What the board and the movement panel need to know about one figure. */
export interface FigureMovementOptions {
  readonly speed: number
  readonly used: number
  readonly remaining: number
  readonly locked: boolean
  /** True when Communism locks the figure's starting square: it may not leave. */
  readonly squareLocked?: boolean
  readonly destinations: readonly MovementDestination[]
  /**
   * The unexplored squares next to the figure that it can explore for 1 movement: empty when
   * it has none left or a card has locked it. Exploring does not move or lock the figure.
   */
  readonly explore: readonly MovementDestination[]
}

/** The turn value bookkeeping for a piece, or `null` when it has none. */
export const movementOf = (piece: BoardPiece, turnNumber: number): PieceMovement | null =>
  piece.movement?.turn === turnNumber ? piece.movement : null

/** The total of a Movement expression such as `3+1`. */
export function movementTotal(expression: string): number {
  return expression
    .split('+')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part >= 0)
    .reduce((total, part) => total + part, 0)
}

/**
 * The travel speed a revealed tech gives (human, 2026-11-14): Horseback Riding 3, Sailing 4, Steam Power 5, Flight 6. The highest
 * one counts; they do not add up. A tech not listed gives no speed of its own.
 */
export const TECH_SPEEDS: Readonly<Record<string, number>> = { 'Horseback Riding': 3, Sailing: 4, 'Steam Power': 5, Flight: 6 }

/** The speed the player's revealed techs give, and the tech that gives it, or `null` when none does. */
export function techSpeedOf(techs: readonly { readonly name: string; readonly hidden: boolean }[]): { readonly speed: number; readonly tech: string } | null {
  let best: { readonly speed: number; readonly tech: string } | null = null
  for (const tech of techs) {
    const speed = tech.hidden ? undefined : TECH_SPEEDS[tech.name]
    if (speed !== undefined && (best === null || speed > best.speed)) best = { speed, tech: tech.name }
  }
  return best
}

/**
 * The stacking limit a revealed tech gives (human, 2026-11-15): Masonry 3, Printing Press 4, Biology 5, Replacement Parts 6. The
 * highest one counts; they do not add up. A tech not listed gives no limit of its own.
 */
export const TECH_STACKING: Readonly<Record<string, number>> = { Masonry: 3, 'Printing Press': 4, Biology: 5, 'Replacement Parts': 6 }

/** The stacking limit the player's revealed techs give, and the tech that gives it, or `null` when none does. */
export function techStackingOf(techs: readonly { readonly name: string; readonly hidden: boolean }[]): { readonly limit: number; readonly tech: string } | null {
  let best: { readonly limit: number; readonly tech: string } | null = null
  for (const tech of techs) {
    const limit = tech.hidden ? undefined : TECH_STACKING[tech.name]
    if (limit !== undefined && (best === null || limit > best.limit)) best = { limit, tech: tech.name }
  }
  return best
}

/**
 * The typed Movement split into its base (the first term), its bonus (every `+` term after it: how Natural Religion is typed,
 * `3+1`) and, for Spain, the +1 that is part of the base (typed `3`). A revealed tech replaces the base when it gives more; the bonus is added on top.
 */
export function splitMovement(
  expression: string,
  spanish = false,
): { readonly base: number; readonly bonus: number; readonly spain: number } {
  const parts = expression
    .split('+')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part >= 0)
  const [typedBase = 0, ...rest] = parts
  // Spain's +1 is part of the typed base (`3`, not `2+1`): it is taken out here so a tech replaces only the 2 and the +1 goes on top.
  // A `+` term after it is still the army-only Natural Religion convention (`3+1`).
  const spain = spanish && typedBase > 0 ? 1 : 0
  return { base: typedBase - spain, bonus: rest.reduce((total, part) => total + part, 0), spain }
}

/** What figure ownership needs to know: the seat's colour and civilization. */
export type FigureOwner = Pick<MovementPlayer, 'color' | 'civilization'>

/** Whether the piece is this player's own army or scout: its colour, or the white figure of its civ. */
export function figureBelongsTo(player: FigureOwner, piece: BoardPiece): boolean {
  if (piece.category !== 'figure') return false
  const white = whiteFigureCivilization(piece.assetId)
  if (white !== undefined) return player.civilization?.name === white
  return player.color !== null && pieceColorOf(piece) === player.color.toLowerCase()
}

const isArmy = (piece: BoardPiece): boolean => piece.assetId.endsWith('army')

/** A faceup Great Person card of the player. */
const hasFaceup = (player: MovementPlayer, name: string): boolean =>
  player.items.some((item) => item.kind === 'greatperson' && item.name === name && !item.hidden)

const hasActiveGreatPerson = (player: MovementPlayer, name: string): boolean =>
  player.activeGreatPersonNames === undefined
    ? hasFaceup(player, name)
    : player.activeGreatPersonNames.includes(name)

/** A revealed social policy of the player; a chosen but hidden one has no effect. */
const hasPolicy = (player: MovementPlayer, name: string): boolean =>
  player.socialPolicies.some((policy) => policy.name === name && !policy.hidden)

/** Under Anarchy, the player's social policies have no effect. */
const inAnarchy = (player: MovementPlayer): boolean => player.government === 'Anarchy'

/** A revealed tech of the player, the same visibility Build uses for water. */
const hasRevealedTech = (player: MovementPlayer, name: string): boolean =>
  player.techsChosen.some((tech) => tech.name === name && !tech.hidden)

/**
 * The player's travel speed: the larger of the typed base and what the revealed techs give (`techSpeedOf`), plus the typed
 * bonus (Natural Religion as typed, `3+1`), Spain's +1, plus Natural Religion for an army (group movement is not implemented, so every army move is
 * individual), plus Henry Ford while his card is faceup, doubled by Captain James Cook for this turn.
 */
export function travelSpeedOf(player: MovementPlayer, piece: BoardPiece, turnNumber: number): number {
  const typed = splitMovement(player.stats.mvmt, player.civilization?.name === 'Spanish')
  const naturalReligion = hasPolicy(player, 'Natural Religion') && !inAnarchy(player)
  // Natural Religion is army-only. A `+` in the typed expression is the players'
  // existing way of recording it (issue #102, `3+1`), so that expression is the
  // army's speed and already includes the bonus: a scout gives one point of it
  // back. Without a `+` the engine adds the bonus to an army itself.
  const spain = typed.spain
  const typedBonus = typed.bonus
  let bonus = typedBonus
  if (naturalReligion) {
    if (typedBonus === 0) {
      if (isArmy(piece)) bonus = 1
    } else if (!isArmy(piece)) {
      bonus = Math.max(0, typedBonus - 1)
    }
  }
  let speed = Math.max(typed.base, techSpeedOf(player.techsChosen)?.speed ?? 0) + bonus + spain
  if (hasActiveGreatPerson(player, 'Henry Ford')) speed += 1
  const cook = player.playerTurns
    .find((turn) => turn.turnNumber === turnNumber)
    ?.usedActions.includes('card:Captain James Cook')
  return cook === true ? speed * 2 : speed
}

/** How the player treats water: neither, crossing only (England), or crossing and ending. */
export interface WaterAllowed {
  readonly cross: boolean
  readonly end: boolean
}

function waterRulesOf(player: MovementPlayer): WaterAllowed {
  const tech = WATER_TECHS.some((name) => hasRevealedTech(player, name))
  if (tech) return { cross: true, end: true }
  // Navigation: "You may cross water, but you may not end your movement in it." Like England's navy, except that a figure may
  // stop in water that touches fog, to explore from there (see `mayEndHere` in `figureMovementOptions`).
  if (hasRevealedTech(player, 'Navigation')) return { cross: true, end: false }
  // England's navy: "English figures may cross water, but may not end their movement in it."
  return player.civilization?.name === 'England' ? { cross: true, end: false } : { cross: false, end: false }
}

/** The centre of a map cell, for the terrain lookup. */
const centreOf = (board: Board, cell: Cell): readonly [number, number] => [
  cell.column * board.squareSize + board.squareSize / 2,
  mapTop(board) + cell.row * board.squareSize + board.squareSize / 2,
]

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

/**
 * The squares a metropolis covers. Its expansion square may be water, and "the square is no longer considered to be water for
 * purposes of movement" (Fame and Fortune p. 10: a makeshift bridge), so these squares are land for every move.
 */
export function metropolisSquares(board: Board): ReadonlySet<string> {
  const squares = new Set<string>()
  for (const piece of board.pieces) {
    if (piece.category !== 'city' || !piece.assetId.includes('metropolis')) continue
    for (const cell of cityCenterCells(board, piece) ?? []) squares.add(keyOf(cell))
  }
  return squares
}

/** Whether a square is water for movement: water terrain, unless a metropolis stands on it. */
const isWaterForMovement = (board: Board, cell: Cell, bridges: ReadonlySet<string>): boolean => {
  const [x, y] = centreOf(board, cell)
  return terrainAt(board, x, y) === 'water' && !bridges.has(keyOf(cell))
}

/** The map squares holding a piece that matches `wanted`. */
function pieceSquares(board: Board, wanted: (piece: BoardPiece) => boolean): ReadonlySet<string> {
  const squares = new Set<string>()
  for (const piece of board.pieces) {
    if (!wanted(piece)) continue
    const column = Math.floor((piece.x + piece.width / 2) / board.squareSize)
    const row = Math.floor((piece.y + piece.height / 2 - mapTop(board)) / board.squareSize)
    if (isMapCell(board, column, row)) squares.add(`${column},${row}`)
  }
  return squares
}

/** The squares occupied by figures: another figure is not a destination in this slice. */
const figureSquares = (board: Board): ReadonlySet<string> =>
  pieceSquares(board, (piece) => piece.category === 'figure')

/** How the figures on the map sit relative to one player: their own per square, and the squares of anyone else's. */
export interface Occupancy {
  readonly own: ReadonlyMap<string, number>
  readonly foreign: ReadonlySet<string>
}

export function occupancyOf(board: Board, owner: FigureOwner): Occupancy {
  const own = new Map<string, number>()
  const foreign = new Set<string>()
  for (const piece of board.pieces) {
    if (piece.category !== 'figure') continue
    const cell = mapCellOf(board, piece)
    if (cell === null) continue
    const key = keyOf(cell)
    if (figureBelongsTo(owner, piece)) own.set(key, (own.get(key) ?? 0) + 1)
    else foreign.add(key)
  }
  return { own, foreign }
}

/** The resource markers a figure must stop on: it may not walk past a hut or village without Flight. */
const HUT_AND_VILLAGE_ASSETS: ReadonlySet<string> = new Set(['resources/hut', 'resources/village'])

const hutAndVillageSquares = (board: Board): ReadonlySet<string> =>
  pieceSquares(board, (piece) => HUT_AND_VILLAGE_ASSETS.has(piece.assetId))

/**
 * The squares a scout may not enter (base rules p. 15 and 20, Fame and Fortune p. 9): a hut or village, and a relic
 * square unless an army of the player already stands there. Flight and a Republic make no difference. A revealed
 * Pacifism ("Your scouts can explore huts, but not villages") lets scouts onto huts; it does not help on relics,
 * which the Wisdom and Warfare rules name expressly.
 */
function scoutForbiddenSquares(board: Board, player: MovementPlayer): ReadonlySet<string> {
  const accompanied = pieceSquares(board, (piece) => figureBelongsTo(player, piece) && isArmy(piece))
  const relics = pieceSquares(board, (piece) => piece.category === 'relic')
  const huts = hasPolicy(player, 'Pacifism') && !inAnarchy(player) ? new Set<string>() : pieceSquares(board, (piece) => piece.assetId === 'resources/hut')
  const villages = pieceSquares(board, (piece) => piece.assetId === 'resources/village')
  return new Set([...huts, ...villages, ...[...relics].filter((key) => !accompanied.has(key))])
}

/**
 * The movement options for one of the player's figures, or `null` when the
 * piece is not their figure on the map.
 */
export function figureMovementOptions(
  board: Board,
  player: MovementPlayer,
  piece: BoardPiece,
  turnNumber: number,
  lockedCells: readonly Cell[] = [],
  forbiddenCells: readonly Cell[] = [],
): FigureMovementOptions | null {
  if (!figureBelongsTo(player, piece)) return null
  const start: Cell = {
    column: Math.floor((piece.x + piece.width / 2) / board.squareSize),
    row: Math.floor((piece.y + piece.height / 2 - mapTop(board)) / board.squareSize),
  }
  if (!isMapCell(board, start.column, start.row)) return null

  const saved = movementOf(piece, turnNumber)
  const used = saved?.used ?? 0
  const locked = saved?.locked ?? false
  const speed = travelSpeedOf(player, piece, turnNumber)
  const remaining = Math.max(0, speed - used)
  const squareLocked = lockedCells.some((cell) => keyOf(cell) === keyOf(start))
  // A lock (a move that ended on a hut, village or enemy, a spent allowance, Galileo, Steam Power) means no more
  // movement this turn, and exploring is movement.
  const cardLocked = saved?.locked === true
  const explore: MovementDestination[] =
    remaining >= 1 && !cardLocked
      ? exploreTargetsFrom(board, start).map((cell) => ({
          ...cell,
          label: `${columnLabel(cell.column)}${cell.row + 1}`,
          distance: 1,
        }))
      : []
  if (squareLocked) return { speed, used, remaining, locked, squareLocked: true, destinations: [], explore }
  if (locked || remaining === 0) return { speed, used, remaining, locked, destinations: [], explore }

  const rules = figureRulesOf(board, player, piece, lockedCells, forbiddenCells)
  const distances = new Map<string, number>([[keyOf(start), 0]])
  const queue: Cell[] = [start]
  const destinations: MovementDestination[] = []

  while (queue.length > 0) {
    const cell = queue.shift() as Cell
    const distance = distances.get(keyOf(cell)) ?? 0
    if (distance > 0) {
      const destination = rules.endingAt(cell, distance, remaining)
      if (destination !== undefined) destinations.push(destination)
    }
    // The allowance left, not the whole speed: exploring spends 1 without locking the figure
    if (distance >= remaining) continue
    if (distance > 0 && !rules.canLeave(cell)) continue
    for (const next of neighboursOf(cell)) {
      if (distances.has(keyOf(next)) || !rules.canEnter(next)) continue
      distances.set(keyOf(next), distance + 1)
      queue.push(next)
    }
  }

  destinations.sort((a, b) => a.distance - b.distance || a.row - b.row || a.column - b.column)
  return { speed, used, remaining, locked, destinations, explore }
}

const NEIGHBOUR_STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const

const neighboursOf = (cell: Cell): readonly Cell[] =>
  NEIGHBOUR_STEPS.map(([dc, dr]) => ({ column: cell.column + dc, row: cell.row + dr }))

/** The per-square rules of one figure's travel, shared by the reachable-square search and route checks. */
interface FigureRules {
  /** Whether the figure may step onto the square (not necessarily end there). */
  readonly canEnter: (cell: Cell) => boolean
  /** Whether a figure that has already travelled onto the square may carry on from it. */
  readonly canLeave: (cell: Cell) => boolean
  /** The destination the figure may end its move on after `distance` squares, or `undefined` when it may not end there. */
  readonly endingAt: (cell: Cell, distance: number, remaining: number) => MovementDestination | undefined
}

function figureRulesOf(
  board: Board,
  player: MovementPlayer,
  piece: BoardPiece,
  lockedCells: readonly Cell[],
  forbiddenCells: readonly Cell[],
): FigureRules {
  const water = waterRulesOf(player)
  const flight = hasRevealedTech(player, 'Flight')
  const occupancy = occupancyOf(board, player)
  const bridges = metropolisSquares(board)
  const limit = Math.max(1, player.stackingLimit ?? 1)
  const lockedKeys = new Set(lockedCells.map(keyOf))
  const forbiddenKeys = new Set(forbiddenCells.map(keyOf))
  // Stacking limit is absolute (rule 50): a square already at it cannot be crossed or ended on.
  // An army may end its move on another player's figures: the move ends there and a battle starts, which
  // (like loot) is settled by hand. A scout never attacks (rule 431). Without Flight another player's
  // figures cannot be crossed (rule 52), so the move ends on their square.
  const attacker = isArmy(piece)
  const hasRoom = (key: string): boolean => (occupancy.own.get(key) ?? 0) < limit
  const mustStop = hutAndVillageSquares(board)
  const scoutForbidden = attacker ? new Set<string>() : scoutForbiddenSquares(board, player)

  return {
    canEnter: (next) => {
      if (!isMapCell(board, next.column, next.row)) return false
      // A scout never attacks, so it does not enter another player's square at all without Flight.
      // A square at the stacking limit cannot be crossed either.
      if (occupancy.foreign.has(keyOf(next)) && !flight && !attacker) return false
      if (scoutForbidden.has(keyOf(next))) return false
      if (!hasRoom(keyOf(next))) return false
      // Fog is not walked onto: it is explored first, from the square next to it.
      if (isUnexploredCell(board, next)) return false
      return !(isWaterForMovement(board, next, bridges) && !water.cross)
    },
    canLeave: (cell) => {
      // A figure may enter a Communism-locked square but never leave it.
      if (lockedKeys.has(keyOf(cell))) return false
      // A hut or village ends the move: the figure may land there but not pass it.
      // A revealed Flight flies over, so it neither stops nor blocks the squares beyond. It may also land
      // there instead: that ends the move like any landing. Ruling 283 (cross but never end) belongs to the
      // Migrants, Colonists and Immigrants cards, whose moves are `cardMoveDestinations`, not to ordinary travel.
      if (!flight && mustStop.has(keyOf(cell))) return false
      // Landing on another player's figures ends the move unless Flight flies over them (rule 52)
      return flight || !occupancy.foreign.has(keyOf(cell))
    },
    endingAt: (cell, distance, remaining) => {
      // A figure that may only cross water (Navigation, England) still stops in it next to fog, to open the tile there, but only
      // with movement left to explore with (1); the next move takes it out to land.
      const mayEndHere = isWaterForMovement(board, cell, bridges)
        ? water.end || (distance < remaining && exploreTargetsFrom(board, cell).length > 0)
        : true
      const key = keyOf(cell)
      if (
        !mayEndHere ||
        !(attacker || !occupancy.foreign.has(key)) ||
        forbiddenKeys.has(key) ||
        !hasRoom(key)
      ) {
        return undefined
      }
      return {
        column: cell.column,
        row: cell.row,
        label: `${columnLabel(cell.column)}${cell.row + 1}`,
        distance,
        ...(occupancy.foreign.has(key) ? { contact: true } : {}),
        ...(occupancy.foreign.has(key) || mustStop.has(key) ? { ends: true } : {}),
      }
    },
  }
}

/** The result of checking or planning a route: the full square list and where it ends, or why it is not legal. */
export type RouteResult =
  | {
      readonly ok: true
      /** The squares entered, in order, excluding the start. Its length is the movement charged. */
      readonly route: readonly Cell[]
      readonly destination: MovementDestination
    }
  | { readonly ok: false; readonly reason: string }

const labelOf = (cell: Cell): string => `${columnLabel(cell.column)}${cell.row + 1}`

/** What stops a figure from travelling at all this turn, or `null` when it may set off. */
function travelBlock(
  board: Board,
  player: MovementPlayer,
  piece: BoardPiece,
  turnNumber: number,
  lockedCells: readonly Cell[],
): { readonly start: Cell; readonly remaining: number } | string {
  if (!figureBelongsTo(player, piece)) return `${piece.label} is not one of your figures on the map.`
  const start = mapCellOf(board, piece)
  if (start === null) return `${piece.label} is not on the map.`
  const saved = movementOf(piece, turnNumber)
  if (lockedCells.some((cell) => keyOf(cell) === keyOf(start))) {
    return `${piece.label} is locked on ${labelOf(start)} and may not leave its square this turn.`
  }
  if (saved?.locked === true) {
    return `${piece.label} has no movement left this turn. Undo a move on the board to move it again.`
  }
  const remaining = Math.max(0, travelSpeedOf(player, piece, turnNumber) - (saved?.used ?? 0))
  if (remaining === 0) return `${piece.label} has no movement left this turn.`
  return { start, remaining }
}

/**
 * Checks an explicit route: the squares a figure enters, one cardinal step at a time, ending on its
 * destination. Every square is held to the rule travel applies (crossing differs from ending: a hut,
 * water for England or another player's figures may be crossed or not, but not ended on), no square
 * repeats, and the route's own length, not the shortest distance, must fit the movement left.
 */
export function checkRoute(
  board: Board,
  player: MovementPlayer,
  piece: BoardPiece,
  turnNumber: number,
  route: readonly Cell[],
  lockedCells: readonly Cell[] = [],
  forbiddenCells: readonly Cell[] = [],
): RouteResult {
  const blocked = travelBlock(board, player, piece, turnNumber, lockedCells)
  if (typeof blocked === 'string') return { ok: false, reason: blocked }
  if (route.length === 0) return { ok: false, reason: 'A route needs at least one square.' }
  if (route.length > blocked.remaining) {
    return {
      ok: false,
      reason: `That route takes ${route.length} movement, but ${piece.label} has ${blocked.remaining} left this turn.`,
    }
  }
  const rules = figureRulesOf(board, player, piece, lockedCells, forbiddenCells)
  const seen = new Set<string>([keyOf(blocked.start)])
  let previous = blocked.start
  for (const [index, cell] of route.entries()) {
    if (
      !Number.isInteger(cell.column) ||
      !Number.isInteger(cell.row) ||
      Math.abs(cell.column - previous.column) + Math.abs(cell.row - previous.row) !== 1
    ) {
      return { ok: false, reason: `${labelOf(cell)} is not next to ${labelOf(previous)}: a route moves one square north, west, south or east at a time.` }
    }
    if (seen.has(keyOf(cell))) return { ok: false, reason: `The route passes ${labelOf(cell)} twice.` }
    if (!rules.canEnter(cell)) return { ok: false, reason: `${piece.label} cannot enter ${labelOf(cell)}.` }
    if (index > 0 && !rules.canLeave(previous)) {
      return { ok: false, reason: `${piece.label}'s move ends on ${labelOf(previous)}: it cannot carry on from there.` }
    }
    seen.add(keyOf(cell))
    previous = cell
  }
  const destination = rules.endingAt(previous, route.length, blocked.remaining)
  if (destination === undefined) {
    return { ok: false, reason: `${piece.label} cannot end its move on ${labelOf(previous)}.` }
  }
  return { ok: true, route: route.map(({ column, row }) => ({ column, row })), destination }
}

/**
 * The shortest legal route to `to` that passes through each of `via` in order, for the preview the
 * player confirms. Each leg is the shortest path that keeps the whole route free of repeated squares;
 * a waypoint that forces a longer detour is allowed while the movement left covers it.
 */
export function planRoute(
  board: Board,
  player: MovementPlayer,
  piece: BoardPiece,
  turnNumber: number,
  via: readonly Cell[],
  to: Cell,
  lockedCells: readonly Cell[] = [],
  forbiddenCells: readonly Cell[] = [],
): RouteResult {
  const blocked = travelBlock(board, player, piece, turnNumber, lockedCells)
  if (typeof blocked === 'string') return { ok: false, reason: blocked }
  const rules = figureRulesOf(board, player, piece, lockedCells, forbiddenCells)
  const targets = [...via, to]
  const route: Cell[] = []
  const used = new Set<string>([keyOf(blocked.start)])
  let from = blocked.start
  for (const [index, target] of targets.entries()) {
    // The squares still to be reached are kept free, so an early leg cannot take the square a later one needs
    const taken = new Set([...used, ...targets.slice(index + 1).map(keyOf)])
    const leg = shortestLeg(rules, from, target, taken, route.length, blocked.remaining)
    if (leg === undefined) {
      return { ok: false, reason: `${piece.label} has no legal way to ${labelOf(target)} within ${blocked.remaining} movement${via.length > 0 ? ' through those waypoints' : ''}.` }
    }
    for (const cell of leg) {
      route.push(cell)
      used.add(keyOf(cell))
    }
    from = target
  }
  return checkRoute(board, player, piece, turnNumber, route, lockedCells, forbiddenCells)
}

/** Breadth-first path from `from` to `target` over squares not yet `used`, within the movement left after `travelled`. */
function shortestLeg(
  rules: FigureRules,
  from: Cell,
  target: Cell,
  used: ReadonlySet<string>,
  travelled: number,
  remaining: number,
): readonly Cell[] | undefined {
  if (used.has(keyOf(target))) return undefined
  const parents = new Map<string, Cell | null>([[keyOf(from), null]])
  const queue: { readonly cell: Cell; readonly distance: number }[] = [{ cell: from, distance: 0 }]
  while (queue.length > 0) {
    const { cell, distance } = queue.shift() as { cell: Cell; distance: number }
    if (keyOf(cell) === keyOf(target)) {
      const path: Cell[] = []
      for (let at: Cell | null | undefined = cell; at !== null && at !== undefined && keyOf(at) !== keyOf(from); at = parents.get(keyOf(at))) {
        path.unshift({ column: at.column, row: at.row })
      }
      return path
    }
    if (travelled + distance >= remaining) continue
    // Squares already travelled (not the start of the whole route) may not be carried on from
    if (travelled + distance > 0 && !rules.canLeave(cell)) continue
    for (const next of neighboursOf(cell)) {
      if (parents.has(keyOf(next)) || used.has(keyOf(next)) || !rules.canEnter(next)) continue
      parents.set(keyOf(next), cell)
      queue.push({ cell: next, distance: distance + 1 })
    }
  }
  return undefined
}

/**
 * What a group of the player's figures on one square can do together, for the preview: the squares every one of them
 * can reach (the farthest of their distances), the least movement left and the lowest speed. A square that ends the
 * move of any one of them ends the group's move. `null` when the figures are not all the player's own, not on one
 * square, or fewer than two.
 */
export function groupMovementOptions(
  board: Board,
  player: MovementPlayer,
  pieces: readonly BoardPiece[],
  turnNumber: number,
  lockedCells: readonly Cell[] = [],
  forbiddenCells: readonly Cell[] = [],
): FigureMovementOptions | null {
  if (pieces.length < 2) return null
  const all = pieces.map((piece) => figureMovementOptions(board, player, piece, turnNumber, lockedCells, forbiddenCells))
  const cells = pieces.map((piece) => mapCellOf(board, piece))
  const start = cells[0]
  if (
    all.some((options) => options === null) ||
    start === null ||
    start === undefined ||
    cells.some((cell) => cell === null || cell?.column !== start.column || cell.row !== start.row)
  ) {
    return null
  }
  const options = all as readonly FigureMovementOptions[]
  // The figures arrive one after another, so the whole group must fit under the stacking limit
  const room = groupRoom(board, player, pieces.length)
  const destinations = (options[0] as FigureMovementOptions).destinations.flatMap((destination) => {
    if (!room(destination)) return []
    const matches = options.map((other) =>
      other.destinations.find((candidate) => candidate.column === destination.column && candidate.row === destination.row),
    )
    if (matches.some((match) => match === undefined)) return []
    const distance = Math.max(...matches.map((match) => match?.distance ?? 0))
    // The group ends its move wherever any one of its figures would (a hut, a village, another player's figures)
    const ends = matches.some((match) => match?.ends === true)
    const contact = matches.some((match) => match?.contact === true)
    return [{ ...destination, distance, ...(ends ? { ends: true } : {}), ...(contact ? { contact: true } : {}) }]
  })
  const exploring = (options[0] as FigureMovementOptions).explore.filter((cell) =>
    options.every((other) => other.explore.some((candidate) => candidate.column === cell.column && candidate.row === cell.row)),
  )
  return {
    speed: Math.min(...options.map((entry) => entry.speed)),
    used: Math.max(...options.map((entry) => entry.used)),
    remaining: Math.min(...options.map((entry) => entry.remaining)),
    locked: options.some((entry) => entry.locked),
    ...(options.some((entry) => entry.squareLocked === true) ? { squareLocked: true } : {}),
    destinations: options.some((entry) => entry.locked || entry.squareLocked === true) ? [] : destinations,
    explore: exploring,
  }
}

/** Whether `count` more of the player's figures fit on a square under the stacking limit (rule 50). */
function groupRoom(board: Board, player: MovementPlayer, count: number): (cell: Cell) => boolean {
  const occupancy = occupancyOf(board, player)
  const limit = Math.max(1, player.stackingLimit ?? 1)
  return (cell) => (occupancy.own.get(keyOf(cell)) ?? 0) + count <= limit
}

/**
 * A route every figure of the group can follow, for the preview. Each figure in turn is tried as the one the route is
 * planned for, and the first plan the others accept is used. The reason of the first failure is given when none is.
 */
export function planGroupRoute(
  board: Board,
  player: MovementPlayer,
  pieces: readonly BoardPiece[],
  turnNumber: number,
  via: readonly Cell[],
  to: Cell,
  lockedCells: readonly Cell[] = [],
  forbiddenCells: readonly Cell[] = [],
): RouteResult {
  let failure: RouteResult = { ok: false, reason: 'No figure to move.' }
  for (const lead of pieces) {
    const planned = planRoute(board, player, lead, turnNumber, via, to, lockedCells, forbiddenCells)
    if (!planned.ok) {
      if (!failure.ok && failure.reason === 'No figure to move.') failure = planned
      continue
    }
    if (!groupRoom(board, player, pieces.length)(planned.destination)) {
      return { ok: false, reason: `${planned.destination.label} has no room for all ${pieces.length} figures under the stacking limit.` }
    }
    const refused = pieces
      .filter((piece) => piece.id !== lead.id)
      .map((piece) => checkRoute(board, player, piece, turnNumber, planned.route, lockedCells, forbiddenCells))
      .find((checked) => !checked.ok)
    if (refused === undefined) return planned
    failure = refused
  }
  return failure
}

/** The map cells holding at least one figure of `owner`. */
export function figureSources(board: Board, owner: FigureOwner): readonly Cell[] {
  const sources = new Map<string, Cell>()
  for (const piece of board.pieces) {
    if (!figureBelongsTo(owner, piece)) continue
    const cell = mapCellOf(board, piece)
    if (cell !== null) sources.set(keyOf(cell), cell)
  }
  return [...sources.values()].sort((a, b) => a.row - b.row || a.column - b.column)
}

/**
 * Where, relative to a square's centre and for the usual 94 px square, up to six figures stand so that each can
 * be seen and tapped on its own: the middle first, then beside it, then below and above.
 */
const FIGURE_SLOTS: readonly (readonly [dx: number, dy: number])[] = [
  [0, 0],
  [33, 0],
  [-33, 0],
  [17, 22],
  [-17, 22],
  [0, -22],
]

/**
 * The top-left corner for a figure arriving on `cell`: the first free spot of `FIGURE_SLOTS`, so a figure that
 * arrives on another's square does not hide it. A spot is taken when a figure (any colour) has its centre within
 * 12 px of it, so a stack arranged by hand keeps its places. With all six taken the figure is centred.
 */
export function figureSpotIn(
  board: Board,
  cell: Cell,
  figure: { readonly id: string; readonly width: number; readonly height: number },
): readonly [x: number, y: number] {
  const scale = board.squareSize / 94
  const centreX = (cell.column + 0.5) * board.squareSize
  const centreY = mapTop(board) + (cell.row + 0.5) * board.squareSize
  const standing = board.pieces.filter((piece) => {
    if (piece.category !== 'figure' || piece.id === figure.id) return false
    const at = mapCellOf(board, piece)
    return at !== null && keyOf(at) === keyOf(cell)
  })
  const taken = (dx: number, dy: number): boolean =>
    standing.some(
      (piece) =>
        Math.hypot(piece.x + piece.width / 2 - (centreX + dx * scale), piece.y + piece.height / 2 - (centreY + dy * scale)) < 12 * scale,
    )
  const [dx, dy] = FIGURE_SLOTS.find(([slotX, slotY]) => !taken(slotX, slotY)) ?? [0, 0]
  return [Math.round(centreX + dx * scale - figure.width / 2), Math.round(centreY + dy * scale - figure.height / 2)]
}

/** The owner's figures whose centre is in `cell`. */
export function figuresAt(board: Board, owner: FigureOwner, cell: Cell): readonly BoardPiece[] {
  return board.pieces.filter((piece) => {
    if (!figureBelongsTo(owner, piece)) return false
    const at = mapCellOf(board, piece)
    return at !== null && keyOf(at) === keyOf(cell)
  })
}

/**
 * A figure moved by Galileo or Steam Power in this City Management may not be moved by the
 * movement cards (they "cannot move again this turn").
 */
export const movedByGalileoThisTurn = (piece: BoardPiece, turnNumber: number): boolean => {
  const movement = movementOf(piece, turnNumber)
  return movement?.locked === true && (movement.reason === 'galileo' || movement.reason === 'steamPower')
}

/** Whether a movement culture card may pick the figure this turn. */
export const canCultureMoveFigure = (piece: BoardPiece, turnNumber: number): boolean =>
  !movedByGalileoThisTurn(piece, turnNumber)

/**
 * Destinations for the movement culture cards. The destination must be empty
 * (rules 61 to 63); the path follows the same cardinal, figure-blocking and
 * hut/village rules as travel, with the card's own allowance. `water` is the
 * ordinary travel water rule for the movement cards, and neither crossing nor
 * ending for the group cards, whose text forbids crossing water.
 */
export function cardMoveDestinations(
  board: Board,
  from: Cell,
  allowance: number,
  water: WaterAllowed,
  flight: boolean,
  lockedCells: readonly Cell[] = [],
  forbiddenCells: readonly Cell[] = [],
  /**
   * Who moves, and their stacking limit. With it the path crosses squares as ordinary travel does: the
   * mover's own figures while there is room (rule 50), another player's only with Flight (rule 52). The
   * destination must still be empty. Without it every figure square blocks the path.
   */
  crossing?: { readonly owner: FigureOwner; readonly stackingLimit: number },
): readonly MovementDestination[] {
  if (!isMapCell(board, from.column, from.row)) return []
  const occupancy = crossing === undefined ? undefined : occupancyOf(board, crossing.owner)
  const limit = Math.max(1, crossing?.stackingLimit ?? 1)
  const lockedKeys = new Set(lockedCells.map(keyOf))
  const forbiddenKeys = new Set(forbiddenCells.map(keyOf))
  const bridges = metropolisSquares(board)
  if (lockedKeys.has(keyOf(from))) return []
  const occupied = figureSquares(board)
  const mustStop = hutAndVillageSquares(board)
  const distances = new Map<string, number>([[keyOf(from), 0]])
  const queue: Cell[] = [from]
  const destinations: MovementDestination[] = []

  while (queue.length > 0) {
    const cell = queue.shift() as Cell
    const distance = distances.get(keyOf(cell)) ?? 0
    if (distance > 0) {
      const mayEndHere = isWaterForMovement(board, cell, bridges) ? water.end : true
      if (
        mayEndHere &&
        !occupied.has(keyOf(cell)) &&
        !forbiddenKeys.has(keyOf(cell)) &&
        !(flight && mustStop.has(keyOf(cell))) &&
        isEmptySquare(board, cell)
      ) {
        destinations.push({
          column: cell.column,
          row: cell.row,
          label: `${columnLabel(cell.column)}${cell.row + 1}`,
          distance,
        })
      }
    }
    if (distance >= allowance) continue
    if (distance > 0 && lockedKeys.has(keyOf(cell))) continue
    // A hut or village ends the move unless Flight crosses it; the destination is never on it.
    if (distance > 0 && !flight && mustStop.has(keyOf(cell))) continue
    for (const [dc, dr] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
      const next = { column: cell.column + dc, row: cell.row + dr }
      if (!isMapCell(board, next.column, next.row)) continue
      if (occupancy === undefined) {
        if (occupied.has(keyOf(next))) continue
      } else {
        if (occupancy.foreign.has(keyOf(next)) && !flight) continue
        if ((occupancy.own.get(keyOf(next)) ?? 0) >= limit) continue
      }
      if (isUnexploredCell(board, next)) continue
      if (isWaterForMovement(board, next, bridges) && !water.cross) continue
      if (distances.has(keyOf(next))) continue
      distances.set(keyOf(next), distance + 1)
      queue.push(next)
    }
  }

  destinations.sort((a, b) => a.distance - b.distance || a.row - b.row || a.column - b.column)
  return destinations
}

/** The ordinary water rule for the one-figure movement cards. */
export const cardWaterRulesOf = (player: MovementPlayer): WaterAllowed => waterRulesOf(player)

/** The option for exactly `cell`, or `undefined` when it is not a legal destination. */
export function destinationTo(
  options: FigureMovementOptions,
  cell: Cell,
): MovementDestination | undefined {
  return options.destinations.find(
    (candidate) => candidate.column === cell.column && candidate.row === cell.row,
  )
}

/**
 * Where a figure may be laid when it is shifted inside its own square, so a stack is easier to read:
 * its top-left corner for the wanted spot, or `undefined` when the piece is not on the map or the
 * spot would put its centre in another square. A shift like this is not travel and spends no
 * movement; leaving the square goes through `travelFigure`.
 */
export function arrangeWithinSquare(
  board: Board,
  piece: BoardPiece,
  x: number,
  y: number,
): readonly [x: number, y: number] | undefined {
  const from = mapCellOf(board, piece)
  if (from === null) return undefined
  // Checked after rounding, as stored: a raw spot just inside the edge may round into the next square
  const spot = [Math.round(x), Math.round(y)] as const
  const to = mapCellOf(board, { ...piece, x: spot[0], y: spot[1] })
  if (to === null || to.column !== from.column || to.row !== from.row) return undefined
  return spot
}
