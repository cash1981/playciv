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

import { newId } from './auth.js'
import type { Mailer, OutgoingEmail } from './mail.js'
import { MailError } from './mail.js'
import { escapeHtml, renderMarkdown } from './markdown.js'
import type {
  BroadcastCounts,
  BroadcastStatus,
  Repository,
  StoredBroadcast,
  StoredPlayer,
} from './store/types.js'

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

/**
 * How soon after a run started the admin may release stuck rows. A run holds
 * its claimed rows in `sending` for at most the 45 s time budget plus one 15 s
 * batch timeout; five minutes is well past that. Releasing earlier could free
 * the rows of a run that is still sending, and its mails would then go out
 * again on the next run.
 */
export const RELEASE_COOLDOWN_MS = 5 * 60 * 1000

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

export interface QueueBroadcastOptions {
  readonly subject: string
  readonly markdown: string
  readonly includeUnsubscribed: boolean
  /** Recipients per daily run. */
  readonly perRun: number
  readonly exclude?: readonly string[]
}

/** Progress of a queued broadcast: what the admin page and the status route show. */
export interface BroadcastQueueStatus {
  readonly id: string
  readonly subject: string
  readonly status: BroadcastStatus
  readonly perRun: number
  readonly includeUnsubscribed: boolean
  readonly createdAt: string
  readonly lastRunAt: string | null
  readonly counts: BroadcastCounts
  readonly failed: readonly { readonly email: string; readonly reason: string }[]
  /**
   * Addresses left in `sending`: a run took them and never reported back, so the
   * mail may or may not have been delivered. They are never resent by
   * themselves; the owner checks the provider's log and decides.
   */
  readonly stuck: readonly string[]
}

export type QueueBroadcastResult =
  | {
      readonly ok: true
      readonly queue: BroadcastQueueStatus
      /** Accounts left out when the queue was made, by reason. */
      readonly skipped: BroadcastResult['skipped']
      /** Addresses that look invalid, so were not queued. */
      readonly rejected: readonly { readonly email: string; readonly reason: string }[]
    }
  | { readonly ok: false; readonly reason: 'ALREADY_ACTIVE' | 'NO_RECIPIENTS' }

export type ReleaseStuckResult =
  | { readonly ok: true; readonly released: number; readonly queue: BroadcastQueueStatus }
  | { readonly ok: false; readonly reason: 'NO_ACTIVE_BROADCAST' | 'RECENT_RUN' }

/** What one run of the daily job did. */
export interface BroadcastRunResult {
  /** False when there was no active queue to run. */
  readonly ran: boolean
  readonly sent: number
  readonly failed: number
  /** Claimed but not sent (a stop), put back to pending for the next run. */
  readonly released: number
  /**
   * Claimed, and the provider gave no answer (a timeout, a failed fetch): they
   * may have been delivered, so they stay `sending` and show as stuck.
   */
  readonly indeterminate: number
  readonly stopReason: string | null
  /** True when this run left nothing pending and closed the queue. */
  readonly finished: boolean
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
  /**
   * The same message, spread over several days: snapshots the eligible
   * accounts now and leaves the sending to the daily job
   * (`runQueuedBroadcast`). Only one queue may be active at a time.
   */
  queueBroadcast(options: QueueBroadcastOptions): Promise<QueueBroadcastResult>
  /**
   * One run of the daily job (also the admin's "send next batch now"): claims
   * up to `perRun` pending recipients of the active queue and sends them. A
   * quiet no-op when no queue is active. Never throws on a provider problem;
   * a repository failure does throw, for the caller to log.
   */
  runQueuedBroadcast(now: Date): Promise<BroadcastRunResult>
  /** The active queue, or failing that the latest one; `null` when none was ever made. */
  queuedBroadcastStatus(): Promise<BroadcastQueueStatus | null>
  /** Cancels the active queue; pending recipients are never sent. `null` when none is active. */
  cancelQueuedBroadcast(): Promise<BroadcastQueueStatus | null>
  /**
   * Puts the active queue's stuck (`sending`) recipients back to pending, so the
   * next run mails them. They may already have been delivered: the caller must
   * have checked the provider's log. Refused (`RECENT_RUN`) for
   * `RELEASE_COOLDOWN_MS` after a run started, because that run may still be
   * sending the rows it claimed.
   */
  releaseStuckQueuedRecipients(): Promise<ReleaseStuckResult>
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

