/**
 * Port of `resource/DrawResource.java` and `resource/PlayerResource.java`:
 * drawing, battle, techs, social policy, revealing, trading, turns and undo.
 */

import type { SheetName } from '@civ/engine'
import {
  chooseSocialPolicy,
  chooseTech,
  discardBarbarians,
  discardItem,
  draw,
  drawBarbarians,
  drawUnitsForBattle,
  endBattle,
  endTurn,
  findSheetName,
  initiateUndo,
  lockOrUnlockTurn,
  loot,
  playerPutsItemBackInDeck,
  playersActiveUndos,
  remainingTechsForPlayer,
  removeTech,
  revealAndDiscardBattlehand,
  revealItem,
  revealTech,
  revealedTechsForAllPlayers,
  saveNote,
  takeTurn,
  tradeToPlayer,
  updateTurn,
  vote,
} from '@civ/engine'
import type { TurnPhase } from '@civ/engine'
import { TURN_PHASES, allPublicTurns, playersTurns } from '@civ/engine'
import type { FastifyInstance, FastifyReply } from 'fastify'

import type { AppContext } from '../context.js'
import {
  applyToGame,
  asRecord,
  authenticateWith,
  currentPlayer,
  optionalNumber,
  optionalString,
  readGame,
  requireMembership,
  requireString,
} from '../context.js'
import { sendError } from '../errors.js'

/** Looks up the sheet name and answers 400 when there is no such sheet. */
function parseSheetName(reply: FastifyReply, raw: string | undefined): SheetName | undefined {
  if (raw === undefined) {
    void sendError(reply, 400, 'BAD_REQUEST', 'sheetName is required')
    return undefined
  }
  const sheetName = findSheetName(raw)
  if (sheetName === undefined) {
    void sendError(reply, 400, 'BAD_REQUEST', `Unknown sheet name ${raw}`)
    return undefined
  }
  return sheetName
}

function parsePhase(reply: FastifyReply, raw: string | undefined): TurnPhase | undefined {
  const phase = TURN_PHASES.find((candidate) => candidate === raw?.toUpperCase())
  if (phase === undefined) {
    void sendError(reply, 400, 'BAD_REQUEST', `phase must be one of ${TURN_PHASES.join(', ')}`)
    return undefined
  }
  return phase
}

