import { applyCancellation, openCancellation, TWAIN_NAME } from '@civ/engine'
import type { CancellationCommand, GameState } from '@civ/engine'
import type { Hono } from 'hono'
import { applyToGame, asRecord, authenticateWith, currentPlayer, optionalNumber, requireString } from '../context.js'
import type { AppContext, Variables } from '../context.js'
import { sendError } from '../errors.js'

const ID = /^[A-Za-z0-9_-]{1,128}$/

export function registerCancellationRoutes(app: Hono<{ Variables: Variables }>, context: AppContext): void {
  const auth = authenticateWith(context)
  for (const path of ['cancellations', 'twain']) {
    app.post(`/api/games/:gameId/${path}`, auth, async (c) => {
      const body = asRecord(await c.req.json().catch(() => ({})))
      const requestId = requireString(body, 'requestId')
      const rev = optionalNumber(body, 'rev')
      if (requestId === undefined || !ID.test(requestId) || rev === undefined || !Number.isInteger(rev) || rev < 0) {
        return sendError(c, 400, 'BAD_REQUEST', 'requestId and a non-negative integer rev are required')
      }
      const gameId = c.req.param('gameId')
      const game = await context.repo.findGame(gameId)
      if (game === undefined) return sendError(c, 404, 'GAME_NOT_FOUND', 'Game not found')
      const playerId = currentPlayer(c).id
      const kind = path === 'twain' ? 'open' : body['kind']
      let command: CancellationCommand
      if (kind === 'open') {
        const logId = requireString(body, 'logId')
        const itemId = path === 'twain'
          ? game.players.find((p) => p.playerId === playerId)?.items.find((i) => i.kind === 'greatperson' && i.name === TWAIN_NAME)?.id
            // A settled retry may no longer hold Twain; recover only its own committed card ID.
            ?? game.cancellations?.cases.find((entry) => entry.id === requestId)?.reactions.find((r) => r.playerId === playerId)?.card.id
          : requireString(body, 'itemId')
        if (logId === undefined || itemId === undefined) return sendError(c, 400, 'BAD_REQUEST', 'logId and an available cancellation card are required')
        command = { kind, logId, itemId }
      } else if (kind === 'confirm') {
        const through = optionalNumber(body, 'through')
        if (through === undefined || !Number.isInteger(through)) return sendError(c, 400, 'BAD_REQUEST', 'through is required')
        command = { kind, through }
      } else if (kind === 'respond' || kind === 'pass') {
        const caseId = requireString(body, 'caseId')
        const version = optionalNumber(body, 'version')
        if (caseId === undefined || version === undefined || !Number.isInteger(version)) return sendError(c, 400, 'BAD_REQUEST', 'caseId and version are required')
        if (kind === 'pass') command = { kind, caseId, version }
        else {
          const itemId = requireString(body, 'itemId')
          const targetId = body['targetId'] === null ? null : requireString(body, 'targetId')
          if (itemId === undefined || targetId === undefined) return sendError(c, 400, 'BAD_REQUEST', 'itemId and targetId are required')
          command = { kind, caseId, version, itemId, targetId }
        }
      } else return sendError(c, 400, 'BAD_REQUEST', 'Unknown cancellation command')

      if (game.cancellations?.requests.some((r) => r.id === requestId)) {
        return applyToGame(context, c, gameId, (state) => applyCancellation(state, { playerId, requestId, command }), rev,
          { skipSaveWhenUnchanged: true, allowIdempotentRetry: true, duringDispute: true })
      }
      let baseline: GameState | undefined
      const pending = openCancellation(game)
      if (pending !== undefined && !game.cancellations?.requests.some((r) => r.id === requestId && r.playerId === playerId)) {
        try {
          if (await context.repo.findGameRevision(gameId, pending.continuationRevision) === undefined) {
            return sendError(c, 409, 'CONFLICT', 'Original continuation is missing. Nothing was changed.')
          }
        } catch {
          return sendError(c, 409, 'CONFLICT', 'Original continuation could not be restored. Nothing was changed.')
        }
      }
      let record = game.assistedActions.find((r) => r.logId === (command.kind === 'open' ? command.logId : pending?.targetLogId))
      const summaries = command.kind === 'open' ? await context.repo.listGameRevisionSummaries(gameId) : []
      // Legacy actions can be adopted only when the exact preceding revision exists.
      // A missing rev (e.g. old unrecorded edits) is not replaced by an older log prefix.
      if (record !== undefined && record.beforeRevision === undefined) {
        const original = summaries.find((r) => r.logIds.includes(record?.logId ?? ''))
        if (original !== undefined) record = { ...record, beforeRevision: original.revision - 1 }
      }
      // No heuristic based on the primary log: an action may have written several lines.
      if (record?.beforeRevision !== undefined) {
        try {
          baseline = (await context.repo.findGameRevision(gameId, record.beforeRevision))?.state
        } catch {
          return sendError(c, 409, 'CONFLICT', 'Saved history could not be restored. Nothing was changed.')
        }
      }
      return applyToGame(context, c, gameId,
        (state) => applyCancellation(record === undefined ? state : {
          ...state, assistedActions: state.assistedActions.map((r) => r.id === record.id ? record : r),
        }, { playerId, requestId, command,
          affected: summaries.filter((r) => r.revision > (record?.beforeRevision ?? game.rev) + 1).map((r) => r.publicDescription),
        }, baseline), rev,
        { description: 'Cancellation response', skipSaveWhenUnchanged: true, allowIdempotentRetry: true, duringDispute: true })
    })
  }
}
