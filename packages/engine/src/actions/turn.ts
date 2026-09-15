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
import { appendLog, appendPublicLog, createLogTexts } from '../log.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState, LogType, Playerhand } from '../state.js'
import { findPlayer, hasUserAccess, withPlayer } from '../state.js'
import type { PlayerTurn, TurnPhase } from '../turn.js'
import {
  compareTurns,
  createPlayerTurn,
  publicTurnKey,
  sameTurn,
  withOrder,
  withoutCurrentOrderInHistory,
} from '../turn.js'

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
 * The order is stored both on the player's private turn list and in
 * `publicTurns`, which is what everyone sees. It is not hidden information —
 * turn orders are the point of a play-by-forum game.
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
    publicTurns: { ...state.publicTurns, [publicTurnKey(updated)]: updated },
  }

  const logType = PHASE_LOG_TYPE[input.phase]
  const texts = createLogTexts(logType, player.username, null, 0)
  return ok(
    appendLog(next, { username: player.username, playerId: player.playerId, logType, ...texts }),
  )
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
      ? { ...state.publicTurns, [publicTurnKey(updated)]: updated }
      : state.publicTurns,
  }

  const message = input.locked
    ? ` has locked in turn ${input.turnNumber}`
    : ` has re-opened turn ${input.turnNumber}`

  return ok(appendPublicLog(next, player.username, player.playerId, message))
}

/**
 * Java: `getAllPublicTurns`. Java stripped the current order from the history
 * by mutating the stored objects — a read that corrupted data. Here it is a
 * pure projection.
 */
export function allPublicTurns(state: GameState): readonly PlayerTurn[] {
  return Object.values(state.publicTurns)
    .sort(compareTurns)
    .map(withoutCurrentOrderInHistory)
}

/**
 * Java: `getPlayersTurns` created turn 1 when the list was empty, saving as a
 * side effect of a read. Here it is a pure read — use `addNewTurn` to create
 * a turn.
 */
export function playersTurns(state: GameState, playerId: string): readonly PlayerTurn[] {
  return [...(findPlayer(state, playerId)?.playerTurns ?? [])].sort(compareTurns)
}
