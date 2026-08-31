/**
 * Port av `no.asgari.civilization.server.action.TurnAction`.
 *
 * Java hadde fem nesten identiske metoder — `updateSOT`, `updateTrade`,
 * `updateCM`, `updateMovement`, `updateResearch` — som skilte seg bare i
 * e-postteksten og logtypen. Fasen sto ALLEREDE i DTO-en, så hvilken metode man
 * kalte og hvilken fase man oppdaterte kunne komme i utakt: `updateSOT` med
 * `phase: "trade"` skrev til handelsfasen men logget SOT. Her er det én
 * funksjon som tar fasen som argument.
 *
 * E-postutsendingen er ikke portert. Java startet en rå `new Thread(...)` per
 * oppdatering; varsling hører i server-pakken.
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

/** Fasene kartlagt til logtypene Java brukte. */
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
 * Ordren lagres både på spillerens private turliste og i `publicTurns`, som er
 * det alle kan se. Det er ikke skjult informasjon — turordrer er poenget med et
 * play-by-forum-spill.
 */
export function updateTurn(state: GameState, input: UpdateTurnInput): ActionResult {
  const access = requireAccess(state, input.playerId)
  if (!access.ok) return access
  const player = access.value

  const existing = player.playerTurns.find((turn) => turn.turnNumber === input.turnNumber)
  const base = existing ?? createPlayerTurn(player.username, input.turnNumber)
  // Java satte brukernavnet på nytt, i tilfelle spilleren var byttet ut
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
 * Java: `addNewTurn`. Java glemte å lagre etterpå, så den nye turen forsvant
 * ved neste lesing fra Mongo. Her returneres ny tilstand, så den blir bevart.
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

/** Java: `lockOrUnlockTurn` — låser turen så ordrene ikke kan endres videre. */
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
    // Hold den offentlige kopien i takt; Java oppdaterte bare den private
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
 * Java: `getAllPublicTurns`. Java fjernet den gjeldende ordren fra historikken
 * ved å mutere de lagrede objektene — en lesing som ødela data. Her er det en
 * ren projeksjon.
 */
export function allPublicTurns(state: GameState): readonly PlayerTurn[] {
  return Object.values(state.publicTurns)
    .sort(compareTurns)
    .map(withoutCurrentOrderInHistory)
}

/**
 * Java: `getPlayersTurns` opprettet tur 1 hvis listen var tom, og lagret som
 * bieffekt av en lesing. Her er det en ren lesing — bruk `addNewTurn` for å
 * opprette en tur.
 */
export function playersTurns(state: GameState, playerId: string): readonly PlayerTurn[] {
  return [...(findPlayer(state, playerId)?.playerTurns ?? [])].sort(compareTurns)
}
