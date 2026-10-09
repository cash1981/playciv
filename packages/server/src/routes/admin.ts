/** Administrative account management. Roles are read from the current account
 * in storage on every request, so changing a role takes effect immediately. */

import type { App } from '../app.js'
import type { AppContext } from '../context.js'
import { asRecord, currentPlayer, requireAdminWith, requireString } from '../context.js'
import { sendError } from '../errors.js'
import { toPlayerDto } from './auth.js'
import type { PlayerUpdate, StoredPlayer, UserRole } from '../store/types.js'

export type AdminUserDto = ReturnType<typeof toPlayerDto> & {
  readonly createdAt: string
}

function toAdminUserDto(player: StoredPlayer): AdminUserDto {
  return {
    ...toPlayerDto(player),
    createdAt: player.createdAt,
  }
}

function isAdmin(player: StoredPlayer): boolean {
  return player.role === 'admin' && player.disabled !== true
}

function hasField(body: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, field)
}

/** Both the skip list and the per-run limit of the email broadcast stop here. */
const MAX_BROADCAST_LIST = 5000

/** Recipients per daily run of the broadcast queue: Resend's free plan allows 100 mails a day in all. */
const DEFAULT_PER_RUN = 50
const MAX_PER_RUN = 100

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** The optional `exclude` list of both broadcast routes; `'invalid'` for a wrong shape. */
function readExclude(body: Record<string, unknown>): string[] | undefined | 'invalid' {
  const value = body['exclude']
  if (value === undefined) return undefined
  return isStringArray(value) && value.length <= MAX_BROADCAST_LIST ? value : 'invalid'
}

/**
 * Games one cleanup request handles. The free plan allows 50 subrequests per
 * request. A game costs 2 when its newest revision is a keyframe (read the game,
 * delete) and 3 when it is a delta (read the game, rebuild the newest revision,
 * one batch that rewrites it and deletes the rest). Worst case 12 * 3 = 36, plus
 * the listing and the admin check, stays well under 50.
 */
const CLEANUP_GAMES_PER_REQUEST = 12

/**
 * What one compaction request may chew on. A conversion parses two states of up
 * to about 420 KB, diffs them and compares the rebuilt one with the original, and
 * a Worker on the free plan has about 10 ms of CPU per request. That work grows
 * with the size of the states, not the number of rows: measured on Node it is
 * about 4.4 ms per MB of state text, so 1 MB per request is about 5 ms there, 2
 * rows of the largest states or 11 of the smallest. See decisions.md (2026-10-03,
 * delta storage). The row cap only bounds the size of the batch.
 *
 * The budget is spent by every game a request visits, whatever it answers: a game
 * that fails its check still parsed its states, and the store reports those bytes.
 * A game is entered only while the budget left covers the least it can do (its
 * first row, twice when the state before it is rebuilt); the first game of a
 * request is always entered, or a game with huge states could never be compacted.
 * So a request parses at most the budget, except when a single first chunk is
 * larger than it by itself.
 */
export const COMPACT_BYTES_PER_REQUEST = 1_000_000
export const COMPACT_REVISIONS_PER_REQUEST = 40

/**
 * Games one compaction request visits. A game costs at most 6 subrequests (does it
 * exist, its rows, the state before the first conversion, the old rows, one batch,
 * and a re-read of the rows only when the batch did not apply as planned), taking
 * `db.batch()` as one subrequest however many statements it holds. The listing
 * (2) and the admin check (1) come on top: 5 games is at most 33 of the 50 the
 * free plan allows.
 */
const COMPACT_GAMES_PER_REQUEST = 5

