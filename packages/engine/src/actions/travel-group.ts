/**
 * Figures standing on one square travel or explore together (issue #362).
 *
 * A group is a convenience, not a new rule: every figure is checked and charged exactly as it would be alone, with its
 * own speed, so the slowest sets what the group can do. The move is all or nothing, and everything it makes on the board
 * is one group, so a single Undo takes it all back and a single Redo brings it again (`tagBoardGroup`). The public log
 * has one line naming every figure. A hut, village, relic, another player's figures or a city centre to disband in are
 * handled as for one figure: the group ends its move there, and the token, relic or village fight is done once, by the
 * group's army (or its first figure when it has none).
 */

import { brandenburgForbiddenFor } from '../brandenburg.js'
import { mapCellOf } from '../blockade.js'
import type { Cell } from '../blockade.js'
import { communismLocksOf } from '../communism.js'
import { findPiece, locationOf } from '../board.js'
import type { BoardPiece, PieceMovement } from '../board.js'
import type { EngineError } from '../errors.js'
import { activeGreatPerson, stackingLimitOf } from '../great-person-effects.js'
import { figureBelongsTo, figureMovementOptions, movementOf, occupancyOf } from '../movement.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState } from '../state.js'
import { findPlayer, hasUserAccess } from '../state.js'
import { turnStatus } from '../turn.js'
import { appendLog } from '../log.js'
import { areasFor, moveFigureWithMovementUnchecked, squareName, tagBoardGroup } from './board.js'
import { exploreSquare } from './explore.js'
import { travelFigureCollecting } from './token-collection.js'

export interface TravelGroupInput {
  readonly playerId: string
  /** The figures that go together: two or more of the player's own, all standing on the same square. */
  readonly pieceIds: readonly string[]
  readonly column: number
  readonly row: number
  /** The squares to enter, excluding the start: every figure follows it and is charged its length. */
  readonly route: readonly Cell[]
  /** Every figure disbands on arrival, on a centre square of the player's own city. */
  readonly disband?: boolean
  /** Draw the hut or village the group ends on (the group's army or first figure draws it, once). */
  readonly collectToken?: boolean
  /** The group's army fights the barbarians for the village it ends on. */
  readonly fightVillage?: boolean
  readonly at?: string
}

export interface ExploreGroupInput {
  readonly playerId: string
  readonly pieceIds: readonly string[]
  /** The unexplored square to uncover, next to the square the group stands on. */
  readonly column: number
  readonly row: number
  readonly at?: string
}

const refuse = (reason: string): Result<never, EngineError> => err({ kind: 'FIGURE_MOVE_ILLEGAL', reason })

