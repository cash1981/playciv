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
import { activeTurnStatus, TURN_PHASE_LABEL, turnHolder } from '@civ/engine'

import type { Mailer, OutgoingEmail } from './mail.js'
import { MailError } from './mail.js'
import { escapeHtml, renderMarkdown } from './markdown.js'
import type { Repository } from './store/types.js'

export const DEFAULT_APP_ORIGIN = 'https://playciv.app'

/**
 * Java `CivUtil.shouldSendEmailInGame`: 30 minutes, per player per game. Since
 * issue #217 it only applies to a player who has never opened the game; after
 * that, a game email waits for the next visit instead of a clock.
 */
export const IN_GAME_COOLDOWN_MS = 30 * 60 * 1000

type Player = GameState['players'][number]

export interface NotificationsConfig {
  readonly repo: Repository
  readonly mailer: Mailer
  readonly appOrigin?: string
  /** Injectable clock, so the cooldown and the broadcast's time budget are testable. */
  readonly now?: () => Date
  /** Injectable pause, so the broadcast's spacing between requests costs a test nothing. */
  readonly sleep?: (ms: number) => Promise<void>
}

/** Resend's limit for one `/emails/batch` request. */
export const BROADCAST_BATCH_SIZE = 100

/**
 * Provider calls one broadcast may make. A Worker on the free plan allows 50
 * subrequests per invocation in total, and the database read and the auth check
 * use some of them, so the broadcast keeps a margin.
 */
export const BROADCAST_REQUEST_BUDGET = 40

/**
 * Resend allows about two requests per second across the whole API by default,
 * and answers 429 beyond that. Waiting between requests keeps a long broadcast
 * under it; 600 ms leaves a little room.
 */
export const BROADCAST_PAUSE_MS = 600

/**
 * Wall-clock budget for one broadcast. If the HTTP response is lost (a client
 * or edge timeout) the admin never sees `sentTo`, and a rerun would mail the
 * same people again. A run that always ends well inside that window keeps the
 * result reachable, so the rest is deferred instead.
 */
export const BROADCAST_TIME_BUDGET_MS = 45_000

/** Statuses that can be about one message in the batch; anything else is about the request. */
const PER_MESSAGE_STATUSES: ReadonlySet<number> = new Set([400, 413, 422])

/** Deliberately loose: it only has to catch what Resend would reject for the whole batch. */
const PLAUSIBLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface BroadcastOptions {
  readonly subject: string
  readonly markdown: string
  readonly includeUnsubscribed: boolean
  /** Addresses to leave out, typically `sentTo` from an earlier run. Case-insensitive. */
  readonly exclude?: readonly string[]
  /** Attempt at most this many eligible accounts; the rest are `deferred`. */
  readonly limit?: number
}

export interface BroadcastResult {
  readonly sent: number
  /** Addresses the provider accepted in this run, for the next run's exclude list. */
  readonly sentTo: readonly string[]
  readonly skipped: {
    readonly noAddress: number
    readonly unsubscribed: number
    readonly excluded: number
  }
  readonly failed: readonly { readonly email: string; readonly reason: string }[]
  /** Eligible but not attempted: the limit, the quota, the request budget or a stop. */
  readonly deferred: number
  readonly stopReason: string | null
}