function enabledAdminCount(players: readonly StoredPlayer[]): number {
  return players.filter(isAdmin).length
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function registerAdminRoutes(app: App, context: AppContext): void {
  const admin = requireAdminWith(context)

  app.get('/api/admin/users', admin, async (c) => {
    const players = await context.repo.allPlayers()
    return c.json(
      [...players]
        .sort((a, b) => a.username.localeCompare(b.username))
        .map(toAdminUserDto),
    )
  })

  app.patch('/api/admin/users/:userId', admin, async (c) => {
    const userId = c.req.param('userId')
    const target = await context.repo.findPlayerById(userId)
    if (target === undefined) {
      return sendError(c, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }

    const body = asRecord(await c.req.json().catch(() => ({})))
    const roleValue = body['role']
    const role: UserRole | undefined =
      roleValue === undefined ? undefined : roleValue === 'user' || roleValue === 'admin' ? roleValue : undefined
    if (roleValue !== undefined && role === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'role must be user or admin')
    }

    const disabledValue = body['disabled']
    if (disabledValue !== undefined && typeof disabledValue !== 'boolean') {
      return sendError(c, 400, 'BAD_REQUEST', 'disabled must be a boolean')
    }
    const disabled = disabledValue as boolean | undefined

    let email: string | null | undefined
    if (hasField(body, 'email')) {
      if (body['email'] === null) email = null
      else if (typeof body['email'] === 'string') email = body['email'].trim() || null
      else return sendError(c, 400, 'BAD_REQUEST', 'email must be a string or null')
    }

    let username: string | undefined
    if (hasField(body, 'username')) {
      if (typeof body['username'] !== 'string') {
        return sendError(c, 400, 'BAD_REQUEST', 'username must be a string')
      }
      const trimmed = body['username'].trim()
      if (trimmed === '') {
        return sendError(c, 400, 'BAD_REQUEST', 'username must not be empty')
      }
      // Usernames are the login identity and are matched case-insensitively, so a
      // rename may only reuse a name if it is the target's own (e.g. a case fix).
      const clash = await context.repo.findPlayerByUsername(trimmed)
      if (clash !== undefined && clash.id !== target.id) {
        return sendError(c, 409, 'USERNAME_TAKEN', `Username ${trimmed} is already in use`)
      }
      username = trimmed
    }

    if (role === undefined && disabled === undefined && email === undefined && username === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'At least one user field is required')
    }

    const me = currentPlayer(c)
    const removesOwnAccess = target.id === me.id && (role === 'user' || disabled === true)
    if (removesOwnAccess) {
      return sendError(c, 409, 'SELF_LOCKOUT', 'You cannot disable or demote your own account')
    }

    const targetIsEnabledAdmin = isAdmin(target)
    const removesAdminAccess = targetIsEnabledAdmin && (role === 'user' || disabled === true)
    if (removesAdminAccess) {
      const players = await context.repo.allPlayers()
      if (enabledAdminCount(players) <= 1) {
        return sendError(c, 409, 'LAST_ADMIN', 'At least one enabled admin is required')
      }
    }

    const changes: PlayerUpdate = {
      ...(username !== undefined ? { username } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(disabled !== undefined ? { disabled } : {}),
    }
    const updated = await context.repo.updatePlayer(target.id, changes)
    if (updated === undefined) {
      return sendError(c, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }
    return c.json(toAdminUserDto(updated))
  })

  app.delete('/api/admin/users/:userId', admin, async (c) => {
    const userId = c.req.param('userId')
    const target = await context.repo.findPlayerById(userId)
    if (target === undefined) {
      return sendError(c, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }

    const me = currentPlayer(c)
    if (target.id === me.id) {
      return sendError(c, 409, 'SELF_LOCKOUT', 'You cannot delete your own account')
    }
    if (isAdmin(target)) {
      const players = await context.repo.allPlayers()
      if (enabledAdminCount(players) <= 1) {
        return sendError(c, 409, 'LAST_ADMIN', 'At least one enabled admin is required')
      }
    }

    const deleted = await context.repo.deletePlayer(target.id)
    if (!deleted) {
      return sendError(c, 404, 'USER_NOT_FOUND', `No user with id ${userId}`)
    }
    return c.body(null, 204)
  })

  /**
   * The admin email broadcast (issue #92). Java's `PUT /admin/mail` had the
   * body commented out and always answered 204; this is the reachable version,
   * with a Markdown body the server renders to HTML.
   */
  app.post('/api/admin/email/broadcast', admin, async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const subject = requireString(body, 'subject')
    const markdown = requireString(body, 'markdown')
    if (subject === undefined || markdown === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'subject and markdown are required')
    }

    // Same shape as the user PATCH route's `disabled`: a boolean when present.
    const includeValue = body['includeUnsubscribed']
    if (includeValue !== undefined && typeof includeValue !== 'boolean') {
      return sendError(c, 400, 'BAD_REQUEST', 'includeUnsubscribed must be a boolean')
    }

    const exclude = readExclude(body)
    if (exclude === 'invalid') {
      return sendError(
        c,
        400,
        'BAD_REQUEST',
        `exclude must be an array of at most ${MAX_BROADCAST_LIST} strings`,
      )
    }
    const limitValue = body['limit']
    if (
      limitValue !== undefined &&
      (typeof limitValue !== 'number' ||
        !Number.isInteger(limitValue) ||
        limitValue < 1 ||
        limitValue > MAX_BROADCAST_LIST)
    ) {
      return sendError(
        c,
        400,
        'BAD_REQUEST',
        `limit must be an integer from 1 to ${MAX_BROADCAST_LIST}`,
      )
    }

    const result = await context.notifications.broadcast({
      subject,
      markdown,
      includeUnsubscribed: includeValue === true,
      ...(exclude === undefined ? {} : { exclude }),
      ...(limitValue === undefined ? {} : { limit: limitValue }),
    })
    return c.json(result)
  })

  /**
   * The same broadcast spread over several days (the broadcast queue). The
   * recipients are fixed now; the daily job, or "send next batch now", sends
   * `perRun` of them at a time.
   */
  app.post('/api/admin/email/broadcast/queue', admin, async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const subject = requireString(body, 'subject')
    const markdown = requireString(body, 'markdown')
    if (subject === undefined || markdown === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'subject and markdown are required')
    }
    const includeValue = body['includeUnsubscribed']
    if (includeValue !== undefined && typeof includeValue !== 'boolean') {
      return sendError(c, 400, 'BAD_REQUEST', 'includeUnsubscribed must be a boolean')
    }
    const exclude = readExclude(body)
    if (exclude === 'invalid') {
      return sendError(
        c,
        400,
        'BAD_REQUEST',
        `exclude must be an array of at most ${MAX_BROADCAST_LIST} strings`,
      )
    }
    // `=== undefined`, not `??`: an explicit null is a wrong type, not the default.
    const perRunValue = body['perRun'] === undefined ? DEFAULT_PER_RUN : body['perRun']
    if (
      typeof perRunValue !== 'number' ||
      !Number.isInteger(perRunValue) ||
      perRunValue < 1 ||
      perRunValue > MAX_PER_RUN
    ) {
      return sendError(c, 400, 'BAD_REQUEST', `perRun must be an integer from 1 to ${MAX_PER_RUN}`)
    }

    const result = await context.notifications.queueBroadcast({
      subject,
      markdown,
      includeUnsubscribed: includeValue === true,
      perRun: perRunValue,
      ...(exclude === undefined ? {} : { exclude }),
    })
    if (!result.ok) {
      return result.reason === 'ALREADY_ACTIVE'
        ? sendError(c, 409, 'BROADCAST_ACTIVE', 'A broadcast is already queued; cancel it or let it finish')
        : sendError(c, 400, 'NO_RECIPIENTS', 'No account is eligible for this message')
    }
    return c.json(
      { queue: result.queue, skipped: result.skipped, rejected: result.rejected },
      201,
    )
  })

  app.get('/api/admin/email/broadcast/queue', admin, async (c) =>
    c.json({ queue: await context.notifications.queuedBroadcastStatus() }),
  )

  app.post('/api/admin/email/broadcast/queue/run', admin, async (c) => {
    const run = await context.notifications.runQueuedBroadcast(new Date())
    if (!run.ran) {
      return sendError(c, 409, 'NO_ACTIVE_BROADCAST', 'There is no queued broadcast to send')
    }
    return c.json({ run, queue: await context.notifications.queuedBroadcastStatus() })
  })

  /**
   * The owner's decision about rows a run left in `sending`: they may already
   * have been delivered, so only the admin can say they are safe to send again.
   */
  app.post('/api/admin/email/broadcast/queue/release-stuck', admin, async (c) => {
    const result = await context.notifications.releaseStuckQueuedRecipients()
    if (!result.ok) {
      return result.reason === 'RECENT_RUN'
        ? sendError(
            c,
            409,
            'RUN_IN_PROGRESS',
            'A run started less than five minutes ago; wait and try again',
          )
        : sendError(c, 409, 'NO_ACTIVE_BROADCAST', 'There is no queued broadcast to release rows in')
    }
    return c.json({ released: result.released, queue: result.queue })
  })

  app.post('/api/admin/email/broadcast/queue/cancel', admin, async (c) => {
    const queue = await context.notifications.cancelQueuedBroadcast()
    if (queue === null) {
      return sendError(c, 409, 'NO_ACTIVE_BROADCAST', 'There is no queued broadcast to cancel')
    }
    return c.json({ queue })
  })

  /**
   * The dry run of the finished-game cleanup. Only counts and names leave the
   * repository, never a state. Games with nothing to remove are left out; the
   * list is what a cleanup would act on.
   */
  app.get('/api/admin/games/cleanup', admin, async (c) => {
    const usage = (await context.repo.finishedGameRevisionUsage()).filter(
      (game) => game.removableRevisions > 0,
    )
    return c.json({
      games: usage.map((game) => ({
        id: game.gameId,
        name: game.name,
        revisions: game.revisions,
        removableRevisions: game.removableRevisions,
        removableBytes: game.removableBytes,
      })),
      totalRevisions: sum(usage.map((game) => game.removableRevisions)),
      totalBytes: sum(usage.map((game) => game.removableBytes)),
    })
  })

  /**
   * Shrinks finished games to their newest revision (the final board, log and
   * chat stay; the step by step replay goes). `gameId` names one game, no
   * `gameId` takes the largest finished games, at most
   * `CLEANUP_GAMES_PER_REQUEST` of them, and says how many are left.
   */
  app.post('/api/admin/games/cleanup', admin, async (c) => {
    // A body that is not an object is refused rather than read as "every game".
    const parsed: unknown = await c.req.json().catch(() => undefined)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return sendError(c, 400, 'BAD_REQUEST', 'Send a JSON object, with gameId to clean one game')
    }
    const body = asRecord(parsed)
    const gameId = body['gameId']
    if (gameId !== undefined && (typeof gameId !== 'string' || gameId.trim() === '')) {
      return sendError(c, 400, 'BAD_REQUEST', 'gameId must be a non-empty string')
    }

    const targets =
      gameId === undefined
        ? (await context.repo.finishedGameRevisionUsage()).filter(
            (game) => game.removableRevisions > 0,
          )
        : await context.repo.finishedGameRevisionUsage(gameId)
    // A named game goes through the delete even when it is not in the list, so a
    // running or unknown one gets its own answer instead of an empty success.
    const batch =
      gameId === undefined
        ? targets.slice(0, CLEANUP_GAMES_PER_REQUEST)
        : [{ gameId, name: targets[0]?.name ?? gameId, removableBytes: targets[0]?.removableBytes ?? 0 }]

    const games: { id: string; name: string; removedRevisions: number; removedBytes: number }[] = []
    for (const game of batch) {
      const result = await context.repo.deleteOldGameRevisions(game.gameId)
      if (result.status !== 'cleaned') {
        // In an all-games run the game changed after the listing (deleted, or no
        // longer finished): skip it, so the report of the games already cleaned
        // is not thrown away. A named game gets its own error.
        if (gameId === undefined) continue
        if (result.status === 'not-found') {
          return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${game.gameId}`)
        }
        return result.status === 'changed'
          ? sendError(c, 409, 'GAME_CHANGED', 'The game changed while it was cleaned up; try again')
          : sendError(
              c,
              409,
              'GAME_ACTIVE',
              'The game is still running; only finished games can be cleaned up',
            )
      }
      games.push({
        id: game.gameId,
        name: game.name,
        removedRevisions: result.removed,
        removedBytes: result.removed > 0 ? game.removableBytes : 0,
      })
    }
    return c.json({
      games,
      totalRevisions: sum(games.map((game) => game.removedRevisions)),
      totalBytes: sum(games.map((game) => game.removedBytes)),
      remaining: gameId === undefined ? targets.length - batch.length : 0,
    })
  })

  /**
   * The dry run of the revision compaction (issue #238, phase 2): per game, how
   * many revisions it has, how many are still full states from before delta
   * storage and roughly what compacting them frees. Counts and names only; no
   * state, and never a stored delta, leaves the repository.
   */
  app.get('/api/admin/games/revisions/compact', admin, async (c) => {
    const usage = (await context.repo.revisionCompactionUsage()).filter(
      (game) => game.fullRevisions > 0,
    )
    return c.json({
      games: usage.map((game) => ({
        id: game.gameId,
        name: game.name,
        active: game.active,
        revisions: game.revisions,
        fullRevisions: game.fullRevisions,
        freeableBytes: game.freeableBytes,
      })),
      totalRevisions: sum(usage.map((game) => game.fullRevisions)),
      totalBytes: sum(usage.map((game) => game.freeableBytes)),
    })
  })

  /**
   * Turns the full-state revisions of one game (`gameId`) or of the games with
   * the most to gain into delta chains, as many as fit in
   * `COMPACT_BYTES_PER_REQUEST` of state text per request, and says how many games still have work left so the
   * admin can press again. Every conversion is rebuilt and compared with the
   * original before anything is written; a game that fails the check is left as
   * it was and reported with the revision where it went wrong. A running game is
   * safe: its newest revision is never touched.
   */
  app.post('/api/admin/games/revisions/compact', admin, async (c) => {
    // A body that is not an object is refused rather than read as "every game".
    const parsed: unknown = await c.req.json().catch(() => undefined)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return sendError(c, 400, 'BAD_REQUEST', 'Send a JSON object, with gameId to compact one game')
    }
    const gameId = asRecord(parsed)['gameId']
    if (gameId !== undefined && (typeof gameId !== 'string' || gameId.trim() === '')) {
      return sendError(c, 400, 'BAD_REQUEST', 'gameId must be a non-empty string')
    }

    const listed = await context.repo.revisionCompactionUsage(gameId)
    const targets =
      gameId === undefined
        ? [...listed].filter((game) => game.fullRevisions > 0).sort(
            (left, right) => right.freeableBytes - left.freeableBytes || left.gameId.localeCompare(right.gameId),
          )
        : listed
    if (gameId !== undefined && targets.length === 0) {
      return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }

    type GameReport =
      | { id: string; name: string; status: 'compacted'; converted: number; keyframes: number; freedBytes: number; remaining: number }
      | { id: string; name: string; status: 'mismatch'; revision: number }
    const games: GameReport[] = []
    let revisionBudget = COMPACT_REVISIONS_PER_REQUEST
    let byteBudget = COMPACT_BYTES_PER_REQUEST
    let visited = 0
    let remainingGames = 0
    let remainingRevisions = 0
    for (const game of targets) {
      const affordable = visited === 0 || (revisionBudget > 0 && byteBudget >= game.nextChunkBytes)
      if (!affordable || visited >= COMPACT_GAMES_PER_REQUEST) {
        remainingGames += game.fullRevisions > 0 ? 1 : 0
        remainingRevisions += game.fullRevisions
        continue
      }
      visited += 1
      const result = await context.repo.compactGameRevisions(game.gameId, revisionBudget, byteBudget)
      if (result.status === 'not-found') continue
      // Every answer spent some of the request, a failed check included.
      revisionBudget -= result.handledRows
      byteBudget -= result.handledBytes
      if (result.status === 'mismatch') {
        games.push({ id: game.gameId, name: game.name, status: 'mismatch', revision: result.revision })
        remainingGames += 1
        remainingRevisions += game.fullRevisions
        continue
      }
      games.push({
        id: game.gameId,
        name: game.name,
        status: 'compacted',
        converted: result.converted,
        keyframes: result.keyframes,
        freedBytes: result.freedBytes,
        remaining: result.remaining,
      })
      remainingGames += result.remaining > 0 ? 1 : 0
      remainingRevisions += result.remaining
    }
    const compacted = games.flatMap((game) => (game.status === 'compacted' ? [game] : []))
    return c.json({
      games,
      totalConverted: sum(compacted.map((game) => game.converted)),
      totalBytes: sum(compacted.map((game) => game.freedBytes)),
      remaining: remainingGames,
      remainingRevisions,
    })
  })
}
