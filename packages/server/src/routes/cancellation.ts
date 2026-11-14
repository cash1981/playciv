import { applyCancellation, cancellationBaselineRevision } from '@civ/engine'
import type { GameState } from '@civ/engine'
import type { Hono } from 'hono'
import { applyToGame, asRecord, authenticateWith, currentPlayer, optionalNumber, requireString } from '../context.js'
import type { AppContext, Variables } from '../context.js'
import { sendError } from '../errors.js'

const ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Cancels an action, or undoes the latest cancellation, with one of the caller's cards. It takes effect at
 * once. Body: `{ logId, itemId, rev, requestId }`; `logId` is the action's log line, or the latest
 * cancellation's.
 */
export function registerCancellationRoutes(app: Hono<{ Variables: Variables }>, context: AppContext): void {
  const auth = authenticateWith(context)
  app.post('/api/games/:gameId/cancellations', auth, async (c) => {
    const body = asRecord(await c.req.json().catch(() => ({})))
    const requestId = requireString(body, 'requestId')
    const rev = optionalNumber(body, 'rev')
    if (requestId === undefined || !ID.test(requestId) || rev === undefined || !Number.isInteger(rev) || rev < 0) {
      return sendError(c, 400, 'BAD_REQUEST', 'requestId and a non-negative integer rev are required')
    }
    const logId = requireString(body, 'logId')
    const itemId = requireString(body, 'itemId')
    if (logId === undefined || itemId === undefined) return sendError(c, 400, 'BAD_REQUEST', 'logId and itemId are required')
    const gameId = c.req.param('gameId')
    const game = await context.repo.findGame(gameId)
    if (game === undefined) return sendError(c, 404, 'GAME_NOT_FOUND', 'Game not found')
    const playerId = currentPlayer(c).id
    const command = { logId, itemId }

    if (game.cancellations?.requests.some((r) => r.id === requestId)) {
      return applyToGame(context, c, gameId, (state) => applyCancellation(state, { playerId, requestId, command }), rev,
        { skipSaveWhenUnchanged: true, allowIdempotentRetry: true })
    }
    let record = game.assistedActions.find((r) => r.logId === logId)
    // Legacy actions can be adopted only when the exact preceding revision exists.
    // A missing rev (e.g. old unrecorded edits) is not replaced by an older log prefix.
    if (record !== undefined && record.beforeRevision === undefined) {
      const original = (await context.repo.listGameRevisionSummaries(gameId)).find((r) => r.logIds.includes(logId))
      if (original !== undefined) record = { ...record, beforeRevision: original.revision - 1 }
    }
    const adopted: GameState = record === undefined ? game : {
      ...game, assistedActions: game.assistedActions.map((r) => r.id === record?.id ? record : r),
    }
    // No heuristic based on the primary log: an action may have written several lines.
    const baselineRevision = cancellationBaselineRevision(adopted, logId)
    let baseline: GameState | undefined
    if (baselineRevision !== undefined) {
      try {
        baseline = (await context.repo.findGameRevision(gameId, baselineRevision))?.state
      } catch {
        return sendError(c, 409, 'CONFLICT', 'Saved history could not be restored. Nothing was changed.')
      }
    }
    return applyToGame(context, c, gameId,
      (state) => applyCancellation(record === undefined ? state : {
        ...state, assistedActions: state.assistedActions.map((r) => r.id === record?.id ? record : r),
      }, { playerId, requestId, command }, baseline), rev,
      { description: 'Cancellation', skipSaveWhenUnchanged: true, allowIdempotentRetry: true })
  })
}