  /**
   * The mail for one broadcast recipient. The Markdown is rendered once, here,
   * because it is the same for everyone; only the greeting and the unsubscribe
   * link differ, and the Worker's CPU time is small.
   */
  function broadcastMailBuilder(
    subject: string,
    markdown: string,
  ): (recipient: BroadcastRecipient) => OutgoingEmail {
    const bodyHtml = renderMarkdown(markdown)
    return (recipient) => ({
      to: recipient.email,
      subject,
      // Java: "Hello " + username + "\n" + msg, then sendMessage appended the
      // unsubscribe footer. A single newline after the greeting, as Java had.
      text: `Hello ${recipient.username}\n${markdown}${unsubscribe(recipient.id)}`,
      html:
        `<p>Hello ${escapeHtml(recipient.username)}</p>` +
        bodyHtml +
        unsubscribeHtml(recipient.id),
    })
  }

  /**
   * Sends the recipients through the provider's batch endpoint, in order, and
   * accounts for every one of them: `sent`, `failed` (a bad address, found by
   * splitting), `indeterminate` (a request that got no answer) or `unsent` (the
   * run stopped before trying them). Shared by the direct
   * broadcast and the daily queue, so both keep the same budgets and rules.
   * Never throws.
   */
  async function sendInBatches(
    recipients: readonly BroadcastRecipient[],
    build: (recipient: BroadcastRecipient) => OutgoingEmail,
    startedAt: number,
  ): Promise<BatchOutcome> {
    // A mailer without `sendBatch` is driven one mail per call, with no
    // request budget and no pause. That is only right because no mailer that
    // makes network calls lacks `sendBatch` (the no-op mailer and test doubles
    // do not): a new network mailer must implement `sendBatch`, or it will
    // spend a subrequest per recipient again.
    const sendBatch = mailer.sendBatch?.bind(mailer)
    const groupSize = sendBatch === undefined ? 1 : BROADCAST_BATCH_SIZE
    const queue: BroadcastRecipient[][] = []
    for (let at = 0; at < recipients.length; at += groupSize) {
      queue.push(recipients.slice(at, at + groupSize))
    }

    const sent: BroadcastRecipient[] = []
    const failed: { recipient: BroadcastRecipient; reason: string }[] = []
    const indeterminate: BroadcastRecipient[] = []
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
            `Stopped after about ${BROADCAST_TIME_BUDGET_MS / 1000} seconds, the longest one ` +
            'run may take (it can overrun by about one request), so that the result still ' +
            'reaches you. Run again with the sent addresses in the skip list.'
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
        sent.push(...group)
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
            failed.push({ recipient: only, reason: message })
            console.error(`Broadcast to ${only.id} failed: ${message}`)
          } else {
            const middle = Math.ceil(group.length / 2)
            queue.unshift(group.slice(0, middle), group.slice(middle))
          }
        } else if (error instanceof MailError) {
          // The provider answered, so nothing in this group was sent: it goes
          // back on the queue as not attempted.
          queue.unshift(group)
          stopReason =
            error.status === 429
              ? `The mail provider is rate limiting or out of quota (429): ${message}`
              : `The mail provider answered ${error.status}: ${message}`
        } else {
          // No answer arrived (a timeout, an aborted or failed fetch), so the
          // request may or may not have been accepted. These recipients are
          // neither sent nor safely unsent: the queue must not hand them out
          // again by itself, because that is the one case that can duplicate.
          indeterminate.push(...group)
          stopReason =
            `Could not get an answer from the mail provider: ${message}. The last ` +
            'request may still have been accepted; check the provider log before sending again.'
        }
      }
    }

    return { sent, failed, indeterminate, unsent: queue.flat(), stopReason }
  }

  async function queueStatusOf(broadcast: StoredBroadcast): Promise<BroadcastQueueStatus> {
    const [counts, failedRows, stuckRows] = await Promise.all([
      repo.broadcastCounts(broadcast.id),
      repo.listBroadcastRecipients(broadcast.id, 'failed'),
      repo.listBroadcastRecipients(broadcast.id, 'sending'),
    ])
    return {
      id: broadcast.id,
      subject: broadcast.subject,
      status: broadcast.status,
      perRun: broadcast.perRun,
      includeUnsubscribed: broadcast.includeUnsubscribed,
      createdAt: broadcast.createdAt,
      lastRunAt: broadcast.lastRunAt,
      counts,
      failed: failedRows.map((row) => ({ email: row.email, reason: row.error ?? '' })),
      stuck: stuckRows.map((row) => row.email),
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
      const { eligible, skipped, rejected } = classifyRecipients(await repo.allPlayers(), options)
      const failed: { email: string; reason: string }[] = []
      for (const entry of rejected) {
        failed.push({ email: entry.email, reason: entry.reason })
        console.error(`Broadcast to ${entry.id} failed: ${entry.reason.toLowerCase()}`)
      }

      const attempted = options.limit === undefined ? eligible : eligible.slice(0, options.limit)
      const outcome = await sendInBatches(
        attempted,
        broadcastMailBuilder(options.subject, options.markdown),
        startedAt,
      )
      for (const failure of outcome.failed) {
        failed.push({ email: failure.recipient.email, reason: failure.reason })
      }

      return {
        sent: outcome.sent.length,
        sentTo: outcome.sent.map((recipient) => recipient.email),
        skipped,
        failed,
        deferred:
          eligible.length - attempted.length + outcome.unsent.length + outcome.indeterminate.length,
        stopReason: outcome.stopReason,
      }
    },

    async queueBroadcast(options: QueueBroadcastOptions): Promise<QueueBroadcastResult> {
      // Refuse early, before scanning every account. The unique index on an
      // active status is still the real guard against two racing requests.
      if ((await repo.currentBroadcast())?.status === 'active') {
        return { ok: false, reason: 'ALREADY_ACTIVE' }
      }
      const { eligible, skipped, rejected } = classifyRecipients(await repo.allPlayers(), options)
      if (eligible.length === 0) return { ok: false, reason: 'NO_RECIPIENTS' }

      const broadcast: StoredBroadcast = {
        id: newId(),
        subject: options.subject,
        markdown: options.markdown,
        includeUnsubscribed: options.includeUnsubscribed,
        perRun: options.perRun,
        status: 'active',
        createdAt: clock().toISOString(),
        lastRunAt: null,
      }
      const created = await repo.createBroadcast(
        broadcast,
        eligible.map((recipient) => ({ playerId: recipient.id, email: recipient.email })),
      )
      if (!created) return { ok: false, reason: 'ALREADY_ACTIVE' }

      return {
        ok: true,
        queue: await queueStatusOf(broadcast),
        skipped,
        rejected: rejected.map(({ email, reason }) => ({ email, reason })),
      }
    },

    async runQueuedBroadcast(now: Date): Promise<BroadcastRunResult> {
      const idle: BroadcastRunResult = {
        ran: false,
        sent: 0,
        failed: 0,
        released: 0,
        indeterminate: 0,
        stopReason: null,
        finished: false,
      }
      const broadcast = await repo.currentBroadcast()
      if (broadcast === undefined || broadcast.status !== 'active') return idle

      const startedAt = clock().getTime()
      // Rows go to `sending` here. Two things free them again: this run's own
      // release below (when the provider refused or it stopped before trying),
      // and the admin's release-stuck action, which is held back for
      // `RELEASE_COOLDOWN_MS` so it cannot free a run that is still sending. A
      // crash from this point on leaves them `sending`, never resent by itself.
      const claimed = await repo.claimBroadcastRecipients(broadcast.id, broadcast.perRun)
      // A day that claimed nothing is not a run worth showing.
      if (claimed.length > 0) await repo.recordBroadcastRun(broadcast.id, now.toISOString())

      // One read for all of them: a scheduled run has the same 50-query allowance
      // as a request, and a lookup per recipient would use it up.
      const players = new Map(
        (claimed.length === 0 ? [] : await repo.allPlayers()).map((player) => [player.id, player]),
      )
      const failures: { playerId: string; error: string }[] = []
      const sendable: BroadcastRecipient[] = []
      for (const row of claimed) {
        const player = players.get(row.playerId)
        if (player === undefined) {
          failures.push({ playerId: row.playerId, error: 'The account no longer exists' })
        } else if (player.disableEmail === true && !broadcast.includeUnsubscribed) {
          failures.push({ playerId: row.playerId, error: 'unsubscribed since queueing' })
        } else {
          // The current username and a fresh unsubscribe link, but the address
          // that was queued (and checked against the skip list).
          sendable.push({ id: row.playerId, username: player.username, email: row.email })
        }
      }

      const outcome = await sendInBatches(
        sendable,
        broadcastMailBuilder(broadcast.subject, broadcast.markdown),
        startedAt,
      )
      for (const failure of outcome.failed) {
        failures.push({ playerId: failure.recipient.id, error: failure.reason })
      }

      await repo.markBroadcastRecipientsSent(
        broadcast.id,
        outcome.sent.map((recipient) => recipient.id),
        now.toISOString(),
      )
      await repo.markBroadcastRecipientsFailed(broadcast.id, failures)
      await repo.releaseBroadcastRecipients(
        broadcast.id,
        outcome.unsent.map((recipient) => recipient.id),
      )

      // Only a refusal or a stop before sending frees a row. A request with no
      // answer (`indeterminate`) stays `sending`: it may have been delivered.
      // This run's own rows are settled above, so what is still `sending` now
      // is stuck, and a queue with stuck rows is not finished: the owner
      // either releases them or cancels.
      const counts = await repo.broadcastCounts(broadcast.id)
      const finished =
        counts.pending === 0 && counts.sending === 0 && (await repo.finishBroadcast(broadcast.id, 'done'))

      return {
        ran: true,
        sent: outcome.sent.length,
        failed: failures.length,
        released: outcome.unsent.length,
        indeterminate: outcome.indeterminate.length,
        stopReason: outcome.stopReason,
        finished,
      }
    },

    async queuedBroadcastStatus(): Promise<BroadcastQueueStatus | null> {
      const broadcast = await repo.currentBroadcast()
      return broadcast === undefined ? null : queueStatusOf(broadcast)
    },

    async cancelQueuedBroadcast(): Promise<BroadcastQueueStatus | null> {
      const broadcast = await repo.currentBroadcast()
      if (broadcast === undefined || broadcast.status !== 'active') return null
      await repo.finishBroadcast(broadcast.id, 'cancelled')
      return queueStatusOf({ ...broadcast, status: 'cancelled' })
    },

    async releaseStuckQueuedRecipients(): Promise<ReleaseStuckResult> {
      const broadcast = await repo.currentBroadcast()
      if (broadcast === undefined || broadcast.status !== 'active') {
        return { ok: false, reason: 'NO_ACTIVE_BROADCAST' }
      }
      // `lastRunAt` only moves on a day that claimed rows, so a queue that is
      // purely stuck (its last run long ago) can be released at once.
      if (
        broadcast.lastRunAt !== null &&
        clock().getTime() - Date.parse(broadcast.lastRunAt) < RELEASE_COOLDOWN_MS
      ) {
        return { ok: false, reason: 'RECENT_RUN' }
      }
      const released = await repo.releaseStuckBroadcastRecipients(broadcast.id)
      return { ok: true, released, queue: await queueStatusOf(broadcast) }
    },
  }
}

