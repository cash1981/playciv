/**
 * Transactional email (issue #30). Java: `email/SendEmail.java` plus the call
 * sites in `PlayerAction`, `GameAction` and `TurnAction`.
 *
 * Best-effort by design: a send failure is logged and swallowed, never failing
 * the game request — Java ran each batch on a raw `new Thread(...)` for the
 * same reason. The engine stays pure; only this package knows how to reach a
 * mail provider and what "now" is.
 */

import type { GameState, TurnPhase } from '@civ/engine'

import type { Mailer } from './mail.js'
import type { Repository } from './store/types.js'

export const DEFAULT_APP_ORIGIN = 'https://playciv.app'

/** Java `CivUtil.shouldSendEmailInGame`: 30 minutes, per player per game. */
export const IN_GAME_COOLDOWN_MS = 30 * 60 * 1000
/** Java `CivUtil.shouldSendEmail`: 3 hours, per account. */
export const GLOBAL_COOLDOWN_MS = 3 * 60 * 60 * 1000

type Player = GameState['players'][number]

export interface NotificationsConfig {
  readonly repo: Repository
  readonly mailer: Mailer
  readonly appOrigin?: string
  /** Java's new-game mail to every account; off unless the owner turns it on. */
  readonly broadcastNewGames?: boolean
  /** Injectable clock, so the two cooldowns are testable. */
  readonly now?: () => Date
}

export interface Notifications {
  /** Java `GameAction.createNewGame` — every registered, opted-in account. */
  gameCreated(game: GameState): Promise<void>
  /** Java `GameAction.joinGame` — the other players. */
  playerJoined(game: GameState, joinerPlayerId: string): Promise<void>
  /** Java `PlayerAction.endTurn` → `sendYourTurn` — the next player. */
  turnEnded(before: GameState, after: GameState): Promise<void>
  /** Java `GameAction.endGame` — every player. */
  gameEnded(game: GameState): Promise<void>
  /** Java `GameAction.deleteGame` — every player. */
  gameDeleted(game: GameState): Promise<void>
  /** Java `GameAction.addChat` — the other players, 30 min per game. */
  chatPosted(
    game: GameState,
    authorPlayerId: string,
    authorUsername: string,
    message: string,
  ): Promise<void>
  /** Java `TurnAction.update*` — the other players, 30 min per game. */
  phaseUpdated(
    game: GameState,
    authorPlayerId: string,
    authorUsername: string,
    phase: TurnPhase,
    order: string,
  ): Promise<void>
}

/**
 * Subject and noun for each phase. Java built the subject from the method name
 * (`updateSOT` → "Start of turn updated") and the body from a fixed phrase.
 * The wording is pinned here exactly, including the start-of-turn body's odd
 * `order\n:<order>` (Java line 44 concatenates the newline before the colon).
 */
const PHASE_MAIL: Readonly<Record<TurnPhase, { readonly subject: string; readonly noun: string }>> = {
  SOT: { subject: 'Start of turn updated', noun: 'start of turn' },
  TRADE: { subject: 'Trade updated', noun: 'trade' },
  CM: { subject: 'City management updated', noun: 'city management' },
  MOVEMENT: { subject: 'Movement updated', noun: 'movement' },
  RESEARCH: { subject: 'Research updated', noun: 'research' },
}

const globalScope = (playerId: string): string => `mail:player:${playerId}`
const inGameScope = (gameId: string, playerId: string): string =>
  `mail:game:${gameId}:${playerId}`

