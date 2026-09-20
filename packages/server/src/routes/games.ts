/**
 * Port of the game-list part of `resource/GameResource.java`: create, list,
 * join, withdraw, end, chat.
 */

import type { GameState } from '@civ/engine'
import {
  allPublicTurns,
  createGame,
  endGame,
  joinGame,
  remainingTechsForPlayer,
  revealedFeed,
  revealedTechsForAllPlayers,
  toPlayerView,
  withdrawFromGame,
} from '@civ/engine'

import type { App } from '../app.js'
import { newId } from '../auth.js'
import type { AppContext } from '../context.js'
import {
  applyToGame,
  asRecord,
  authenticateOptionallyWith,
  authenticateWith,
  createGameRevision,
  currentPlayer,
  optionalNumber,
  optionalString,
  readGame,
  requireString,
  runInBackground,
  stampLog,
} from '../context.js'
import { sendEngineError, sendError } from '../errors.js'
import type { ChatMessage, GameRevision } from '../store/types.js'

/** The summary the game list shows. Java: `PbfDTO`. */
export interface GameSummary {
  readonly id: string
  readonly name: string
  readonly gameType: string
  readonly createdAt: string | null
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly players: readonly { readonly username: string; readonly color: string | null }[]
  readonly nameOfUsersTurn: string
  readonly youAreIn: boolean
}

/** The public lobby summary. It deliberately has no viewer-specific fields. */
export interface PublicGameSummary {
  readonly id: string
  readonly name: string
  readonly gameType: string
  readonly createdAt: string | null
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly players: readonly { readonly username: string; readonly color: string | null }[]
  readonly nameOfUsersTurn: string
  readonly youAreIn: boolean
}

function toSummary(game: GameState, viewerId: string): GameSummary {
  return {
    id: game.id,
    name: game.name,
    gameType: game.gameType,
    createdAt: game.createdAt,
    numOfPlayers: game.numOfPlayers,
    active: game.active,
    winner: game.winner,
    players: game.players.map((player) => ({
      username: player.username,
      color: player.color,
    })),
    nameOfUsersTurn: game.players.find((player) => player.yourTurn)?.username ?? '',
    youAreIn: game.players.some((player) => player.playerId === viewerId),
  }
}

export function toPublicSummary(game: GameState, viewerId?: string): PublicGameSummary {
  return {
    id: game.id,
    name: game.name,
    gameType: game.gameType,
    createdAt: game.createdAt,
    numOfPlayers: game.numOfPlayers,
    active: game.active,
    winner: game.winner,
    players: game.players.map((player) => ({
      username: player.username,
      color: player.color,
    })),
    nameOfUsersTurn: game.players.find((player) => player.yourTurn)?.username ?? '',
    youAreIn: viewerId !== undefined && game.players.some((player) => player.playerId === viewerId),
  }
}

/** Revealed-feed page size: the default when none is asked for, and the cap. */
const DEFAULT_REVEALED_SIZE = 20
const MAX_REVEALED_SIZE = 100

/** Parses a query integer, falling back to `fallback` and clamping to [min, max]. */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10)
  const value = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(Math.max(value, min), max)
}

function revisionSummary(revision: GameRevision, viewerId: string) {
  return {
    gameId: revision.gameId,
    revision: revision.revision,
    createdAt: revision.createdAt,
    actor: revision.actor,
    publicDescription: revision.publicDescription,
    privateDescription: revision.privateDescriptions[viewerId] ?? null,
    logIds: revision.logIds,
  }
}