/** "Red army and Red scout", "A, B and C". */
const namesOf = (labels: readonly string[]): string =>
  labels.length <= 2 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`

/** The group's figures, the one the caller named first at the front, or the refusal when they cannot go together. */
function groupOf(state: GameState, playerId: string, pieceIds: readonly string[]): Result<readonly BoardPiece[], EngineError> {
  if (!hasUserAccess(state, playerId)) return err({ kind: 'NO_ACCESS', playerId })
  const player = findPlayer(state, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
  const ids = [...new Set(pieceIds)]
  if (ids.length < 2) return refuse('A group move needs at least two figures.')
  const pieces: BoardPiece[] = []
  for (const id of ids) {
    const piece = findPiece(state.board, id)
    if (piece === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: id })
    if (!figureBelongsTo(player, piece)) return refuse(`${piece.label} is not one of your figures on the map.`)
    pieces.push(piece)
  }
  const cells = pieces.map((piece) => mapCellOf(state.board, piece))
  const first = cells[0]
  if (first === null || first === undefined || cells.some((cell) => cell === null || cell.column !== first.column || cell.row !== first.row)) {
    return refuse('Figures move together only from one square.')
  }
  return ok(pieces)
}

/**
 * Writes the group's one public line first, so it reads before what the move itself then logs (a token drawn, a relic
 * taken), and counts every line made since into the last board entry, as one entry's `logLength` does for its own line.
 */
function announceGroup(state: GameState, actorId: string, text: string, at: string | undefined): GameState {
  const actor = findPlayer(state, actorId)
  return actor === undefined
    ? state
    : appendLog(state, { username: actor.username, playerId: actor.playerId, publicLog: `${actor.username} ${text}`, createdAt: at ?? null })
}

const withLogCounted = (state: GameState): GameState => {
  const last = state.board.history.at(-1)
  return last === undefined
    ? state
    : { ...state, board: { ...state.board, history: [...state.board.history.slice(0, -1), { ...last, logLength: state.log.length }] } }
}

/** Moves the group along one route, all or nothing. */
export function travelGroup(state: GameState, input: TravelGroupInput): Result<GameState, EngineError> {
  const grouped = groupOf(state, input.playerId, input.pieceIds)
  if (!grouped.ok) return grouped
  const pieces = grouped.value
  const from = locationOf(state.board, areasFor(state), pieces[0] as BoardPiece)
  // The army does what only an army can (a relic, the fight for a village), so it is the one the token and the
  // battle are about. It moves last, so the others already stand on the square when its token is drawn or its battle
  // starts. A group that disbands leaves one marker in the city, the first figure's: the army goes first, so a
  // fortification rather than a caravan (the orchestrator's choice, not yet confirmed by the human).
  const lead = pieces.find((piece) => piece.assetId.endsWith('army')) ?? (pieces[0] as BoardPiece)
  const others = pieces.filter((piece) => piece.id !== lead.id)
  const order = input.disband === true ? [lead, ...others] : [...others, lead]
  const player = findPlayer(state, input.playerId)
  const squares = input.route.length
  const contact = player !== undefined && occupancyOf(state.board, player).foreign.has(`${input.column},${input.row}`)
  const said =
    `moved ${namesOf(pieces.map((piece) => piece.label))} together ${[from, ...input.route.map(squareName)].join(' → ')} ` +
    `(${squares} ${squares === 1 ? 'square' : 'squares'})` +
    (input.disband === true ? ', and disbanded them there' : '') +
    (contact ? ", onto another player's figures: settle the battle and loot by hand" : '')
  const historyBefore = state.board.history.length
  let current = announceGroup(state, input.playerId, said, input.at)
  for (const piece of order) {
    const isLead = piece.id === lead.id
    const travelled = travelFigureCollecting(current, {
      playerId: input.playerId,
      pieceId: piece.id,
      column: input.column,
      row: input.row,
      route: input.route,
      announce: false,
      ...(input.disband === true ? { disband: true } : {}),
      ...(isLead && input.collectToken === true ? { collectToken: true } : {}),
      ...(isLead && input.fightVillage === true ? { fightVillage: true } : {}),
      ...(input.at === undefined ? {} : { at: input.at }),
    })
    if (!travelled.ok) return travelled
    current = travelled.value
  }
  return ok(tagBoardGroup(withLogCounted(current), historyBefore))
}

/**
 * The group explores the fog next to its square: one tile is drawn, and every figure of the group spends 1 movement,
 * since they go together. Each must be free to explore, so one that cannot refuses the whole thing.
 */
export function exploreGroup(state: GameState, input: ExploreGroupInput): Result<GameState, EngineError> {
  const grouped = groupOf(state, input.playerId, input.pieceIds)
  if (!grouped.ok) return grouped
  const pieces = grouped.value
  const player = findPlayer(state, input.playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })
  const turnNumber = turnStatus(state).currentTurn
  const movementPlayer = {
    ...player,
    activeGreatPersonNames: activeGreatPerson(state, player, 'Henry Ford') ? ['Henry Ford'] : [],
    stackingLimit: stackingLimitOf(state, player),
  }
  const locks = communismLocksOf(state)
  const forbidden = brandenburgForbiddenFor(state, input.playerId)
  for (const piece of pieces) {
    const options = figureMovementOptions(state.board, movementPlayer, piece, turnNumber, locks, forbidden)
    if (options === null || !options.explore.some((cell) => cell.column === input.column && cell.row === input.row)) {
      return refuse(`${piece.label} cannot explore ${squareName(input)}: it has no movement left, or the square is not next to the group.`)
    }
  }
  const lead = pieces[0] as BoardPiece
  const from = locationOf(state.board, areasFor(state), lead)
  const historyBefore = state.board.history.length
  const said = `explored ${squareName(input)} with ${namesOf(pieces.map((piece) => piece.label))} on ${from} (1 movement each)`
  const explored = exploreSquare(announceGroup(state, input.playerId, said, input.at), {
    playerId: input.playerId,
    pieceId: lead.id,
    column: input.column,
    row: input.row,
    announce: false,
    ...(input.at === undefined ? {} : { at: input.at }),
  })
  if (!explored.ok) return explored
  let current = explored.value
  for (const piece of pieces.slice(1)) {
    const standing = findPiece(current.board, piece.id)
    if (standing === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: piece.id })
    const saved = movementOf(standing, turnNumber)
    const movement: PieceMovement = {
      turn: turnNumber,
      used: (saved?.used ?? 0) + 1,
      locked: saved?.locked ?? false,
      ...(saved?.reason === undefined ? {} : { reason: saved.reason }),
    }
    const spent = moveFigureWithMovementUnchecked(current, {
      playerId: input.playerId,
      pieceId: standing.id,
      x: standing.x,
      y: standing.y,
      movementFrom: standing.movement ?? null,
      movementTo: movement,
      description: `spent 1 movement with ${standing.label} exploring ${squareName(input)}`,
      ...(input.at === undefined ? {} : { at: input.at }),
    })
    if (spent === undefined) return err({ kind: 'BOARD_PIECE_NOT_FOUND', pieceId: piece.id })
    current = spent
  }
  return ok(tagBoardGroup(withLogCounted(current), historyBefore))
}