export function createNotifications(config: NotificationsConfig): Notifications {
  const { repo, mailer } = config
  const appOrigin = (config.appOrigin ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, '')
  const broadcastNewGames = config.broadcastNewGames === true
  const clock = config.now ?? ((): Date => new Date())

  const gameLink = (gameId: string): string => `${appOrigin}/game/${gameId}`

  // Java `SendEmail.UNSUBSCRIBE`: the same text, but on our own API host. The
  // issue asks for it on every mail, so even `sendYourTurn` carries it now.
  const unsubscribe = (playerId: string): string =>
    '\n\nIf you wish to unsubscribe from ALL emails, then push this link: ' +
    `${appOrigin}/api/admin/email/notification/${playerId}/stop`

  /**
   * One recipient. Skips a missing account, a blank address and an account that
   * has unsubscribed, applies the throttle, then sends. Never throws: a mail
   * problem must not fail the game action that triggered it.
   */
  async function notify(
    playerId: string,
    subject: string,
    body: string,
    throttle?: { readonly scope: string; readonly waitMs: number },
  ): Promise<void> {
    try {
      const player = await repo.findPlayerById(playerId)
      if (player === undefined || player.email === null || player.email === '') return
      if (player.disableEmail === true) return

      if (throttle !== undefined) {
        // One atomic step: the repository decides and records the slot
        // together, so two concurrent actions cannot both send.
        const claimed = await repo.claimEmailSlot(throttle.scope, throttle.waitMs, clock())
        if (!claimed) return
      }

      await mailer.send({ to: player.email, subject, text: body + unsubscribe(playerId) })
    } catch (error) {
      console.error(`Email notification "${subject}" to ${playerId} failed`, error)
    }
  }

  /** Emails every active player the predicate accepts. */
  async function notifyPlayers(
    game: GameState,
    include: (player: Player) => boolean,
    subject: string,
    body: string,
    throttleFor?: (player: Player) => { readonly scope: string; readonly waitMs: number },
  ): Promise<void> {
    for (const player of game.players) {
      if (!include(player)) continue
      await notify(player.playerId, subject, body, throttleFor?.(player))
    }
  }

  return {
    async gameCreated(game: GameState): Promise<void> {
      if (!broadcastNewGames) return
      const body =
        `A new game by the name ${game.name} was just created! ` +
        `Visit ${appOrigin}/ to join the game.`
      try {
        const players = await repo.allPlayers()
        for (const player of players) {
          await notify(player.id, 'New Civilization game created', body, {
            scope: globalScope(player.id),
            waitMs: GLOBAL_COOLDOWN_MS,
          })
        }
      } catch (error) {
        console.error('New-game broadcast failed', error)
      }
    },

    async playerJoined(game: GameState, joinerPlayerId: string): Promise<void> {
      const joiner = game.players.find((player) => player.playerId === joinerPlayerId)
      const body =
        `${joiner?.username ?? 'A player'} joined ${game.name}. ` +
        `Go to ${appOrigin}/ to find out who!`
      await notifyPlayers(game, (player) => player.playerId !== joinerPlayerId, 'Game update', body)
    },

    async turnEnded(before: GameState, after: GameState): Promise<void> {
      const previous = before.players.find((player) => player.yourTurn)?.playerId
      const next = after.players.find((player) => player.yourTurn)
      if (next === undefined || next.playerId === previous) return
      await notify(
        next.playerId,
        'It is your turn',
        `It's your turn to play in ${after.name}!\n\n` +
          `Go to ${gameLink(after.id)} to start your turn`,
      )
    },

    async gameEnded(game: GameState): Promise<void> {
      const body =
        `${game.name} has ended. I hope you enjoyed playing.\n` +
        'If you like this game, please consider donating. You can find the link at the ' +
        'bottom of the site. It will help keep the lights on, and continue adding more ' +
        'features!\n\nBest regards Shervin Asgari aka Cash'
      await notifyPlayers(game, () => true, 'Game ended', body)
    },

    async gameDeleted(game: GameState): Promise<void> {
      const body =
        `Your game ${game.name} was deleted by the admin. ` +
        'If this was incorrect, please contact the admin.'
      await notifyPlayers(game, () => true, 'Game deleted', body)
    },

    async chatPosted(
      game: GameState,
      authorPlayerId: string,
      authorUsername: string,
      message: string,
    ): Promise<void> {
      const body =
        `${authorUsername} wrote in the chat: ${message}.\n` +
        `Login to ${gameLink(game.id)} to see the chat`
      await notifyPlayers(
        game,
        // Exclude by stable id: Java compared usernames, but an admin can
        // rename an account while the game keeps the old name, which would
        // mail the author their own message.
        (player) => player.playerId !== authorPlayerId,
        'New Chat',
        body,
        (player) => ({
          scope: inGameScope(game.id, player.playerId),
          waitMs: IN_GAME_COOLDOWN_MS,
        }),
      )
    },

    async phaseUpdated(
      game: GameState,
      authorPlayerId: string,
      authorUsername: string,
      phase: TurnPhase,
      order: string,
    ): Promise<void> {
      const mail = PHASE_MAIL[phase]
      // Java: only the start-of-turn body put the newline before the colon.
      const orderText =
        phase === 'SOT'
          ? `${authorUsername} has updated start of turn with the following order\n:${order}`
          : `${authorUsername} has updated ${mail.noun} with the following order:\n${order}`
      const body = `${orderText}.\n\nLogin to ${gameLink(game.id)} to see the order`
      await notifyPlayers(
        game,
        // Stable id, not username — see `chatPosted`.
        (player) => player.playerId !== authorPlayerId,
        mail.subject,
        body,
        (player) => ({
          scope: inGameScope(game.id, player.playerId),
          waitMs: IN_GAME_COOLDOWN_MS,
        }),
      )
    },
  }
}