export function registerPlayRoutes(app: FastifyInstance, context: AppContext): void {
  const auth = { preHandler: authenticateWith(context) }
  type Params = { gameId: string }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /** Java: `DrawResource.drawItem` — POST draw/{pbfId}/{sheetName}. */
  app.post('/api/games/:gameId/draw/:sheetName', auth, async (request, reply) => {
    const { gameId, sheetName: raw } = request.params as Params & { sheetName: string }
    const sheetName = parseSheetName(reply, raw)
    if (sheetName === undefined) return reply

    return applyToGame(context, request, reply, gameId, (state) =>
      draw(state, { playerId: currentPlayer(request).id, sheetName }),
    )
  })

  /** Java: `DrawResource.loot`. */
  app.post('/api/games/:gameId/loot/:sheetName/:targetPlayerId', auth, async (request, reply) => {
    const { gameId, sheetName: raw, targetPlayerId } = request.params as Params & {
      sheetName: string
      targetPlayerId: string
    }
    const sheetName = parseSheetName(reply, raw)
    if (sheetName === undefined) return reply

    return applyToGame(context, request, reply, gameId, (state) =>
      loot(state, {
        playerId: currentPlayer(request).id,
        targetPlayerId,
        sheetNames: new Set([sheetName]),
      }),
    )
  })

  // -------------------------------------------------------------------------
  // Battle
  // -------------------------------------------------------------------------

  /** Java: `DrawResource.drawUnits` — PUT draw/{pbfId}/battle?numOfUnits=N. */
  app.post('/api/games/:gameId/battle/draw', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const numberOfDraws = optionalNumber(asRecord(request.body), 'numberOfUnits') ?? 0

    return applyToGame(context, request, reply, gameId, (state) =>
      drawUnitsForBattle(state, { playerId: currentPlayer(request).id, numberOfDraws }),
    )
  })

  app.post('/api/games/:gameId/battle/reveal', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return applyToGame(context, request, reply, gameId, (state) =>
      revealAndDiscardBattlehand(state, currentPlayer(request).id),
    )
  })

  app.post('/api/games/:gameId/battle/end', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return applyToGame(context, request, reply, gameId, (state) =>
      endBattle(state, currentPlayer(request).id),
    )
  })

  app.post('/api/games/:gameId/battle/barbarians', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return applyToGame(context, request, reply, gameId, (state) =>
      drawBarbarians(state, currentPlayer(request).id),
    )
  })

  app.post('/api/games/:gameId/battle/barbarians/discard', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return applyToGame(context, request, reply, gameId, (state) =>
      discardBarbarians(state, currentPlayer(request).id),
    )
  })

  // -------------------------------------------------------------------------
  // Techs and social policy
  // -------------------------------------------------------------------------

  app.get('/api/games/:gameId/techs/available', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return readGame(context, request, reply, gameId, (state, viewerId) =>
      remainingTechsForPlayer(state, viewerId),
    )
  })

  /** Java: `PlayerResource.getChosenTechFromPlayer` — `/tech/all`. */
  app.get('/api/games/:gameId/techs/revealed', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return readGame(context, request, reply, gameId, (state) =>
      revealedTechsForAllPlayers(state),
    )
  })

  app.post('/api/games/:gameId/techs/choose', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const techName = requireString(asRecord(request.body), 'name')
    if (techName === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, request, reply, gameId, (state) =>
      chooseTech(state, { playerId: currentPlayer(request).id, techName }),
    )
  })

  app.post('/api/games/:gameId/techs/remove', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const techName = requireString(asRecord(request.body), 'name')
    if (techName === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, request, reply, gameId, (state) =>
      removeTech(state, { playerId: currentPlayer(request).id, techName }),
    )
  })

  app.post('/api/games/:gameId/techs/reveal', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const techName = requireString(asRecord(request.body), 'name')
    if (techName === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, request, reply, gameId, (state) =>
      revealTech(state, { playerId: currentPlayer(request).id, techName }),
    )
  })

  app.post('/api/games/:gameId/socialpolicy/choose', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const name = requireString(asRecord(request.body), 'name')
    if (name === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, request, reply, gameId, (state) =>
      chooseSocialPolicy(state, { playerId: currentPlayer(request).id, name }),
    )
  })

  app.get('/api/games/:gameId/socialpolicies', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return readGame(context, request, reply, gameId, (state) => state.socialPolicies)
  })

  // -------------------------------------------------------------------------
  // Items in hand
  // -------------------------------------------------------------------------

  /** Java: `PlayerResource.revealItem` with `ItemDTO`. */
  app.post('/api/games/:gameId/items/reveal', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const body = asRecord(request.body)
    const sheetName = parseSheetName(reply, optionalString(body, 'sheetName'))
    if (sheetName === undefined) return reply

    const itemNumber = optionalNumber(body, 'itemNumber')
    const name = optionalString(body, 'name')

    return applyToGame(context, request, reply, gameId, (state) =>
      revealItem(state, {
        playerId: currentPlayer(request).id,
        sheetName,
        ...(itemNumber !== undefined ? { itemNumber } : {}),
        ...(name !== undefined ? { name } : {}),
      }),
    )
  })

  app.post('/api/games/:gameId/items/discard', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const body = asRecord(request.body)
    const sheetName = parseSheetName(reply, optionalString(body, 'sheetName'))
    if (sheetName === undefined) return reply

    const itemNumber = optionalNumber(body, 'itemNumber')
    const name = optionalString(body, 'name')

    return applyToGame(context, request, reply, gameId, (state) =>
      discardItem(state, {
        playerId: currentPlayer(request).id,
        sheetName,
        ...(itemNumber !== undefined ? { itemNumber } : {}),
        ...(name !== undefined ? { name } : {}),
      }),
    )
  })

  /** Java: `PlayerResource.itemBackToDeck`. */
  app.post('/api/games/:gameId/items/backtodeck', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const body = asRecord(request.body)
    const sheetName = parseSheetName(reply, optionalString(body, 'sheetName'))
    if (sheetName === undefined) return reply

    const name = requireString(body, 'name')
    if (name === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'name is required')
    }

    return applyToGame(context, request, reply, gameId, (state) =>
      playerPutsItemBackInDeck(state, {
        playerId: currentPlayer(request).id,
        sheetName,
        name,
      }),
    )
  })

  app.post('/api/games/:gameId/items/trade', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const body = asRecord(request.body)
    const sheetName = parseSheetName(reply, optionalString(body, 'sheetName'))
    if (sheetName === undefined) return reply

    const targetPlayerId = requireString(body, 'targetPlayerId')
    if (targetPlayerId === undefined) {
      return sendError(reply, 400, 'BAD_REQUEST', 'targetPlayerId is required')
    }
    const itemNumber = optionalNumber(body, 'itemNumber')
    const name = optionalString(body, 'name')

    return applyToGame(context, request, reply, gameId, (state) =>
      tradeToPlayer(state, {
        playerId: currentPlayer(request).id,
        targetPlayerId,
        sheetName,
        ...(itemNumber !== undefined ? { itemNumber } : {}),
        ...(name !== undefined ? { name } : {}),
      }),
    )
  })

  // -------------------------------------------------------------------------
  // Turns
  // -------------------------------------------------------------------------

  /**
   * The engine lets anyone with the turn pass it on (Java: authorisation lived
   * in the resource layer), so a non-member is rejected here, before the
   * engine ever sees the call.
   */
  app.post('/api/games/:gameId/endturn', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    if ((await requireMembership(context, request, reply, gameId)) === undefined) return reply

    const player = currentPlayer(request)
    return applyToGame(context, request, reply, gameId, (state) =>
      endTurn(state, { playerId: player.id, username: player.username }),
    )
  })

  app.post('/api/games/:gameId/taketurn', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    if ((await requireMembership(context, request, reply, gameId)) === undefined) return reply

    return applyToGame(context, request, reply, gameId, (state) =>
      takeTurn(state, currentPlayer(request).id),
    )
  })

  app.get('/api/games/:gameId/turns/public', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return readGame(context, request, reply, gameId, (state) => allPublicTurns(state))
  })

  app.get('/api/games/:gameId/turns/mine', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return readGame(context, request, reply, gameId, (state, viewerId) =>
      playersTurns(state, viewerId),
    )
  })

  /**
   * Java: `PlayerResource.updateTurn` with `TurnDTO`. Unlike `endturn`, the
   * engine's `updateTurn` already calls `hasUserAccess` on the caller and
   * returns `NO_ACCESS` (403) for a non-member, so no extra gate is needed here.
   */
  app.post('/api/games/:gameId/turns/update', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const body = asRecord(request.body)
    const phase = parsePhase(reply, optionalString(body, 'phase'))
    if (phase === undefined) return reply

    const turnNumber = optionalNumber(body, 'turnNumber') ?? 1
    const order = optionalString(body, 'order') ?? ''

    return applyToGame(context, request, reply, gameId, (state) =>
      updateTurn(state, { playerId: currentPlayer(request).id, turnNumber, phase, order }),
    )
  })

  /** `lockOrUnlockTurn` also gates on `hasUserAccess` in the engine, same as `updateTurn`. */
  app.post('/api/games/:gameId/turns/lock', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const body = asRecord(request.body)
    const turnNumber = optionalNumber(body, 'turnNumber') ?? 1
    const locked = body['locked'] === true

    return applyToGame(context, request, reply, gameId, (state) =>
      lockOrUnlockTurn(state, { playerId: currentPlayer(request).id, turnNumber, locked }),
    )
  })

  app.post('/api/games/:gameId/note', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const note = optionalString(asRecord(request.body), 'note') ?? ''
    return applyToGame(context, request, reply, gameId, (state) =>
      saveNote(state, currentPlayer(request).id, note),
    )
  })

  // -------------------------------------------------------------------------
  // Undo
  // -------------------------------------------------------------------------

  /** Java: `GameResource.undoItem` — PUT /{pbfId}/undo/{gameLogId}. */
  app.post('/api/games/:gameId/undo/:logId', auth, async (request, reply) => {
    const { gameId, logId } = request.params as Params & { logId: string }
    return applyToGame(context, request, reply, gameId, (state) =>
      initiateUndo(state, { logId, playerId: currentPlayer(request).id }),
    )
  })

  /** Java: `/{pbfId}/vote/{gameLogId}/yes` and `/no`. */
  app.post('/api/games/:gameId/undo/:logId/vote', auth, async (request, reply) => {
    const { gameId, logId } = request.params as Params & { logId: string }
    const value = asRecord(request.body)['vote']

    return applyToGame(context, request, reply, gameId, (state) =>
      vote(state, { logId, playerId: currentPlayer(request).id, vote: value === true }),
    )
  })

  /** Java: `PlayerResource.getAllUndoThatNeedsVoteFromPlayer`. */
  app.get('/api/games/:gameId/undo/pending', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    const me = currentPlayer(request)

    return readGame(context, request, reply, gameId, (state) =>
      state.log
        .filter((entry) => entry.undo !== null && !entry.undo.done)
        // Only the ones this player has not voted on yet
        .filter((entry) => !(me.id in (entry.undo?.votes ?? {})))
        .map((entry) => ({
          id: entry.id,
          username: entry.username,
          message: entry.publicLog,
          votesRequired: entry.undo?.numberOfVotesRequired ?? 0,
          votesCast: Object.keys(entry.undo?.votes ?? {}).length,
        })),
    )
  })

  app.get('/api/games/:gameId/undo/mine', auth, async (request, reply) => {
    const { gameId } = request.params as Params
    return readGame(context, request, reply, gameId, (state) =>
      playersActiveUndos(state, currentPlayer(request).username).map((entry) => ({
        id: entry.id,
        message: entry.publicLog,
      })),
    )
  })
}
