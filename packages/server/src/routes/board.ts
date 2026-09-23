/**
 * The board.
 *
 * Java had no counterpart — the board was a Google slide behind
 * `GameResource.addMapLink`, so these routes are new.
 *
 * Every change carries a timestamp supplied here rather than in the engine,
 * which stays pure.
 */

import {
  BOARD_ASSETS,
  bringToFront,
  movePiece,
  placePiece,
  removePiece,
  rotatePiece,
  setWonderOwner,
  sendToBack,
  undoLastBoardChange,
} from '@civ/engine'

import type { App } from '../app.js'
import type { AppContext } from '../context.js'
import {
  applyToGame,
  asRecord,
  authenticateOptionallyWith,
  authenticateWith,
  currentPlayer,
  optionalNumber,
  readGame,
  requireString,
} from '../context.js'
import { sendError } from '../errors.js'

const ROTATIONS = [0, 90, 180, 270]

export function registerBoardRoutes(app: App, context: AppContext): void {
  const auth = authenticateWith(context)
  const optionalAuth = authenticateOptionallyWith(context)

  const now = (): string => new Date().toISOString()

  /**
   * The catalogue of piece types. The client builds its palette from this so it
   * never has to know the file names on disk. Not game-specific and not
   * secret, so a spectator's board view (issue #81) can load it too.
   */
  app.get('/api/board/assets', optionalAuth, async (c) => c.json(BOARD_ASSETS))

  app.get('/api/games/:gameId/board', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state) => state.board)
  })

  app.post('/api/games/:gameId/board/pieces', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))

    const assetId = requireString(body, 'assetId')
    const x = optionalNumber(body, 'x')
    const y = optionalNumber(body, 'y')

    if (assetId === undefined || x === undefined || y === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'assetId, x and y are required')
    }

    return applyToGame(context, c, gameId, (state) =>
      placePiece(state, { playerId: currentPlayer(c).id, assetId, x, y, at: now() }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/move', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const pieceId = c.req.param('pieceId')
    const body = asRecord(await c.req.json().catch(() => ({})))

    const x = optionalNumber(body, 'x')
    const y = optionalNumber(body, 'y')
    if (x === undefined || y === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'x and y are required')
    }

    return applyToGame(context, c, gameId, (state) =>
      movePiece(state, { playerId: currentPlayer(c).id, pieceId, x, y, at: now() }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/owner', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const pieceId = c.req.param('pieceId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const ownerId = body['ownerId'] === null ? null : requireString(body, 'ownerId')
    if (ownerId === undefined) return sendError(c, 400, 'BAD_REQUEST', 'ownerId is required')
    return applyToGame(context, c, gameId, (state) =>
      setWonderOwner(state, { playerId: currentPlayer(c).id, pieceId, ownerId, at: now() }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/front', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const pieceId = c.req.param('pieceId')
    return applyToGame(context, c, gameId, (state) =>
      bringToFront(state, { playerId: currentPlayer(c).id, pieceId, at: now() }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/back', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const pieceId = c.req.param('pieceId')
    return applyToGame(context, c, gameId, (state) =>
      sendToBack(state, { playerId: currentPlayer(c).id, pieceId, at: now() }),
    )
  })

  /** Without `rotation` in the body the piece turns a quarter step clockwise. */
  app.post('/api/games/:gameId/board/pieces/:pieceId/rotate', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const pieceId = c.req.param('pieceId')
    const requested = optionalNumber(asRecord(await c.req.json().catch(() => ({}))), 'rotation')

    if (requested !== undefined && !ROTATIONS.includes(requested)) {
      return sendError(c, 400, 'BAD_REQUEST', 'rotation must be 0, 90, 180 or 270')
    }

    return applyToGame(context, c, gameId, (state) =>
      rotatePiece(state, {
        playerId: currentPlayer(c).id,
        pieceId,
        at: now(),
        ...(requested !== undefined ? { rotation: requested as 0 | 90 | 180 | 270 } : {}),
      }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/remove', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const pieceId = c.req.param('pieceId')
    return applyToGame(context, c, gameId, (state) =>
      removePiece(state, { playerId: currentPlayer(c).id, pieceId, at: now() }),
    )
  })

  /** Takes back the last board change, whoever made it. */
  app.post('/api/games/:gameId/board/undo', auth, async (c) => {
    const gameId = c.req.param('gameId')
    return applyToGame(context, c, gameId, (state) =>
      undoLastBoardChange(state, currentPlayer(c).id),
    )
  })

  /**
   * The list of changes, newest last. The client uses it both to show what the
   * others did and to step through the game.
   */
  app.get('/api/games/:gameId/board/history', auth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state) => state.board.history)
  })
}