export interface Notifications {
  /**
   * Issue #217 — a signed-in viewer loaded the game. Counts as a visit only
   * when they are a player in it, which re-arms their game emails. Spectators
   * and admins are ignored.
   */
  gameOpened(game: GameState, viewerId: string): Promise<void>
  /** Java `GameAction.joinGame` — the other players, held until they open the game. */
  playerJoined(game: GameState, joinerPlayerId: string): Promise<void>
  /** Java `PlayerAction.endTurn` → `sendYourTurn` — the next player, held until they open the game. */
  turnEnded(before: GameState, after: GameState): Promise<void>
  /**
   * Chat orders (issue #215) — the new turn holder, when marking a phase done
   * changed who it is. Nothing when the holder is the same. Throttled like the
   * other in-game mail (30 minutes per player per game).
   */
  turnHolderChanged(before: GameState, after: GameState): Promise<void>
  /**
   * New mechanic (no Java counterpart) — the player who now holds the battle
   * turn, straight after someone ends it. Never held back. Skipped when there is
   * no battle or the new turn holder is the one who pressed the button.
   */
  battleTurnChanged(after: GameState, endedByPlayerId: string): Promise<void>
  /** Java `GameAction.endGame` — every player. */
  gameEnded(game: GameState): Promise<void>
  /** Java `GameAction.deleteGame` — every player. */
  gameDeleted(game: GameState): Promise<void>
  /** Java `GameAction.addChat` — the other players, held until they open the game. */
  chatPosted(
    game: GameState,
    authorPlayerId: string,
    authorUsername: string,
    message: string,
  ): Promise<void>
  /** Java `TurnAction.update*` — the other players, held until they open the game. */
  phaseUpdated(
    game: GameState,
    authorPlayerId: string,
    authorUsername: string,
    phase: TurnPhase,
    order: string,
  ): Promise<void>
  /**
   * Java `PlayerAction.newPassword(ForgotpassDTO)` — the reset verification
   * link. Transactional: it ignores `disableEmail` and carries no unsubscribe
   * line, because unsubscribing from game mail must not lock a user out of
   * their own account.
   */
  passwordReset(email: string, link: string): Promise<void>
  /**
   * Java `GameAction.sendMailToAll(msg)` — the admin's message to every
   * account. Its old endpoint was commented out, so this is the first time it
   * is reachable. One personalised mail per eligible account, sent in batches.
   * Never throws: whatever stops the run is reported in the result, so the
   * admin can resume it with the `sentTo` addresses as the next `exclude`.
   */
  broadcast(options: BroadcastOptions): Promise<BroadcastResult>
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

export function createNotifications(config: NotificationsConfig): Notifications {
  const { repo, mailer } = config
  const appOrigin = (config.appOrigin ?? DEFAULT_APP_ORIGIN).replace(/\/+$/, '')
  const clock = config.now ?? ((): Date => new Date())
  const sleep =
    config.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)))

  const gameLink = (gameId: string): string => `${appOrigin}/game/${gameId}`

  // Java `SendEmail.UNSUBSCRIBE`: the same text, but on our own API host. The
  // issue asks for it on every mail, so even `sendYourTurn` carries it now.
  const unsubscribe = (playerId: string): string =>
    '\n\nIf you wish to unsubscribe from ALL emails, then push this link: ' +
    `${appOrigin}/api/admin/email/notification/${playerId}/stop`

  /**
   * The HTML twin of `unsubscribe`, so the link is clickable in the HTML body.
   * Same wording and destination as the plain-text footer; only the markup
   * differs.
   */
  const unsubscribeHtml = (playerId: string): string =>
    '<p>If you wish to unsubscribe from ALL emails, then push ' +
    `<a href="${appOrigin}/api/admin/email/notification/${playerId}/stop">this link</a></p>`

  /**
   * One recipient. Skips a missing account, a blank address and an account that
   * has unsubscribed, applies the per-game hold when `gameId` is given, then
   * sends. Never throws: a mail problem must not fail the game action that
   * triggered it.
   */
  async function notify(
    playerId: string,
    subject: string,
    body: string,
    gameId?: string,
  ): Promise<void> {
    try {
      const player = await repo.findPlayerById(playerId)
      if (player === undefined || player.email === null || player.email === '') return
      if (player.disableEmail === true) return

      if (gameId !== undefined) {
        // One atomic step: the repository decides and records the slot
        // together, so two concurrent actions cannot both send.
        const claimed = await repo.claimGameEmail(gameId, playerId, IN_GAME_COOLDOWN_MS, clock())
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
    held = false,
  ): Promise<void> {
    for (const player of game.players) {
      if (!include(player)) continue
      await notify(player.playerId, subject, body, held ? game.id : undefined)
    }
  }

  return {
    async gameOpened(game: GameState, viewerId: string): Promise<void> {
      if (!game.players.some((player) => player.playerId === viewerId)) return
      try {
        await repo.recordGameOpened(game.id, viewerId, clock())
      } catch (error) {
        console.error(`Recording that ${viewerId} opened ${game.id} failed`, error)
      }
    },

    async playerJoined(game: GameState, joinerPlayerId: string): Promise<void> {
      const joiner = game.players.find((player) => player.playerId === joinerPlayerId)
      const body =
        `${joiner?.username ?? 'A player'} joined ${game.name}. ` +
        `Go to ${appOrigin}/ to find out who!`
      await notifyPlayers(
        game,
        (player) => player.playerId !== joinerPlayerId,
        'Game update',
        body,
        true,
      )
    },

    async turnEnded(before: GameState, after: GameState): Promise<void> {
      const previous = before.players.find((player) => player.yourTurn)?.playerId
      const next = after.players.find((player) => player.yourTurn)
      if (next === undefined || next.playerId === previous) return
      // With chat orders on, `activeTurnStatus` describes the turn holder, not
      // the player who has the baton, so its phase would be the wrong advice.
      const status = after.chatOrders ? null : activeTurnStatus(after)
      const phaseText =
        status === null ? '' : ` Continue with the ${TURN_PHASE_LABEL[status.phase]} phase.`
      await notify(
        next.playerId,
        'It is your turn',
        `It's your turn to play in ${after.name}!${phaseText}\n\n` +
          `Go to ${gameLink(after.id)} to start your turn`,
        after.id,
      )
    },

    async turnHolderChanged(before: GameState, after: GameState): Promise<void> {
      if (!after.chatOrders) return
      const holder = turnHolder(after)
      if (holder === undefined || holder.playerId === turnHolder(before)?.playerId) return
      const status = activeTurnStatus(after)
      if (status === null) return
      await notify(
        holder.playerId,
        'It is your turn',
        `It is your turn: ${TURN_PHASE_LABEL[status.phase]}, turn ${status.turnNumber} in ${after.name}.\n\n` +
          `Go to ${gameLink(after.id)} to play`,
        after.id,
      )
    },

    async battleTurnChanged(after: GameState, endedByPlayerId: string): Promise<void> {
      const battle = after.battle
      if (battle === null) return
      const recipientId = battle[battle.turn].playerId
      if (recipientId === endedByPlayerId) return
      // Battle mail is outside the hold: every end-turn mails.
      await notify(
        recipientId,
        'Your battle turn',
        `It is your turn to play a unit in the battle arena in ${after.name}!\n\n` +
          `Go to ${gameLink(after.id)} to play your unit`,
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
        true,
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
        true,
      )
    },

    async passwordReset(email: string, link: string): Promise<void> {
      try {
        // Java `SendEmail.sendMessage` body, on our own host. No unsubscribe
        // line: this is the one mail that must always reach the account.
        await mailer.send({
          to: email,
          subject: 'Please verify your email',
          text:
            'Your password was requested to be changed. If you want to change your password ' +
            `then please press this link: ${link}`,
        })
      } catch (error) {
        console.error(`Password-reset email to ${email} failed`, error)
      }
    },

    /**
     * Java's `sendMailToAll` ran one `parallelStream` send per opted-in player
     * and told the caller nothing. A Worker may make only 50 subrequests per
     * request, so one fetch per recipient reached 49 of 555 accounts and counted
     * the rest as skipped (2026-10-03). Here the mails go out through the
     * provider's batch endpoint, within a fixed request budget, and everything
     * that did not go out is accounted for.
     */
    async broadcast(options: BroadcastOptions): Promise<BroadcastResult> {
      const startedAt = clock().getTime()
      const excluded = new Set((options.exclude ?? []).map(normaliseAddress))
      const skipped = { noAddress: 0, unsubscribed: 0, excluded: 0 }
      const failed: { email: string; reason: string }[] = []
      const eligible: BroadcastRecipient[] = []

      for (const player of await repo.allPlayers()) {
        // No address: nothing to send to. Same guard as `notify`.
        if (player.email === null || player.email === '') {
          skipped.noAddress += 1
        } else if (player.disableEmail === true && !options.includeUnsubscribed) {
          // Java's `!isDisableEmail()` filter, except the admin may deliberately
          // override it for this one mail.
          skipped.unsubscribed += 1
        } else if (excluded.has(normaliseAddress(player.email))) {
          skipped.excluded += 1
        } else if (!PLAUSIBLE_EMAIL.test(player.email)) {
          // Resend would reject the whole batch for this one address.
          failed.push({ email: player.email, reason: 'Not a valid email address' })
          console.error(`Broadcast to ${player.id} failed: not a valid email address`)
        } else {
          eligible.push({ id: player.id, username: player.username, email: player.email })
        }
      }

      const attempted = options.limit === undefined ? eligible : eligible.slice(0, options.limit)
      let deferred = eligible.length - attempted.length

      // The Markdown is the same for everyone; only the greeting and the
      // unsubscribe link differ, and the Worker's CPU time is small.
      const bodyHtml = renderMarkdown(options.markdown)
      const build = (recipient: BroadcastRecipient): OutgoingEmail => ({
        to: recipient.email,
        subject: options.subject,
        // Java: "Hello " + username + "\n" + msg, then sendMessage appended the
        // unsubscribe footer. A single newline after the greeting, as Java had.
        text: `Hello ${recipient.username}\n${options.markdown}${unsubscribe(recipient.id)}`,
        html:
          `<p>Hello ${escapeHtml(recipient.username)}</p>` +
          bodyHtml +
          unsubscribeHtml(recipient.id),
      })

      // A mailer without `sendBatch` is driven one mail per call, with no
      // request budget and no pause. That is only right because no mailer that
      // makes network calls lacks `sendBatch` (the no-op mailer and test doubles
      // do not): a new network mailer must implement `sendBatch`, or it will
      // spend a subrequest per recipient again.
      const sendBatch = mailer.sendBatch?.bind(mailer)
      const groupSize = sendBatch === undefined ? 1 : BROADCAST_BATCH_SIZE
      const queue: BroadcastRecipient[][] = []
      for (let at = 0; at < attempted.length; at += groupSize) {
        queue.push(attempted.slice(at, at + groupSize))
      }

      const sentTo: string[] = []
      let requests = 0
      let stopReason: string | null = null

      while (stopReason === null) {
        const group = queue.shift()
        if (group === undefined) break

        if (sendBatch !== undefined) {
          if (requests >= BROADCAST_REQUEST_BUDGET) {
            queue.unshift(group)
            stopReason =
              `Stopped after ${BROADCAST_REQUEST_BUDGET} provider requests, the most one run ` +
              'may make. Run again with the sent addresses in the skip list.'
            break
          }
          // Spaced out, but not before the first request.
          if (requests > 0) await sleep(BROADCAST_PAUSE_MS)
          if (clock().getTime() - startedAt >= BROADCAST_TIME_BUDGET_MS) {
            queue.unshift(group)
            stopReason =
              `Stopped after ${BROADCAST_TIME_BUDGET_MS / 1000} seconds, the longest one run ` +
              'may take, so that the result still reaches you. Run again with the sent ' +
              'addresses in the skip list.'
            break
          }
        }

        requests += 1
        try {
          if (sendBatch !== undefined) {
            await sendBatch(group.map(build))
          } else {
            const [only] = group
            if (only !== undefined) await mailer.send(build(only))
          }
          for (const recipient of group) sentTo.push(recipient.email)
        } catch (error) {
          const message = describeError(error)
          console.error(`Broadcast batch failed: ${message}`)
          if (error instanceof MailError && PER_MESSAGE_STATUSES.has(error.status)) {
            // One bad address makes Resend reject the whole batch (the batch
            // endpoint is all or nothing), so nothing in it was sent. Split it
            // until the culprit stands alone; each half costs a request. Other
            // 4xx codes (a bad key, a forbidden domain) are about the request,
            // not a message, and fall through to a stop.
            const [only] = group
            if (group.length === 1 && only !== undefined) {
              failed.push({ email: only.email, reason: message })
              console.error(`Broadcast to ${only.id} failed: ${message}`)
            } else {
              const middle = Math.ceil(group.length / 2)
              queue.unshift(group.slice(0, middle), group.slice(middle))
            }
          } else {
            queue.unshift(group)
            if (error instanceof MailError) {
              stopReason =
                error.status === 429
                  ? `The mail provider is rate limiting or out of quota (429): ${message}`
                  : `The mail provider answered ${error.status}: ${message}`
            } else {
              // No answer arrived, so the last request may or may not have
              // been accepted. The one case where a rerun could duplicate.
              stopReason =
                `Could not get an answer from the mail provider: ${message}. The last ` +
                'request may still have been accepted; check the provider log before sending again.'
            }
          }
        }
      }

      for (const group of queue) deferred += group.length

      return {
        sent: sentTo.length,
        sentTo,
        skipped,
        failed,
        deferred,
        stopReason,
      }
    },
  }
}

interface BroadcastRecipient {
  readonly id: string
  readonly username: string
  readonly email: string
}

const normaliseAddress = (address: string): string => address.trim().toLowerCase()

/**
 * Resend's error body is JSON with a `message`; keep just that when it parses,
 * since the admin reads it on a page. Anything else is shown as it came,
 * shortened.
 */
function describeError(error: unknown): string {
  if (error instanceof MailError) {
    try {
      const parsed: unknown = JSON.parse(error.detail)
      if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
        const { message } = parsed as { message: unknown }
        if (typeof message === 'string' && message !== '') return message
      }
    } catch {
      // Not JSON: fall through to the raw text.
    }
    return (error.detail || error.message).slice(0, 300)
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
}
