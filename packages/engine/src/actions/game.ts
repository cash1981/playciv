/**
 * Port of the game part of `no.asgari.civilization.server.action.GameAction`.
 *
 * Deliberately not ported here:
 *
 * - `createNewGame` — lives in `create-game.ts`, ported from `PBFTestAction`
 * - `addMapLink` / `addAssetLink` — pointed at a Google Presentation and
 *   Spreadsheet in an iframe, which are going away
 * - `chat` / `getChat` / `getPublicChat` — messages without game rules, so they
 *   belong in the server package
 * - highscores, tournaments, `sendMailToAll`, `deleteGame`, email settings —
 *   these query across games or are infrastructure
 * - DTO mapping (`mapGameDTO`, `createPbfDTO`) — replaced by `toPlayerView`
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
 * If someone has withdrawn, the new player takes over their hand and all their
 * log entries are rewritten to the new username. Otherwise a fresh hand is
 * created with the next free colour.
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
    // Java: takes over the hand and rewrites log entries to the new username
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
 * Java: `chooseColorForPlayer` used `Sets.difference` and took the first
 * element of a HashSet, so in unspecified order. Here the order in
 * `PLAYER_COLORS` is followed, so the same game gives the same colours.
 */
export function nextAvailableColor(state: GameState): string | undefined {
  const taken = new Set(state.players.map((player) => player.color))
  return PLAYER_COLORS.find((color) => !taken.has(color))
}

/**
 * Java: `GameAction.startIfAllPlayers`.
 *
 * When the last seat is filled the players are shuffled, the first one takes
 * the turn, and everyone gets a player number. If someone already has the turn
 * the game is under way and nothing happens.
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
 * If the one withdrawing is the game creator, the role passes to a random
 * other player. If there is nobody else, the game has to be ended instead.
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
  /** The winner's username. Left out when the game ends without one. */
  readonly winner?: string
}

/**
 * Java: `GameAction.endGame`.
 *
 * Only the game creator, or the user "admin", can end a game.
 * Java's last log line asking for donations to playciv.com is not ported.
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
 * Java: `GameAction.getAllRevealedItems` — discarded items plus everything the players
 * has revealed. This is what the spreadsheet in the iframe used to show.
 */
export function allRevealedItems(state: GameState): readonly Item[] {
  const discarded = [...state.discardedItems].sort(compareItems)
  const revealed = state.players
    .flatMap((player) => player.items)
    .filter((item) => !item.hidden)
    .sort(compareItems)

  return [...discarded, ...revealed]
}
