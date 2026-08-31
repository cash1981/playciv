/**
 * Port av spilldelen av `no.asgari.civilization.server.action.GameAction`.
 *
 * Ikke portert hit, med vilje:
 *
 * - `createNewGame` — ligger i `create-game.ts`, portert fra `PBFTestAction`
 * - `addMapLink` / `addAssetLink` — pekte på Google Presentation og Spreadsheet
 *   i iframe, som skal dø
 * - `chat` / `getChat` / `getPublicChat` — meldinger uten spillregler, hører i
 *   server-pakken
 * - highscore, turneringer, `sendMailToAll`, `deleteGame`, e-postinnstillinger —
 *   spør på tvers av spill eller er infrastruktur
 * - DTO-mapping (`mapGameDTO`, `createPbfDTO`) — erstattet av `toPlayerView`
 */

import type { EngineError } from '../errors.js'
import type { Item } from '../item.js'
import { compareItems } from '../item.js'
import { appendInfoLog, appendPrivatePublicLog, appendPublicLog } from '../log.js'
import { shuffle } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { GameState, Playerhand } from '../state.js'
import {
  PLAYER_COLORS,
  findPlayer,
  findPlayerByUsername,
  hasUserAccess,
} from '../state.js'

type ActionResult = Result<GameState, EngineError>

export interface JoinGameInput {
  readonly playerId: string
  readonly username: string
  readonly email?: string
  readonly color?: string
}

/**
 * Java: `GameAction.joinGame`.
 *
 * Har noen trukket seg, overtar den nye spilleren hånden deres og alle
 * loggpostene deres skrives om til det nye brukernavnet. Ellers opprettes en ny
 * hånd med neste ledige farge.
 */
export function joinGame(state: GameState, input: JoinGameInput): ActionResult {
  if (state.numOfPlayers === state.players.length) {
    return err({ kind: 'GAME_IS_FULL', numOfPlayers: state.numOfPlayers })
  }
  if (state.players.some((player) => player.playerId === input.playerId)) {
    return err({ kind: 'ALREADY_JOINED', playerId: input.playerId })
  }

  const withdrawn = state.withdrawnPlayers[0]

  let next: GameState
  let joined: Playerhand

  if (withdrawn !== undefined) {
    // Java: overtar hånden og oppdaterer loggposter til nytt brukernavn
    joined = {
      ...withdrawn,
      playerId: input.playerId,
      username: input.username,
      email: input.email ?? null,
    }
    next = {
      ...state,
      withdrawnPlayers: state.withdrawnPlayers.slice(1),
      log: state.log.map((entry) =>
        entry.username === withdrawn.username
          ? { ...entry, username: input.username }
          : entry,
      ),
    }
  } else {
    const color = input.color ?? nextAvailableColor(state)
    if (color === undefined) return err({ kind: 'NO_COLOR_AVAILABLE' })

    joined = {
      playerId: input.playerId,
      username: input.username,
      email: input.email ?? null,
      color,
      playernumber: 0,
      gameCreator: false,
      yourTurn: false,
      civilization: null,
      items: [],
      techsChosen: [],
      barbarians: [],
      battlehand: [],
      socialPolicies: [],
      playerTurns: [],
      gamenote: null,
    }
    next = state
  }

  next = { ...next, players: [...next.players, joined] }
  next = appendInfoLog(
    next,
    `${joined.username} joined the game and is playing color ${joined.color}`,
  )

  return ok(startIfAllPlayers(next))
}

/**
 * Java: `chooseColorForPlayer` brukte `Sets.difference` og tok første element av
 * et HashSet, altså i uspesifisert rekkefølge. Her følges rekkefølgen i
 * `PLAYER_COLORS`, slik at samme spill gir samme farger.
 */
export function nextAvailableColor(state: GameState): string | undefined {
  const taken = new Set(state.players.map((player) => player.color))
  return PLAYER_COLORS.find((color) => !taken.has(color))
}