function projectedRevision(revision: GameRevision, viewerId: string) {
  const state = revision.state
  const projected = toPlayerView(state, viewerId)
  const view = projected.you === null
    ? projected
    : { ...projected, you: { ...projected.you, gamenote: '' } }
  return {
    ...revisionSummary(revision, viewerId),
    view,
    availableTechs: remainingTechsForPlayer(state, viewerId),
    revealedTechs: revealedTechsForAllPlayers(state),
    socialPolicies: state.socialPolicies,
    publicTurns: allPublicTurns(state),
    revealed: revealedFeed(state),
    publicLog: newestFirst(
      state.log.filter((entry) => entry.publicLog !== '').map((entry) => ({
        id: entry.id,
        username: entry.username,
        logType: entry.logType,
        message: entry.publicLog,
        createdAt: entry.createdAt,
        hasUndo: entry.undo !== null,
      })),
    ),
    privateLog: newestFirst(
      state.log.filter((entry) => entry.playerId === viewerId && entry.privateLog !== '').map((entry) => ({
        id: entry.id,
        username: entry.username,
        logType: entry.logType,
        message: entry.privateLog,
        createdAt: entry.createdAt,
        hasUndo: entry.undo !== null,
        canUndo: false,
      })),
    ),
  }
}

function newestFirst<T extends { readonly createdAt: string | null }>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        (b.entry.createdAt ?? '').localeCompare(a.entry.createdAt ?? '') || b.index - a.index,
    )
    .map(({ entry }) => entry)
}

/** A spectator has no account, so revision history needs a placeholder actor. */
const SPECTATOR = { id: '', username: 'Spectator' }

