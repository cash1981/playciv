/**
 * The bits every route builds on: the signed-in player, loading and saving a
 * game, and wrapping the engine `Result` in an HTTP response.
 */

import type { EngineError, GameState, PlayerView, Playerhand } from '@civ/engine'
import { expireTradeOffers, toPlayerView } from '@civ/engine'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'

import type { ResetTokenSigner, TokenSigner } from './auth.js'
import { newId } from './auth.js'
import { sendEngineError, sendError } from './errors.js'
import type { Notifications } from './notifications.js'
import { sameJson } from './revision-delta.js'
import type { GameRevision, Repository, StoredPlayer } from './store/types.js'

export interface AppContext {
  readonly repo: Repository
  readonly tokens: TokenSigner
  /** Signs the password-reset links (issue #37); a key separate from `tokens`. */
  readonly resetTokens: ResetTokenSigner
  readonly notifications: Notifications
  /** Absolute base URL of the web app, used in email links. */
  readonly appOrigin: string
}

/** The Hono context variables set once `authenticate` has run. */
export type Variables = { player: StoredPlayer }

/** Requires a valid bearer token and puts the player on the context. */
export function authenticateWith(context: AppContext) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const header = c.req.header('authorization')
    if (header === undefined || !header.startsWith('Bearer ')) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Missing bearer token')
    }

    const payload = context.tokens.verify(header.slice('Bearer '.length))
    if (payload === undefined) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Invalid or expired token')
    }

    const player = await context.repo.findPlayerById(payload.playerId)
    if (player === undefined) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Unknown player')
    }

    if (player.disabled === true) {
      return sendError(c, 403, 'ACCOUNT_DISABLED', 'This account is disabled')
    }

    c.set('player', player)
    await next()
  })
}

/**
 * Like `authenticateWith`, but a request with no bearer token at all is not
 * an error — the route runs anyway, with `currentPlayer` unavailable. For
 * routes that project a `PlayerView`-shaped response, an absent viewer works
 * the same way a non-member viewer already does: `toPlayerView` returns
 * `you: null` and only public data (issue #81 — read-only viewing).
 *
 * A token that *is* present but invalid, expired or disabled still answers
 * 401/403 exactly like `authenticateWith` — silently downgrading it to
 * "spectator" would hide a real player's expired session behind what looks
 * like their own game turning read-only.
 */
export function authenticateOptionallyWith(context: AppContext) {
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const header = c.req.header('authorization')
    if (header === undefined || !header.startsWith('Bearer ')) {
      await next()
      return
    }

    const payload = context.tokens.verify(header.slice('Bearer '.length))
    if (payload === undefined) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Invalid or expired token')
    }

    const player = await context.repo.findPlayerById(payload.playerId)
    if (player === undefined) {
      return sendError(c, 401, 'UNAUTHORIZED', 'Unknown player')
    }
    if (player.disabled === true) {
      return sendError(c, 403, 'ACCOUNT_DISABLED', 'This account is disabled')
    }

    c.set('player', player)
    await next()
  })
}

/** Requires a valid, currently enabled account with the persisted admin role. */
export function requireAdminWith(context: AppContext) {
  const authenticate = authenticateWith(context)
  return createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const result = await authenticate(c, async () => undefined)
    if (result !== undefined) return result
    if (currentPlayer(c).role !== 'admin') {
      return sendError(c, 403, 'ADMIN_REQUIRED', 'Only admins may manage users')
    }
    await next()
  })
}

/** The signed-in player. Only call this from routes running `authenticate`. */
export function currentPlayer(c: Context<{ Variables: Variables }>): StoredPlayer {
  const player = c.get('player')
  if (player === undefined) {
    throw new Error('currentPlayer called without the authenticate middleware')
  }
  return player
}

/**
 * Stamps every log entry that has no timestamp yet with `now`. The engine is
 * pure and cannot call the clock itself, so it appends entries with
 * `createdAt: null`; the server is the one place allowed to know the time.
 * Entries that already carry a timestamp are left untouched.
 */
export function stampLog(state: GameState, now: string): GameState {
  return {
    ...state,
    log: state.log.map((entry) =>
      entry.createdAt === null ? { ...entry, createdAt: now } : entry,
    ),
  }
}

