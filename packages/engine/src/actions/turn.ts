/**
 * The turn actions: marking phases done, taking one back, and posting an order.
 *
 * None of them require it to be the caller's turn: there is no baton, and
 * players work on their own turn independently. The email for a posted order is
 * not sent here; notification belongs in the server package.
 */

import type { EngineError } from '../errors.js'
import { appendLog } from '../log.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState, LogType, Playerhand } from '../state.js'
import { findPlayer, hasUserAccess, withPlayer } from '../state.js'
import type { PlayerTurn, TurnPhase } from '../turn.js'
import {
  TURN_PHASES,
  createPlayerTurn,
  publicTurnKey,
  publicTurn,
  sameTurn,
  TURN_PHASE_LABEL,
} from '../turn.js'
import { startMissingTurns } from './new-turn.js'

type ActionResult = Result<GameState, EngineError>

/** The log type of each phase. */
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
 * the newest text and `history` keeps every version. A phase can take several orders. It does not mark
 * the phase done.
 */
export function postOrder(state: GameState, input: PostOrderInput): ActionResult {
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
  // The text stays out of the log, as with a reveal: it is in the published
  // history and in the timeline.
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