/**
 * The daily job's entry point, called from the Worker's `scheduled` handler:
 * runs one batch of the queue and logs the outcome. A scheduled run has nobody
 * to answer to, so a failure is logged (with the message in the string, since a
 * second argument prints only the stack on Workers) and never rethrown.
 */
export async function runDailyBroadcast(
  notifications: Pick<Notifications, 'runQueuedBroadcast'>,
  now: Date,
): Promise<void> {
  try {
    const result = await notifications.runQueuedBroadcast(now)
    if (!result.ran) return
    console.log(
      `Daily broadcast: sent ${result.sent}, failed ${result.failed}, ` +
        `released ${result.released}, unconfirmed ${result.indeterminate}${result.finished ? ', queue finished' : ''}` +
        (result.stopReason === null ? '' : `, stopped: ${result.stopReason}`),
    )
  } catch (error) {
    console.error(`Daily broadcast failed: ${describeError(error)}`)
  }
}

interface BroadcastRecipient {
  readonly id: string
  readonly username: string
  readonly email: string
}

interface BatchOutcome {
  readonly sent: readonly BroadcastRecipient[]
  readonly failed: readonly { readonly recipient: BroadcastRecipient; readonly reason: string }[]
  /** In a request that got no answer: it may have been delivered. */
  readonly indeterminate: readonly BroadcastRecipient[]
  /** Not attempted, or answered with a refusal, because the run stopped: safe to try again. */
  readonly unsent: readonly BroadcastRecipient[]
  readonly stopReason: string | null
}

/**
 * Sorts the accounts for a broadcast, direct or queued, by the same rules:
 * no address, unsubscribed (unless included), on the skip list, an address
 * that would make Resend reject a whole batch, or eligible.
 */
function classifyRecipients(
  players: readonly StoredPlayer[],
  options: { readonly includeUnsubscribed: boolean; readonly exclude?: readonly string[] | undefined },
): {
  readonly eligible: BroadcastRecipient[]
  readonly skipped: BroadcastResult['skipped']
  readonly rejected: { readonly id: string; readonly email: string; readonly reason: string }[]
} {
  const excluded = new Set((options.exclude ?? []).map(normaliseAddress))
  const skipped = { noAddress: 0, unsubscribed: 0, excluded: 0 }
  const rejected: { id: string; email: string; reason: string }[] = []
  const eligible: BroadcastRecipient[] = []
  for (const player of players) {
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
      rejected.push({ id: player.id, email: player.email, reason: 'Not a valid email address' })
    } else {
      eligible.push({ id: player.id, username: player.username, email: player.email })
    }
  }
  return { eligible, skipped, rejected }
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
