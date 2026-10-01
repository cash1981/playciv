/**
 * Port of `no.asgari.civilization.server.action.TurnAction`.
 *
 * Java had five nearly identical methods — `updateSOT`, `updateTrade`,
 * `updateCM`, `updateMovement`, `updateResearch` — differing only in the email
 * text and the log type. The phase was ALREADY in the DTO, so which method you
 * called and which phase you updated could drift apart: `updateSOT` with
 * `phase: "trade"` wrote to the trade phase but logged SOT. Here there is one
 * function taking the phase as an argument.
 *
 * The email sending is not ported. Java started a raw `new Thread(...)` per
 * update; notification belongs in the server package.
 */

import type { EngineError } from '../errors.js'
import { appendInfoLog, appendLog, appendPublicLog, createLogTexts } from '../log.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState, LogType, Playerhand } from '../state.js'
import { activeTurnStatus, findPlayer, hasUserAccess, withPlayer } from '../state.js'
import type { PlayerTurn, TurnPhase } from '../turn.js'
import {
  TURN_PHASES,
  compareTurns,
  createPlayerTurn,
  publicTurnKey,
  publicTurn,
  sameTurn,
  startPlayerOf,
  TURN_PHASE_LABEL,
  withOrder,
} from '../turn.js'
import { START_PLAYER_ID } from '../board.js'
import { placeStartMarker } from './board.js'
import { startMissingTurns } from './new-turn.js'

type ActionResult = Result<GameState, EngineError>

/** The phases mapped to the log types Java used. */
const PHASE_LOG_TYPE: Readonly<Record<TurnPhase, LogType>> = {
  SOT: 'SOT',
  TRADE: 'TRADE',
  CM: 'CM',
  MOVEMENT: 'MOVEMENT',
  RESEARCH: 'RESEARCH',
}