/**
 * What a revision stores of a game: private planning notes are deliberately
 * outside revision capture, so both the active and the withdrawn hands are
 * blanked. A player whose note is already empty keeps their object, so a state
 * and the one before it still share it (which is what makes diffing them cheap).
 */
export function revisionSnapshot(state: GameState): GameState {
  const blank = (player: Playerhand): Playerhand =>
    player.gamenote === '' ? player : { ...player, gamenote: '' }
  return {
    ...state,
    players: state.players.map(blank),
    withdrawnPlayers: state.withdrawnPlayers.map(blank),
  }
}

/**
 * Whether two live states differ only in private notes (and `rev`), the one kind
 * of unrecorded change a delta against the newest revision does not need to know
 * about: revision snapshots blank the notes anyway.
 */
export function differOnlyInNotes(before: GameState, after: GameState): boolean {
  return sameJson({ ...revisionSnapshot(before), rev: 0 }, { ...revisionSnapshot(after), rev: 0 })
}

export function createGameRevision(
  before: GameState | undefined,
  state: GameState,
  actor: Pick<StoredPlayer, 'id' | 'username'>,
  createdAt: string,
  fallbackDescription: string,
  /** Replaces the joined public log lines, for an action whose lines should not all show. */
  publicDescriptionOverride?: string,
): GameRevision {
  const previousIds = new Set(before?.log.map((entry) => entry.id) ?? [])
  const entries = state.log.filter((entry) => !previousIds.has(entry.id))
  const publicDescription =
    publicDescriptionOverride ??
    (entries
      .map((entry) => entry.publicLog)
      .filter((description) => description !== '')
      .join(' · ') ||
      fallbackDescription)
  const privateDescriptions: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.playerId === null || entry.privateLog === '') continue
    privateDescriptions[entry.playerId] = [privateDescriptions[entry.playerId], entry.privateLog]
      .filter((description): description is string => description !== undefined && description !== '')
      .join(' · ')
  }
  return {
    gameId: state.id,
    revision: state.rev,
    createdAt,
    actor: { playerId: actor.id, username: actor.username },
    publicDescription,
    privateDescriptions,
    logIds: entries.map((entry) => entry.id),
    state: revisionSnapshot(state),
  }
}

/**
 * Runs an engine action against a stored game: load, call, save, and answer
 * with the player's own view of the new state.
 *
 * `clientRev` is optional. When supplied, it must match the stored game's
 * `rev` counter; if it does not, a 409 Conflict is returned before the action
 * runs. This prevents last-write-wins data loss when two players act on the
 * same object simultaneously (most relevant to the battle arena).
 *
 * `rev` is always incremented on every successful write.
 *
 * `options.after` runs once the write has been committed. It exists for
 * best-effort side effects such as email notifications: it is awaited, but a
 * throw from it is logged and swallowed so a mail problem can never turn a
 * successful game action into a failed request.
 */
export interface ApplyToGameInfo {
  readonly before: GameState
  readonly after: GameState
}

export interface ApplyToGameOptions {
  readonly record?: boolean
  readonly description?: string
  /**
   * The public text of the revision when it should not be every new public log
   * line joined (the end of a game names only the winner). `undefined` keeps the
   * joined lines. Ignored with `record: false`, which makes no revision.
   */
  readonly publicDescription?: (info: ApplyToGameInfo) => string | undefined
  readonly after?: (info: ApplyToGameInfo) => Promise<void> | void
  /**
   * When the action answers with the very state it was given, nothing changed:
   * skip the save, keep `rev` and the history as they are, and answer with the
   * current projection. For a retry that the engine recognises as already done.
   * Off by default, so no other route changes.
   */
  readonly skipSaveWhenUnchanged?: boolean
}

/** An ended game is read-only for everyone except the admin role. */
export function isLockedForViewer(game: GameState, viewer: Pick<StoredPlayer, 'role'>): boolean {
  return !game.active && viewer.role !== 'admin'
}

export function gameEndedResponse(c: Context<{ Variables: Variables }>): Response {
  return sendError(c, 409, 'GAME_ENDED', 'This game has ended and can no longer be changed')
}

