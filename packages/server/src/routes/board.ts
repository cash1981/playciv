/**
 * Brettet.
 *
 * Java hadde ingen motstykke — brettet var et Google-lysbilde bak
 * `GameResource.addMapLink`. Rutene her er derfor nye.
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

export function registerBoardRoutes(app: FastifyInstance, context: AppContext): void {
  const auth = { preHandler: authenticateWith(context) }
  type Params = { gameId: string }

  /**
   * Katalogen over brikketyper. Klienten bygger paletten av denne, så den
   * slipper å kjenne filnavnene på disk.
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
      placePiece(state, { playerId: currentPlayer(request).id, assetId, x, y }),
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
      movePiece(state, { playerId: currentPlayer(request).id, pieceId, x, y }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/front', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    return applyToGame(context, request, reply, gameId, (state) =>
      bringToFront(state, { playerId: currentPlayer(request).id, pieceId }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/back', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    return applyToGame(context, request, reply, gameId, (state) =>
      sendToBack(state, { playerId: currentPlayer(request).id, pieceId }),
    )
  })

  /** Uten `rotation` i kroppen snus brikken et kvart trinn med klokka. */
  app.post('/api/games/:gameId/board/pieces/:pieceId/rotate', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    const requested = optionalNumber(asRecord(request.body), 'rotation')

    if (requested !== undefined && ![0, 90, 180, 270].includes(requested)) {
      return sendError(reply, 400, 'BAD_REQUEST', 'rotation must be 0, 90, 180 or 270')
    }

    return applyToGame(context, request, reply, gameId, (state) =>
      rotatePiece(state, {
        playerId: currentPlayer(request).id,
        pieceId,
        ...(requested !== undefined ? { rotation: requested as 0 | 90 | 180 | 270 } : {}),
      }),
    )
  })

  app.post('/api/games/:gameId/board/pieces/:pieceId/remove', auth, async (request, reply) => {
    const { gameId, pieceId } = request.params as Params & { pieceId: string }
    return applyToGame(context, request, reply, gameId, (state) =>
      removePiece(state, { playerId: currentPlayer(request).id, pieceId }),
    )
  })

  app.post('/api/games/:gameId/board/clear', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return applyToGame(context, request, reply, gameId, (state) =>
      clearBoard(state, currentPlayer(request).id),
    )
  })
}