function requireAccess(
  state: GameState,
  playerId: string,
): Result<Playerhand, EngineError> {
  if (!hasUserAccess(state, playerId)) return err({ kind: 'NO_ACCESS', playerId })
  const player = findPlayer(state, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
  return ok(player)
}

export interface UpdateTurnInput {
  readonly playerId: string
  readonly turnNumber: number
  readonly phase: TurnPhase
  readonly order: string
}

/**
 * Java: `updateTurn` + `updatePrivatePlayerturn` + `addTurnInPBF`.
 *
 * The order is stored on the player's private turn list. The public copy keeps
 * the turn identity but masks each phase until it is explicitly revealed.
 */
export function updateTurn(state: GameState, input: UpdateTurnInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const existing = player.playerTurns.find((turn) => turn.turnNumber === input.turnNumber)
  const base = existing ?? createPlayerTurn(player.username, input.turnNumber)
  // Java set the username again, in case the player had been replaced
  const updated = withOrder({ ...base, username: player.username }, input.phase, input.order)

  const playerTurns = existing === undefined
    ? [...player.playerTurns, updated]
    : player.playerTurns.map((turn) => (sameTurn(turn, updated) ? updated : turn))

  const next: GameState = {
    ...withPlayer(state, { ...player, playerTurns }),
    publicTurns: { ...state.publicTurns, [publicTurnKey(updated)]: publicTurn(updated) },
  }

  const logType = PHASE_LOG_TYPE[input.phase]
  const texts = createLogTexts(logType, player.username, null, 0, state.logSecret, input.turnNumber)
  return ok(
    appendLog(next, { username: player.username, playerId: player.playerId, logType, ...texts }),
  )
}

export interface RevealTurnOrderInput {
  readonly playerId: string
  readonly turnNumber: number
  readonly phase: TurnPhase
  /** ISO timestamp for this reveal, supplied by the caller. */
  readonly at: string
}

/** Publishes one phase of the caller's turn order and records a new version. */
export function revealTurnOrder(state: GameState, input: RevealTurnOrderInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value
  const turn = player.playerTurns.find((candidate) => candidate.turnNumber === input.turnNumber)
  if (turn === undefined) return err({ kind: 'TURN_NOT_FOUND', turnNumber: input.turnNumber })

  // Already revealed: a repeat request must not append a duplicate version.
  if (turn.revealed[input.phase] === true) return ok(state)

  const updated: PlayerTurn = {
    ...turn,
    revealed: { ...turn.revealed, [input.phase]: true },
    // Chat orders (issue #215): a classic reveal finishes the phase too, so the
    // two modes agree about what is done when the setting is switched.
    done: { ...turn.done, [input.phase]: true },
    history: {
      ...turn.history,
      [input.phase]: [
        ...turn.history[input.phase],
        { markdown: turn.orders[input.phase], at: input.at },
      ],
    },
  }
  const next: GameState = {
    ...withPlayer(state, {
      ...player,
      playerTurns: player.playerTurns.map((candidate) =>
        sameTurn(candidate, updated) ? updated : candidate,
      ),
    }),
    publicTurns: {
      ...state.publicTurns,
      [publicTurnKey(updated)]: publicTurn(updated),
    },
  }
  const message = `Turn ${input.turnNumber} - ${player.username} revealed ${TURN_PHASE_LABEL[input.phase]} phase`
  const revealed = appendLog(next, {
    username: player.username,
    playerId: player.playerId,
    logType: PHASE_LOG_TYPE[input.phase],
    privateLog: message,
    publicLog: message,
  })
  // A reveal sets `done` too, so it can finish a turn. Nothing happens with chat orders off.
  return ok(startMissingTurns(revealed, player.playerId, input.at))
}

export interface AddTurnInput {
  readonly playerId: string
  readonly turnNumber: number
}

/**
 * Java: `addNewTurn`. Java forgot to save afterwards, so the new turn vanished
 * on the next read from Mongo. Here new state is returned, so it survives.
 */
export function addNewTurn(state: GameState, input: AddTurnInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  if (player.playerTurns.some((turn) => turn.turnNumber === input.turnNumber)) {
    return ok(state)
  }

  return ok(
    withPlayer(state, {
      ...player,
      playerTurns: [
        ...player.playerTurns,
        createPlayerTurn(player.username, input.turnNumber),
      ],
    }),
  )
}

export interface LockTurnInput {
  readonly playerId: string
  readonly turnNumber: number
  readonly locked: boolean
}

/** Java: `lockOrUnlockTurn` — locks the turn so the orders stop changing. */
export function lockOrUnlockTurn(state: GameState, input: LockTurnInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const turn = player.playerTurns.find((candidate) => candidate.turnNumber === input.turnNumber)
  if (turn === undefined) return err({ kind: 'TURN_NOT_FOUND', turnNumber: input.turnNumber })

  const updated: PlayerTurn = { ...turn, disabled: input.locked }
  const next: GameState = {
    ...withPlayer(state, {
      ...player,
      playerTurns: player.playerTurns.map((candidate) =>
        sameTurn(candidate, updated) ? updated : candidate,
      ),
    }),
    // Keep the public copy in step; Java only updated the private one
    publicTurns: Object.prototype.hasOwnProperty.call(
      state.publicTurns,
      publicTurnKey(updated),
    )
      ? { ...state.publicTurns, [publicTurnKey(updated)]: publicTurn(updated) }
      : state.publicTurns,
  }

  const message = input.locked
    ? ` has locked in turn ${input.turnNumber}`
    : ` has re-opened turn ${input.turnNumber}`

  return ok(appendPublicLog(next, player.username, player.playerId, message))
}

/**
 * Java: `getAllPublicTurns`. Java stripped the current order from its
 * save-based history by mutating the stored objects — a read that corrupted
 * data. The reveal history never contains the current order, so nothing is
 * stripped here; `publicTurn` masks the text of unpublished phases.
 */
export function allPublicTurns(state: GameState): readonly PlayerTurn[] {
  return Object.values(state.publicTurns)
    .sort(compareTurns)
    .map((turn) => publicTurn(turn))
}

/**
 * Java: `getPlayersTurns` created turn 1 when the list was empty, saving as a
 * side effect of a read. Here it is a pure read — use `addNewTurn` to create
 * a turn.
 */
export function playersTurns(state: GameState, playerId: string): readonly PlayerTurn[] {
  return [...(findPlayer(state, playerId)?.playerTurns ?? [])].sort(compareTurns)
}

// ---------------------------------------------------------------------------
// Chat orders (issue #215)
//
// None of these require it to be the caller's turn: with chat orders on there
// is no baton, and players work on their own turn independently. They refuse
// with `CHAT_ORDERS_OFF` while the setting is off; the classic reveal is
// unaffected.
// ---------------------------------------------------------------------------

/** Replaces one player's turn (creating it when missing) and keeps the public copy in step. */
function withPlayerTurn(state: GameState, player: Playerhand, updated: PlayerTurn): GameState {
  const exists = player.playerTurns.some((turn) => sameTurn(turn, updated))
  const playerTurns = exists
    ? player.playerTurns.map((turn) => (sameTurn(turn, updated) ? updated : turn))
    : [...player.playerTurns, updated]
  return {
    ...withPlayer(state, { ...player, playerTurns }),
    publicTurns: { ...state.publicTurns, [publicTurnKey(updated)]: publicTurn(updated) },
  }
}

const findOrCreateTurn = (player: Playerhand, turnNumber: number): PlayerTurn => {
  const existing = player.playerTurns.find((turn) => turn.turnNumber === turnNumber)
  // Java set the username again, in case the player had been replaced
  return { ...(existing ?? createPlayerTurn(player.username, turnNumber)), username: player.username }
}

export interface MarkPhasesDoneInput {
  readonly playerId: string
  readonly turnNumber: number
  /** This phase and every phase before it are marked done. */
  readonly upToPhase: TurnPhase
  /** ISO timestamp for the board history when this starts a new turn. */
  readonly at?: string
}

/**
 * Marks every phase up to and including `upToPhase` done, so a player who has
 * played through Movement in one go says so once. Creates the turn when the
 * player has nothing saved for it. Marking what is already done changes and
 * logs nothing.
 */
export function markPhasesDone(state: GameState, input: MarkPhasesDoneInput): ActionResult {
  if (!state.chatOrders) return err({ kind: 'CHAT_ORDERS_OFF' })
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const turn = findOrCreateTurn(player, input.turnNumber)
  const phases = TURN_PHASES.slice(0, TURN_PHASES.indexOf(input.upToPhase) + 1)
  const newlyDone = phases.filter((phase) => turn.done[phase] !== true)
  if (newlyDone.length === 0) return ok(state)

  const updated: PlayerTurn = {
    ...turn,
    done: {
      ...turn.done,
      ...Object.fromEntries(newlyDone.map((phase) => [phase, true])),
    },
  }
  const what =
    newlyDone.length === 1
      ? `${TURN_PHASE_LABEL[input.upToPhase]} phase`
      : `all phases up to ${TURN_PHASE_LABEL[input.upToPhase]}`
  const message = `Turn ${input.turnNumber} - ${player.username} marked ${what} done`
  const marked = appendLog(withPlayerTurn(state, player, updated), {
    username: player.username,
    playerId: player.playerId,
    logType: PHASE_LOG_TYPE[input.upToPhase],
    privateLog: message,
    publicLog: message,
  })
  return ok(startMissingTurns(marked, player.playerId, input.at))
}

export interface UnmarkPhaseDoneInput {
  readonly playerId: string
  readonly turnNumber: number
  readonly phase: TurnPhase
}

/**
 * Takes one phase back to not done. There is no vote and later phases are left
 * as they are: the system only shows who is missing what, it does not enforce
 * an order.
 */
export function unmarkPhaseDone(state: GameState, input: UnmarkPhaseDoneInput): ActionResult {
  if (!state.chatOrders) return err({ kind: 'CHAT_ORDERS_OFF' })
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const turn = player.playerTurns.find((candidate) => candidate.turnNumber === input.turnNumber)
  if (turn === undefined) return err({ kind: 'TURN_NOT_FOUND', turnNumber: input.turnNumber })
  if (turn.done[input.phase] !== true) return ok(state)

  const updated: PlayerTurn = { ...turn, done: { ...turn.done, [input.phase]: false } }
  const message = `Turn ${input.turnNumber} - ${player.username} marked ${TURN_PHASE_LABEL[input.phase]} phase not done`
  return ok(
    appendLog(withPlayerTurn(state, player, updated), {
      username: player.username,
      playerId: player.playerId,
      logType: PHASE_LOG_TYPE[input.phase],
      privateLog: message,
      publicLog: message,
    }),
  )
}

export interface PostOrderInput {
  readonly playerId: string
  readonly turnNumber: number
  readonly phase: TurnPhase
  readonly markdown: string
  /** ISO timestamp for this order, supplied by the caller. */
  readonly at: string
}

/**
 * Writes the order for a phase and publishes it in one step: `orders[phase]` is
 * the newest text and `history` keeps every version, so the classic Turn orders
 * panel reads the same data. A phase can take several orders. It does not mark
 * the phase done.
 */
export function postOrder(state: GameState, input: PostOrderInput): ActionResult {
  if (!state.chatOrders) return err({ kind: 'CHAT_ORDERS_OFF' })
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const turn = findOrCreateTurn(player, input.turnNumber)
  const updated: PlayerTurn = {
    ...turn,
    orders: { ...turn.orders, [input.phase]: input.markdown },
    revealed: { ...turn.revealed, [input.phase]: true },
    history: {
      ...turn.history,
      [input.phase]: [...turn.history[input.phase], { markdown: input.markdown, at: input.at }],
    },
  }
  // The text stays out of the log, as with a classic reveal: it is in the
  // published history and, in chat mode, in the timeline.
  const message = `Turn ${input.turnNumber} - ${player.username} posted an order for ${TURN_PHASE_LABEL[input.phase]} phase`
  return ok(
    appendLog(withPlayerTurn(state, player, updated), {
      username: player.username,
      playerId: player.playerId,
      logType: PHASE_LOG_TYPE[input.phase],
      privateLog: message,
      publicLog: message,
    }),
  )
}

/**
 * The turn a game has reached, read from the whole table rather than from the
 * baton holder alone. The classic view only looks at whoever holds the baton,
 * and a holder who never wrote turn orders would report turn 1 in a game that is
 * on turn 20. So: the larger of the classic turn and the highest turn anyone has
 * a record for, moved on by one when everybody who has a record for that turn
 * has finished all its phases. Overshooting only marks old turns finished, which
 * is what a baseline is for; undershooting would pin the game to an old turn.
 */
function playedTurn(state: GameState): number {
  const classicTurn = activeTurnStatus({ ...state, chatOrders: false })?.turnNumber ?? 1
  const recorded = state.players.flatMap((player) => player.playerTurns)
  const highest = recorded.reduce((best, turn) => Math.max(best, turn.turnNumber), 0)
  if (highest === 0) return classicTurn
  const atHighest = recorded.filter((turn) => turn.turnNumber === highest)
  const finished = atHighest.every((turn) => TURN_PHASES.every((phase) => turn.revealed[phase] !== false))
  return Math.max(classicTurn, finished ? highest + 1 : highest)
}

/**
 * Switches chat orders on or off for a game. The engine has no notion of an
 * admin, so the server route is what restricts who may call this.
 *
 * Switching on sets the baseline `chatOrdersStartTurn` to the turn the classic
 * view reports right now (computed before the flag flips), never lowering it.
 * It also settles the start player: the marker stays where it is when the board
 * has one, and is placed in the start player's area when it has not (a board
 * history entry, made in the start player's name since the admin may not be in
 * the game). The starter of the baseline turn is recorded. Switching off touches
 * nothing else, which is why going back and forth loses no data, and places no
 * marker.
 */
export function setChatOrders(state: GameState, enabled: boolean, at?: string): ActionResult {
  if (state.chatOrders === enabled) return ok(state)
  const chatOrdersStartTurn = enabled
    ? Math.max(state.chatOrdersStartTurn, playedTurn(state))
    : state.chatOrdersStartTurn
  const flipped = appendInfoLog(
    { ...state, chatOrders: enabled, chatOrdersStartTurn },
    `Chat orders turned ${enabled ? 'on' : 'off'}`,
  )
  if (!enabled) return ok(flipped)

  const starter = startPlayerOf(flipped)
  if (starter === undefined) return ok(flipped)
  const hasMarker = flipped.board.pieces.some((piece) => piece.assetId === START_PLAYER_ID)
  const placed = hasMarker ? flipped : placeStartMarker(flipped, starter, starter.playerId, at)
  // A marker that was already there decides who the start player is
  const settled = startPlayerOf(placed) ?? starter
  return ok({
    ...placed,
    startPlayerId: settled.playerId,
    turnStarters:
      placed.turnStarters[chatOrdersStartTurn] === undefined
        ? { ...placed.turnStarters, [chatOrdersStartTurn]: settled.username }
        : placed.turnStarters,
  })
}