/**
 * Java: `GameAction.startIfAllPlayers`.
 *
 * Når siste plass er fylt, stokkes spillerne, den første får turen, og alle får
 * et spillernummer. Har noen allerede turen, er spillet i gang og ingenting
 * skjer.
 */
export function startIfAllPlayers(state: GameState): GameState {
  if (state.players.some((player) => player.yourTurn)) return state
  if (state.numOfPlayers !== state.players.length) return state

  const [shuffled, rng] = shuffle(state.players, state.rng)
  const players = shuffled.map((player, index) => ({
    ...player,
    playernumber: index + 1,
    yourTurn: index === 0,
  }))

  let next: GameState = { ...state, players, rng }
  next = appendInfoLog(next, 'Game has now started. Good luck, and have fun!')

  const order = players
    .map((player, index) => `${ORDINAL_NAMES[index] ?? ''} player is ${player.username}. `)
    .join('')
  return appendInfoLog(next, order)
}

/** Java: `getNameForPlayerNumber`. */
const ORDINAL_NAMES = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'] as const

/**
 * Java: `GameAction.withdrawFromGame`.
 *
 * Er den som trekker seg spilloppretter, gis rollen videre til en tilfeldig
 * annen spiller. Er det ingen andre, må spillet avsluttes i stedet.
 */
export function withdrawFromGame(state: GameState, playerId: string): ActionResult {
  if (!hasUserAccess(state, playerId)) return err({ kind: 'NO_ACCESS', playerId })

  const player = findPlayer(state, playerId) as Playerhand
  let next = state

  if (player.gameCreator) {
    const others = state.players.filter(
      (candidate) => candidate.username !== player.username,
    )
    const [candidates] = shuffle(others, state.rng)
    const successor = candidates[0]
    if (successor === undefined) {
      return err({ kind: 'GAME_CREATOR_MUST_END_GAME', playerId })
    }

    next = {
      ...next,
      players: next.players.map((candidate) =>
        candidate.playerId === successor.playerId
          ? { ...candidate, gameCreator: true }
          : candidate,
      ),
    }
    next = appendPrivatePublicLog(
      next,
      successor.username,
      successor.playerId,
      'Is now game creator',
    )
  }

  next = {
    ...next,
    players: next.players.filter((candidate) => candidate.playerId !== playerId),
    withdrawnPlayers: [...next.withdrawnPlayers, player],
  }

  return ok(appendPublicLog(next, player.username, playerId, 'withdrew from game'))
}

export interface EndGameInput {
  readonly playerId: string
  readonly username: string
  /** Brukernavnet til vinneren. Utelates hvis spillet avsluttes uten vinner. */
  readonly winner?: string
}

/**
 * Java: `GameAction.endGame`.
 *
 * Bare spilloppretteren, eller brukeren «admin», kan avslutte et spill.
 * Javas siste logglinje om donasjon til playciv.com er ikke portert.
 */
export function endGame(state: GameState, input: EndGameInput): ActionResult {
  if (input.username !== 'admin') {
    const player = findPlayer(state, input.playerId)
    if (player === undefined) {
      return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })
    }
    if (!player.gameCreator) {
      return err({ kind: 'ONLY_GAME_CREATOR_CAN_END_GAME', playerId: input.playerId })
    }
  }

  let next = state
  let winner = state.winner

  if (input.winner !== undefined && input.winner !== '') {
    if (findPlayerByUsername(state, input.winner) === undefined) {
      return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.winner })
    }
    next = appendInfoLog(next, `${input.winner} won the game! Congratulations!`)
    winner = input.winner
  }

  next = { ...next, active: false, winner }
  return ok(appendInfoLog(next, `${input.username} Ended this game`))
}

/**
 * Java: `GameAction.getAllRevealedItems` — kastede items pluss alt spillerne
 * har avslørt. Dette er hva regnearket i iframe pleide å vise.
 */
export function allRevealedItems(state: GameState): readonly Item[] {
  const discarded = [...state.discardedItems].sort(compareItems)
  const revealed = state.players
    .flatMap((player) => player.items)
    .filter((item) => !item.hidden)
    .sort(compareItems)

  return [...discarded, ...revealed]
}