export function registerGameRoutes(app: App, context: AppContext): void {
  const auth = authenticateWith(context)
  // Read-only routes accept an absent or non-member viewer (issue #81): the
  // response already comes from `toPlayerView`-shaped projections that treat
  // an unrecognised viewer id as a non-player, so watching a game needs no
  // account.
  const optionalAuth = authenticateOptionallyWith(context)

  app.get('/api/games', auth, async (c) => {
    const games = await context.repo.allGames()
    const me = currentPlayer(c).id
    return c.json(
      [...games]
        .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
        .map((game) => toSummary(game, me)),
    )
  })

  /** Java: `GameResource.createGame` with `CreateNewGameDTO`. */
  app.post('/api/games', auth, async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const name = requireString(body, 'name')
    const numOfPlayers = optionalNumber(body, 'numOfPlayers') ?? 4
    const color = optionalString(body, 'color')

    if (name === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'name is required')
    }
    if (numOfPlayers < 2 || numOfPlayers > 5) {
      return sendError(c, 400, 'BAD_REQUEST', 'numOfPlayers must be between 2 and 5')
    }

    const existing = await context.repo.allGames()
    // Java had a unique index on pbf.name
    if (existing.some((game) => game.name.toLowerCase() === name.toLowerCase())) {
      return sendError(c, 409, 'GAME_EXISTS', `A game named ${name} already exists`)
    }

    const me = currentPlayer(c)
    // Java: @Min(2) @Max(5) on CreateNewGameDTO.numOfPlayers
    const empty = createGame({
      name,
      numOfPlayers,
      // The seed decides the shuffle and the itemNumbers. A random id per game
      // keeps two games with the same name from getting the same deck.
      seed: `${name}:${newId()}`,
      players: [],
      createdAt: new Date().toISOString(),
    })

    // Java: createNewGame finished with joinGame(..., gameCreator = true).
    // Going through joinGame rather than seating the creator directly is what
    // gives them a colour, and it calls startIfAllPlayers, without which a
    // two-seat game would never start.
    const joined = joinGame(empty, {
      playerId: me.id,
      username: me.username,
      ...(me.email !== null ? { email: me.email } : {}),
      ...(color !== undefined ? { color } : {}),
      gameCreator: true,
    })
    if (!joined.ok) return sendEngineError(c, joined.error)

    // `joinGame` is called directly rather than through `applyToGame`, so the
    // "joined / game started" log entries never pass through the stamping
    // there and would otherwise keep `createdAt: null` forever.
    const stamped = stampLog(joined.value, new Date().toISOString())

    const saved = await context.repo.saveGameWithRevision(
      stamped,
      createGameRevision(undefined, stamped, me, new Date().toISOString(), 'Game created'),
      null,
    )
    if (!saved) return sendError(c, 409, 'CONFLICT', 'Game id already exists')
    // Java ran this in a raw thread so it never delayed the response, and it can
    // reach every account when enabled — keep it off the request path. On a
    // Worker the task must go through `waitUntil` or it is cancelled with the
    // request; `runInBackground` handles both runtimes.
    runInBackground(c, context.notifications.gameCreated(stamped))
    return c.json(toSummary(stamped, me.id), 201)
  })

  app.get('/api/games/:gameId', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId)
  })

  app.get('/api/games/:gameId/revisions', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }
    const viewerId = c.get('player')?.id ?? ''
    const actor = c.get('player') ?? SPECTATOR
    const baselineReady = await context.repo.ensureGameRevision(
      createGameRevision(undefined, game, actor, new Date().toISOString(), 'History starts here'),
      game.rev,
    )
    if (!baselineReady) {
      const current = await context.repo.findGame(gameId)
      return current === undefined
        ? sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
        : sendError(c, 409, 'CONFLICT', 'Game changed while history was loading; retry')
    }
    const revisions = await context.repo.listGameRevisions(gameId)
    return c.json(revisions.map((revision) => revisionSummary(revision, viewerId)))
  })

  app.get('/api/games/:gameId/revisions/:revision', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }
    const number = Number(c.req.param('revision'))
    if (!Number.isInteger(number) || number < 0) {
      return sendError(c, 400, 'BAD_REQUEST', 'revision must be a non-negative integer')
    }
    const viewerId = c.get('player')?.id ?? ''
    const actor = c.get('player') ?? SPECTATOR
    const baselineReady = await context.repo.ensureGameRevision(
      createGameRevision(undefined, game, actor, new Date().toISOString(), 'History starts here'),
      game.rev,
    )
    if (!baselineReady) {
      const current = await context.repo.findGame(gameId)
      return current === undefined
        ? sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
        : sendError(c, 409, 'CONFLICT', 'Game changed while history was loading; retry')
    }
    const revision = await context.repo.findGameRevision(gameId, number)
    if (revision === undefined) {
      return sendError(c, 404, 'REVISION_NOT_FOUND', `No revision ${number} for game ${gameId}`)
    }
    return c.json(projectedRevision(revision, viewerId))
  })

  /** Java: `GameResource.joinGame`. */
  app.post('/api/games/:gameId/join', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const color = optionalString(asRecord(await c.req.json().catch(() => ({}))), 'color')
    const me = currentPlayer(c)

    return applyToGame(
      context,
      c,
      gameId,
      (state) =>
        joinGame(state, {
          playerId: me.id,
          username: me.username,
          ...(me.email !== null ? { email: me.email } : {}),
          ...(color !== undefined ? { color } : {}),
        }),
      undefined,
      { after: ({ after }) => context.notifications.playerJoined(after, me.id) },
    )
  })

  app.post('/api/games/:gameId/withdraw', auth, async (c) => {
    const gameId = c.req.param('gameId')
    return applyToGame(context, c, gameId, (state) => withdrawFromGame(state, currentPlayer(c).id))
  })

  app.post('/api/games/:gameId/end', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const winner = optionalString(asRecord(await c.req.json().catch(() => ({}))), 'winner')
    const me = currentPlayer(c)

    return applyToGame(
      context,
      c,
      gameId,
      (state) =>
        endGame(state, {
          playerId: me.id,
          // The engine still carries Java's username-shaped admin escape hatch;
          // authorization is decided here from the persisted role.
          username: me.role === 'admin' ? 'admin' : me.username,
          ...(winner !== undefined ? { winner } : {}),
        }),
      undefined,
      { after: ({ after }) => context.notifications.gameEnded(after) },
    )
  })

  app.post('/api/games/:gameId/delete', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }

    const me = currentPlayer(c)
    const isCreator = game.players.some(
      (player) => player.playerId === me.id && player.gameCreator,
    )
    if (!isCreator && me.role !== 'admin') {
      return sendError(c, 403, 'NO_ACCESS', 'Only the game creator or admin can delete a game')
    }

    const deleted = await context.repo.deleteGame(gameId)
    if (!deleted) {
      return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }
    await context.notifications.gameDeleted(game)
    return c.body(null, 204)
  })

  /**
   * The Revealed and Discarded Items panel (issue #51). Server-backed pagination:
   * the engine builds the full chronological feed, the route returns one bounded
   * page plus the total so the browser never loads the whole history or every
   * image at once. `page` is 1-based; `size` is clamped to 1..MAX_REVEALED_SIZE.
   */
  app.get('/api/games/:gameId/revealed', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    const size = clampInt(c.req.query('size'), DEFAULT_REVEALED_SIZE, 1, MAX_REVEALED_SIZE)
    const page = clampInt(c.req.query('page'), 1, 1, Number.MAX_SAFE_INTEGER)
    return readGame(context, c, gameId, (state) => {
      const all = revealedFeed(state)
      const start = (page - 1) * size
      return {
        items: all.slice(start, start + size),
        total: all.length,
        page,
        size,
      }
    })
  })

  /**
   * Sorts newest first by timestamp, then by the entry's original position in
   * `state.log` (a later position is newer — the engine appends
   * chronologically). The index tiebreak matters because a stable sort on
   * `createdAt` alone reads oldest-first for same-second or legacy-null
   * entries: `Array.prototype.sort` keeps their relative order, which is the
   * insertion order, i.e. oldest first.
   */
  /** Java: `/{pbfId}/publiclog`. */
  app.get('/api/games/:gameId/log/public', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state) =>
      newestFirst(
        state.log
          .filter((entry) => entry.publicLog !== '')
          .map((entry) => ({
            id: entry.id,
            username: entry.username,
            logType: entry.logType,
            message: entry.publicLog,
            createdAt: entry.createdAt,
            hasUndo: entry.undo !== null,
          })),
      ),
    )
  })

  /** Java: `/{pbfId}/privatelog` — the player's own entries only. */
  app.get('/api/games/:gameId/log/private', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state, viewerId) =>
      newestFirst(
        state.log
          .filter((entry) => entry.playerId === viewerId && entry.privateLog !== '')
          .map((entry) => ({
            id: entry.id,
            username: entry.username,
            logType: entry.logType,
            message: entry.privateLog,
            createdAt: entry.createdAt,
            hasUndo: entry.undo !== null,
            canUndo: entry.item !== null && entry.undo === null,
          })),
      ),
    )
  })

  // -------------------------------------------------------------------------
  // Chat. Java stored this in its own Mongo collection rather than on the
  // game, and it carries no game rules — so it lives here, not in the engine.
  // -------------------------------------------------------------------------

  app.get('/api/games/:gameId/chat', auth, async (c) => {
    const gameId = c.req.param('gameId')
    return c.json(await context.repo.chatFor(gameId))
  })

  app.post('/api/games/:gameId/chat', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const message = requireString(asRecord(await c.req.json().catch(() => ({}))), 'message')
    if (message === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'message is required')
    }

    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }

    const me = currentPlayer(c)
    const entry: ChatMessage = {
      id: newId(),
      gameId,
      username: me.username,
      message,
      createdAt: new Date().toISOString(),
    }
    await context.repo.appendChat(entry)
    await context.notifications.chatPosted(game, me.id, me.username, message)
    return c.json(entry, 201)
  })

  /** Java: `/publicchat` — posting remains authenticated. */
  app.post('/api/chat', auth, async (c) => {
    const message = requireString(asRecord(await c.req.json().catch(() => ({}))), 'message')
    if (message === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'message is required')
    }
    const entry: ChatMessage = {
      id: newId(),
      gameId: null,
      username: currentPlayer(c).username,
      message,
      createdAt: new Date().toISOString(),
    }
    await context.repo.appendChat(entry)
    return c.json(entry, 201)
  })

  /** Exposed so the client does not have to derive it from the player view. */
  app.get('/api/games/:gameId/state', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const game = await context.repo.findGame(gameId)
    if (game === undefined) {
      return sendError(c, 404, 'GAME_NOT_FOUND', `No game with id ${gameId}`)
    }
    return c.json(toPlayerView(game, currentPlayer(c).id))
  })
}
