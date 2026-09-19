/**
 * Port of `resource/DrawResource.java` and `resource/PlayerResource.java`:
 * drawing, battle, techs, social policy, revealing, trading, turns and undo.
 */

import type { PlayerStats, SheetName } from '@civ/engine'
import {
  ALL_WONDERS,
  CULTURE_CARD,
  chooseSocialPolicy,
  chooseTech,
  discardBarbarians,
  discardItem,
  draw,
  drawUnitsForBattle,
  drawWonder,
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
  removeSocialPolicy,
  revealAndDiscardBattlehand,
  revealItem,
  revealSocialPolicy,
  revealTech,
  revealedTechsForAllPlayers,
  saveNote,
  setPlayerStat,
  takeTurn,
  tradeToPlayer,
  updateTurn,
  vote,
} from '@civ/engine'
import type { TurnPhase } from '@civ/engine'
import { TURN_PHASES, allPublicTurns, playersTurns } from '@civ/engine'
import type { Context } from 'hono'

import type { App } from '../app.js'
import type { AppContext, Variables } from '../context.js'
import {
  applyToGame,
  asRecord,
  authenticateOptionallyWith,
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
function parseSheetName(
  c: Context<{ Variables: Variables }>,
  raw: string | undefined,
): SheetName | Response {
  if (raw === undefined) {
    return sendError(c, 400, 'BAD_REQUEST', 'sheetName is required')
  }
  const sheetName = findSheetName(raw)
  if (sheetName === undefined) {
    return sendError(c, 400, 'BAD_REQUEST', `Unknown sheet name ${raw}`)
  }
  return sheetName
}

/** Java: `Culture Card` is one loot pool; every other valid sheet stays a singleton. */
function parseLootSheets(
  c: Context<{ Variables: Variables }>,
  raw: string | undefined,
): ReadonlySet<SheetName> | Response {
  if (raw === 'CULTURE_CARD' || raw === 'Culture Card') {
    return CULTURE_CARD
  }

  if (raw === undefined) {
    return sendError(c, 404, 'ITEM_NOT_FOUND', 'Could not find item')
  }
  const sheetName = findSheetName(raw)
  if (sheetName === undefined) {
    return sendError(c, 404, 'ITEM_NOT_FOUND', `Could not find item ${raw}`)
  }
  return new Set([sheetName])
}

function parsePhase(
  c: Context<{ Variables: Variables }>,
  raw: string | undefined,
): TurnPhase | Response {
  const phase = TURN_PHASES.find((candidate) => candidate === raw?.toUpperCase())
  if (phase === undefined) {
    return sendError(c, 400, 'BAD_REQUEST', `phase must be one of ${TURN_PHASES.join(', ')}`)
  }
  return phase
}

export function registerPlayRoutes(app: App, context: AppContext): void {
  const auth = authenticateWith(context)
  // Read-only routes a spectator's panels also poll (issue #81): an absent
  // viewer just sees the same "not a player" projection a signed-in
  // non-member already gets.
  const optionalAuth = authenticateOptionallyWith(context)

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /**
   * Java: `DrawResource.drawItem` — POST draw/{pbfId}/{sheetName}.
   *
   * Wonders are the exception: instead of going into the drawing player's hand
   * they are placed on the shared board (see `drawWonder`). The draw is still
   * turn-gated like any other; only the destination differs.
   */
  app.post('/api/games/:gameId/draw/:sheetName', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const sheetName = parseSheetName(c, c.req.param('sheetName'))
    if (sheetName instanceof Response) return sheetName

    return applyToGame(context, c, gameId, (state) => {
      const playerId = currentPlayer(c).id
      return ALL_WONDERS.has(sheetName)
        ? drawWonder(state, { playerId, sheetName })
        : draw(state, { playerId, sheetName })
    })
  })

  /** Java: `DrawResource.loot`. */
  app.post('/api/games/:gameId/loot/:category/:targetPlayerId', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const targetPlayerId = c.req.param('targetPlayerId')
    const sheetNames = parseLootSheets(c, c.req.param('category'))
    if (sheetNames instanceof Response) return sheetNames

    return applyToGame(context, c, gameId, (state) =>
      loot(state, {
        playerId: currentPlayer(c).id,
        targetPlayerId,
        sheetNames,
      }),
    )
  })

  // -------------------------------------------------------------------------
  // Battle
  // -------------------------------------------------------------------------

  /** Java: `DrawResource.drawUnits` — PUT draw/{pbfId}/battle?numOfUnits=N. */
  app.post('/api/games/:gameId/battle/draw', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const numberOfDraws = optionalNumber(asRecord(await c.req.json().catch(() => ({}))), 'numberOfUnits') ?? 0

    return applyToGame(context, c, gameId, (state) =>
      drawUnitsForBattle(state, { playerId: currentPlayer(c).id, numberOfDraws }),
    )
  })

  app.post('/api/games/:gameId/battle/reveal', auth, async (c) => {
    const gameId = c.req.param('gameId')
    return applyToGame(context, c, gameId, (state) =>
      revealAndDiscardBattlehand(state, currentPlayer(c).id),
    )
  })

  app.post('/api/games/:gameId/battle/end', auth, async (c) => {
    const gameId = c.req.param('gameId')
    return applyToGame(context, c, gameId, (state) => endBattle(state, currentPlayer(c).id))
  })

  app.post('/api/games/:gameId/battle/barbarians/discard', auth, async (c) => {
    const gameId = c.req.param('gameId')
    return applyToGame(context, c, gameId, (state) =>
      discardBarbarians(state, currentPlayer(c).id),
    )
  })

  // -------------------------------------------------------------------------
  // Techs and social policy
  // -------------------------------------------------------------------------

  app.get('/api/games/:gameId/techs/available', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state, viewerId) =>
      remainingTechsForPlayer(state, viewerId),
    )
  })

  /** Java: `PlayerResource.getChosenTechFromPlayer` — `/tech/all`. */
  app.get('/api/games/:gameId/techs/revealed', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state) => revealedTechsForAllPlayers(state))
  })

  app.post('/api/games/:gameId/techs/choose', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const techName = requireString(asRecord(await c.req.json().catch(() => ({}))), 'name')
    if (techName === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, c, gameId, (state) =>
      chooseTech(state, { playerId: currentPlayer(c).id, techName }),
    )
  })

  app.post('/api/games/:gameId/techs/remove', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const techName = requireString(asRecord(await c.req.json().catch(() => ({}))), 'name')
    if (techName === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, c, gameId, (state) =>
      removeTech(state, { playerId: currentPlayer(c).id, techName }),
    )
  })

  app.post('/api/games/:gameId/techs/reveal', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const techName = requireString(asRecord(await c.req.json().catch(() => ({}))), 'name')
    if (techName === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, c, gameId, (state) =>
      revealTech(state, { playerId: currentPlayer(c).id, techName }),
    )
  })

  app.post('/api/games/:gameId/socialpolicy/choose', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const name = requireString(asRecord(await c.req.json().catch(() => ({}))), 'name')
    if (name === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, c, gameId, (state) =>
      chooseSocialPolicy(state, { playerId: currentPlayer(c).id, name }),
    )
  })

  app.post('/api/games/:gameId/socialpolicy/remove', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const name = requireString(asRecord(await c.req.json().catch(() => ({}))), 'name')
    if (name === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, c, gameId, (state) =>
      removeSocialPolicy(state, { playerId: currentPlayer(c).id, name }),
    )
  })

  app.get('/api/games/:gameId/socialpolicies', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state) => state.socialPolicies)
  })

  app.post('/api/games/:gameId/socialpolicies/reveal', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const name = requireString(asRecord(await c.req.json().catch(() => ({}))), 'name')
    if (name === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'name is required')
    }
    return applyToGame(context, c, gameId, (state) =>
      revealSocialPolicy(state, { playerId: currentPlayer(c).id, name }),
    )
  })

  // -------------------------------------------------------------------------
  // Items in hand
  // -------------------------------------------------------------------------

  /** Java: `PlayerResource.revealItem` with `ItemDTO`. */
  app.post('/api/games/:gameId/items/reveal', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const sheetName = parseSheetName(c, optionalString(body, 'sheetName'))
    if (sheetName instanceof Response) return sheetName

    const itemNumber = optionalNumber(body, 'itemNumber')
    const name = optionalString(body, 'name')

    return applyToGame(context, c, gameId, (state) =>
      revealItem(state, {
        playerId: currentPlayer(c).id,
        sheetName,
        ...(itemNumber !== undefined ? { itemNumber } : {}),
        ...(name !== undefined ? { name } : {}),
      }),
    )
  })

  app.post('/api/games/:gameId/items/discard', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const sheetName = parseSheetName(c, optionalString(body, 'sheetName'))
    if (sheetName instanceof Response) return sheetName

    const itemNumber = optionalNumber(body, 'itemNumber')
    const name = optionalString(body, 'name')

    return applyToGame(context, c, gameId, (state) =>
      discardItem(state, {
        playerId: currentPlayer(c).id,
        sheetName,
        ...(itemNumber !== undefined ? { itemNumber } : {}),
        ...(name !== undefined ? { name } : {}),
      }),
    )
  })

  /** Java: `PlayerResource.itemBackToDeck`. */
  app.post('/api/games/:gameId/items/backtodeck', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const sheetName = parseSheetName(c, optionalString(body, 'sheetName'))
    if (sheetName instanceof Response) return sheetName

    const name = requireString(body, 'name')
    if (name === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'name is required')
    }

    return applyToGame(context, c, gameId, (state) =>
      playerPutsItemBackInDeck(state, {
        playerId: currentPlayer(c).id,
        sheetName,
        name,
      }),
    )
  })

  app.post('/api/games/:gameId/items/trade', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const sheetName = parseSheetName(c, optionalString(body, 'sheetName'))
    if (sheetName instanceof Response) return sheetName

    const targetPlayerId = requireString(body, 'targetPlayerId')
    if (targetPlayerId === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'targetPlayerId is required')
    }
    const itemNumber = optionalNumber(body, 'itemNumber')
    const name = optionalString(body, 'name')

    return applyToGame(context, c, gameId, (state) =>
      tradeToPlayer(state, {
        playerId: currentPlayer(c).id,
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
  app.post('/api/games/:gameId/endturn', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const membership = await requireMembership(context, c, gameId)
    if (membership instanceof Response) return membership

    const player = currentPlayer(c)
    return applyToGame(
      context,
      c,
      gameId,
      (state) => endTurn(state, { playerId: player.id, username: player.username }),
      undefined,
      { after: ({ before, after }) => context.notifications.turnEnded(before, after) },
    )
  })

  app.post('/api/games/:gameId/taketurn', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const membership = await requireMembership(context, c, gameId)
    if (membership instanceof Response) return membership

    return applyToGame(context, c, gameId, (state) => takeTurn(state, currentPlayer(c).id))
  })

  app.get('/api/games/:gameId/turns/public', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state) => allPublicTurns(state))
  })

  app.get('/api/games/:gameId/turns/mine', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    return readGame(context, c, gameId, (state, viewerId) => playersTurns(state, viewerId))
  })

  /**
   * Java: `PlayerResource.updateTurn` with `TurnDTO`. Unlike `endturn`, the
   * engine's `updateTurn` already calls `hasUserAccess` on the caller and
   * returns `NO_ACCESS` (403) for a non-member, so no extra gate is needed here.
   */
  app.post('/api/games/:gameId/turns/update', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const phase = parsePhase(c, optionalString(body, 'phase'))
    if (phase instanceof Response) return phase

    const turnNumber = optionalNumber(body, 'turnNumber') ?? 1
    const order = optionalString(body, 'order') ?? ''
    const actor = currentPlayer(c)

    return applyToGame(
      context,
      c,
      gameId,
      (state) => updateTurn(state, { playerId: actor.id, turnNumber, phase, order }),
      undefined,
      {
        after: ({ after }) =>
          context.notifications.phaseUpdated(after, actor.username, phase, order),
      },
    )
  })

  /** `lockOrUnlockTurn` also gates on `hasUserAccess` in the engine, same as `updateTurn`. */
  app.post('/api/games/:gameId/turns/lock', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const turnNumber = optionalNumber(body, 'turnNumber') ?? 1
    const locked = body['locked'] === true

    return applyToGame(context, c, gameId, (state) =>
      lockOrUnlockTurn(state, { playerId: currentPlayer(c).id, turnNumber, locked }),
    )
  })

  app.post('/api/games/:gameId/note', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const note = optionalString(asRecord(await c.req.json().catch(() => ({}))), 'note') ?? ''
    return applyToGame(
      context,
      c,
      gameId,
      (state) => saveNote(state, currentPlayer(c).id, note),
      undefined,
      { record: false },
    )
  })

  /**
   * Update one of a player's shared status-board values. Any member of the game
   * may edit any player's values — this is shared bookkeeping, replacing the
   * old shared asset spreadsheet. The engine authorizes membership and
   * validates the stat and value.
   */
  app.post('/api/games/:gameId/players/:targetPlayerId/stat', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const targetPlayerId = c.req.param('targetPlayerId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const stat = requireString(body, 'stat')
    if (stat === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'stat is required')
    }
    const value = optionalNumber(body, 'value')
    if (value === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'value must be a number')
    }
    return applyToGame(context, c, gameId, (state) =>
      setPlayerStat(state, {
        editorPlayerId: currentPlayer(c).id,
        targetPlayerId,
        stat: stat as keyof PlayerStats,
        value,
      }),
    )
  })

  // -------------------------------------------------------------------------
  // Undo
  // -------------------------------------------------------------------------

  /** Java: `GameResource.undoItem` — PUT /{pbfId}/undo/{gameLogId}. */
  app.post('/api/games/:gameId/undo/:logId', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const logId = c.req.param('logId')
    return applyToGame(context, c, gameId, (state) =>
      initiateUndo(state, { logId, playerId: currentPlayer(c).id }),
    )
  })

  /** Java: `/{pbfId}/vote/{gameLogId}/yes` and `/no`. */
  app.post('/api/games/:gameId/undo/:logId/vote', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const logId = c.req.param('logId')
    const value = asRecord(await c.req.json().catch(() => ({})))['vote']

    return applyToGame(context, c, gameId, (state) =>
      vote(state, { logId, playerId: currentPlayer(c).id, vote: value === true }),
    )
  })

  /**
   * Java: `PlayerResource.getAllUndoThatNeedsVoteFromPlayer`. A spectator has
   * nothing to vote on, so it answers an empty list rather than requiring an
   * account (issue #81).
   */
  app.get('/api/games/:gameId/undo/pending', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    const me = c.get('player')

    return readGame(context, c, gameId, (state) =>
      me === undefined
        ? []
        : state.log
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

  app.get('/api/games/:gameId/undo/mine', optionalAuth, async (c) => {
    const gameId = c.req.param('gameId')
    const me = c.get('player')
    return readGame(context, c, gameId, (state) =>
      me === undefined
        ? []
        : playersActiveUndos(state, me.username).map((entry) => ({
            id: entry.id,
            message: entry.publicLog,
          })),
    )
  })
}