export async function applyToGame(
  context: AppContext,
  c: Context<{ Variables: Variables }>,
  gameId: string,
  action: (state: GameState) => { ok: true; value: GameState } | { ok: false; error: EngineError },
  clientRev?: number,
  options: ApplyToGameOptions = {},
): Promise<Response> {
  const game = await context.repo.findGame(gameId)
  if (game === undefined) {
    return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
  }

  if (isLockedForViewer(game, currentPlayer(c))) return gameEndedResponse(c)

  if (clientRev !== undefined && clientRev !== game.rev) {
    return sendError(
      c,
      409,
      'CONFLICT',
      `Game was modified concurrently (expected rev ${clientRev}, got ${game.rev}). Reload and retry.`,
    )
  }

  // A game saved before public item numbers were keyed has an empty key. Give
  // it a random one before anything is logged, or the numbers stay guessable.
  // The object the action gets, so "unchanged" can be told by identity below
  const given = game.logSecret === '' ? { ...game, logSecret: newId() } : game
  const result = action(given)
  if (!result.ok) return sendEngineError(c, result.error)

  const now = new Date().toISOString()
  const reconciled = expireTradeOffers(result.value, now)

  if (options.skipSaveWhenUnchanged === true && reconciled === given) {
    return c.json(toPlayerView(game, currentPlayer(c).id))
  }

  // Private notes do not create replay checkpoints, but they still advance the
  // optimistic-concurrency token. Otherwise a note and a shared transition
  // could both commit from the same base revision and one would be lost.
  const stamped = stampLog({ ...reconciled, rev: game.rev + 1 }, now)

  if (options.record === false) {
    // A note leaves the chain of revisions alone; anything else this path saves
    // (an admin setting) makes the next revision a keyframe.
    const saved = await context.repo.saveGameIfRevision(stamped, game.rev, {
      notesOnly: differOnlyInNotes(game, stamped),
    })
    if (!saved) {
      return sendError(
        c,
        409,
        'CONFLICT',
        `Game was modified concurrently (expected rev ${game.rev}). Reload and retry.`,
      )
    }
  } else {
    const actor = currentPlayer(c)
    const baselineReady = await context.repo.ensureGameRevision(
      createGameRevision(undefined, game, actor, now, 'History starts here'),
      game.rev,
    )
    if (!baselineReady) {
      return sendError(
        c,
        409,
        'CONFLICT',
        `Game was modified concurrently (expected rev ${game.rev}). Reload and retry.`,
      )
    }
    const saved = await context.repo.saveGameWithRevision(
      stamped,
      createGameRevision(
        game,
        stamped,
        actor,
        now,
        options.description ?? 'Game state updated',
        options.publicDescription?.({ before: game, after: stamped }),
      ),
      game.rev,
      // The live game before the action is the newest revision's state (notes
      // blanked), so the store can keep the revision as a small delta.
      revisionSnapshot(game),
    )
    if (!saved) {
      return sendError(
        c,
        409,
        'CONFLICT',
        `Game was modified concurrently (expected rev ${game.rev}). Reload and retry.`,
      )
    }
  }

  if (options.after !== undefined) {
    try {
      await options.after({ before: game, after: stamped })
    } catch (error) {
      // A notification must never fail the game action that triggered it.
      console.error('Post-apply notification hook failed', error)
    }
  }

  return c.json(toPlayerView(stamped, currentPlayer(c).id))
}

/** Reads a game and answers with the player's view, changing nothing. */
export async function readGame(
  context: AppContext,
  c: Context<{ Variables: Variables }>,
  gameId: string,
  project: (state: GameState, viewerId: string) => unknown = toPlayerView,
): Promise<Response> {
  const game = await context.repo.findGame(gameId)
  if (game === undefined) {
    return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
  }
  return c.json(project(game, c.get('player')?.id ?? ''))
}

export type { PlayerView }

// ---------------------------------------------------------------------------
// Small validation helpers, so the routes need no schemas
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function requireString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

export function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = body[key]
  return typeof value === 'boolean' ? value : undefined
}
