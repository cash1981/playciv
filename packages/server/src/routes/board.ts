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
  clearBoard,
  movePiece,
  placePiece,
  removePiece,
  rotatePiece,
  sendToBack,
  undoLastBoardChange,
} from '@civ/engine'
import type { FastifyInstance } from 'fastify'

import type { AppContext } from '../context.js'
import {
  applyToGame,
  asRecord,
  authenticateWith,
  currentPlayer,
  optionalNumber,
  readGame,
  requireString,
} from '../context.js'
import { sendError } from '../errors.js'

const ROTATIONS = [0, 90, 180, 270]

export function registerBoardRoutes(app: FastifyInstance, context: AppContext): void {
  const auth = { preHandler: authenticateWith(context) }
  type Params = { gameId: string }

  const now = (): string => new Date().toISOString()

  /**
   * The catalogue of piece types. The client builds its palette from this so it
   * never has to know the file names on disk.
   */
  app.get('/api/board/assets', auth, async (_request, reply) => reply.send(BOARD_ASSETS))

  app.get('/api/games/:gameId/board', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return readGame(context, request, reply, gameId, (state) => state.board)
  })

  app.post('/api/games/:gameId/board/pieces', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const body = asRecord(request.body)

    const assetId = requireString(body, 'assetId')
    const x = optionalNumber(body, 'x')
    const y = optionalNumber(body, 'y')

    if (assetId === undefined || x === undefined || y === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'assetId, x and y are required')
    }

    return applyToGame(context, request, reply, gameId, (state) =>
      placePiece(state, { playerId: currentPlayer(request).id, assetId, x, y, at: now() }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/move', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    const body = asRecord(request.body)

    const x = optionalNumber(body, 'x')
    const y = optionalNumber(body, 'y')
    if (x === undefined || y === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'x and y are required')
    }

    return applyToGame(context, request, reply, gameId, (state) =>
      movePiece(state, { playerId: currentPlayer(request).id, pieceId, x, y, at: now() }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/front', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    return applyToGame(context, request, reply, gameId, (state) =>
      bringToFront(state, { playerId: currentPlayer(request).id, pieceId, at: now() }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/back', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    return applyToGame(context, request, reply, gameId, (state) =>
      sendToBack(state, { playerId: currentPlayer(request).id, pieceId, at: now() }),
    )
  })

  /** Without `rotation` in the body the piece turns a quarter step clockwise. */
  app.post('/api/games/:gameId/board/pieces/:pieceId/rotate', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    const requested = optionalNumber(asRecord(request.body), 'rotation')

    if (requested !== undefined && !ROTATIONS.includes(requested)) {
      return sendError(reply, 400, 'BAD_REQUEST', 'rotation must be 0, 90, 180 or 270')
    }

    return applyToGame(context, request, reply, gameId, (state) =>
      rotatePiece(state, {
        playerId: currentPlayer(request).id,
        pieceId,
        at: now(),
        ...(requested !== undefined ? { rotation: requested as 0 | 90 | 180 | 270 } : {}),
      }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/remove', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    return applyToGame(context, request, reply, gameId, (state) =>
      removePiece(state, { playerId: currentPlayer(request).id, pieceId, at: now() }),
    )
  })

  app.post('/api/games/:gameId/board/clear', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return applyToGame(context, request, reply, gameId, (state) =>
      clearBoard(state, { playerId: currentPlayer(request).id, at: now() }),
    )
  })

  /** Takes back the last board change, whoever made it. */
  app.post('/api/games/:gameId/board/undo', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return applyToGame(context, request, reply, gameId, (state) =>
      undoLastBoardChange(state, currentPlayer(request).id),
    )
  })

  /**
   * The list of changes, newest last. The client uses it both to show what the
   * others did and to step through the game.
   */
  app.get('/api/games/:gameId/board/history', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return readGame(context, request, reply, gameId, (state) => state.board.history)
  })
}
