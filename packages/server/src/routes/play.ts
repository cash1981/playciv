/**
 * Port of `resource/DrawResource.java` and `resource/PlayerResource.java`:
 * drawing, battle, techs, social policy, revealing, trading, turns and undo.
 */

import type { GameState, Government, PlayerStatKey, SheetName } from '@civ/engine'
import {
  ALL_WONDERS,
  CULTURE_CARD,
  chooseSocialPolicy,
  chooseTech,
  discardBarbarians,
  discardItem,
  discardRandomGreatPerson,
  draw,
  drawUnitsForBattle,
  drawWonder,
  endBattle,
  findSheetName,
  initiateUndo,
  loot,
  markPhasesDone,
  placeGreatPersonInPyramid,
  postOrder,
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
  setCoinSource,
  setPlayerStat,
  setPlayerGovernment,
  setPyramidPlacementSlot,
  setTechSlot,
  tradeToPlayer,
  turnStatus,
  unmarkPhaseDone,
  vote,
} from '@civ/engine'
import type { TurnPhase } from '@civ/engine'
import { TURN_PHASES } from '@civ/engine'
import type { Context } from 'hono'

import type { App } from '../app.js'
import { newId } from '../auth.js'
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

  /**
   * The `system` timeline rows for a done / not done change: the engine's own
   * public log line, so the two never disagree. No line means nothing changed.
   *
   * A done that finishes the turn also starts the next one, and the engine
   * writes a second line for that. It becomes a row of its own, tagged with the
   * new turn and the Start of turn phase, so the timeline has a divider and the
   * paging boundary (the first row tagged with the current turn) is exact.
   */
  const appendSystemRow = async (
    gameId: string,
    username: string,
    turnNumber: number,
    phase: TurnPhase,
    before: GameState,
    after: GameState,
  ): Promise<void> => {
    // `markPhasesDone` writes the done line first and, when the turn rolled over,
    // the line that starts the next turn straight after it. Read by position: the
    // divider must be that line and not merely the newest one.
    const line = after.log[before.log.length]
    if (line === undefined) return
    await context.repo.appendChat({
      id: newId(),
      gameId,
      username,
      message: line.publicLog,
      createdAt: new Date().toISOString(),
      kind: 'system',
      turnNumber,
      phase,
    })

    const started = Object.keys(after.turnStarters)
      .map(Number)
      .find((turn) => before.turnStarters[turn] === undefined)
    const startLine = after.log[before.log.length + 1]
    if (started === undefined || startLine === undefined) return
    await context.repo.appendChat({
      id: newId(),
      gameId,
      username,
      message: startLine.publicLog,
      createdAt: new Date().toISOString(),
      kind: 'system',
      turnNumber: started,
      phase: 'SOT',
    })
  }

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

    // Chat orders (issue #215): the client asks before drawing out of turn and
    // sends this on the second try. Ignored by the engine when the setting is off.
    const confirmedOutOfTurn =
      asRecord(await c.req.json().catch(() => ({})))['confirmedOutOfTurn'] === true

    return applyToGame(context, c, gameId, (state) => {
      const playerId = currentPlayer(c).id
      return ALL_WONDERS.has(sheetName)
        ? drawWonder(state, { playerId, sheetName, confirmedOutOfTurn })
        : draw(state, { playerId, sheetName, confirmedOutOfTurn })
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

  /** New in this port — see the pyramid-reposition task brief. No old-system equivalent. */
  app.post('/api/games/:gameId/techs/slot', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const techName = requireString(body, 'name')
    const slot = body['slot']
    if (techName === undefined || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5) {
      return sendError(c, 400, 'BAD_REQUEST', 'name and an integer slot 1-5 are required')
    }
    return applyToGame(context, c, gameId, (state) =>
      setTechSlot(state, { playerId: currentPlayer(c).id, techName, slot: slot as 1 | 2 | 3 | 4 | 5 }),
    )
  })

  /** New in this port — see the pyramid-reposition task brief. No old-system equivalent. */
  app.post('/api/games/:gameId/greatperson/place', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const itemId = requireString(body, 'itemId')
    const slot = body['slot']
    if (itemId === undefined || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5) {
      return sendError(c, 400, 'BAD_REQUEST', 'itemId and an integer slot 1-5 are required')
    }
    return applyToGame(context, c, gameId, (state) =>
      placeGreatPersonInPyramid(state, { playerId: currentPlayer(c).id, itemId, slot: slot as 1 | 2 | 3 | 4 | 5 }),
    )
  })

  /** New in this port — see the pyramid-reposition task brief. No old-system equivalent. */
  app.post('/api/games/:gameId/greatperson/slot', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const name = requireString(body, 'name')
    const slot = body['slot']
    if (name === undefined || typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5) {
      return sendError(c, 400, 'BAD_REQUEST', 'name and an integer slot 1-5 are required')
    }
    return applyToGame(context, c, gameId, (state) =>
      setPyramidPlacementSlot(state, { playerId: currentPlayer(c).id, name, slot: slot as 1 | 2 | 3 | 4 | 5 }),
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

  /**
   * Discards one random Great Person of the given `type` from the acting
   * player's own hand. New mechanic, no old-system counterpart; the type is a
   * body field because the values contain spaces ("Artist or Thinker").
   */
  app.post('/api/games/:gameId/greatperson/discard', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const type = requireString(body, 'type')
    if (type === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'type is required')
    }

    return applyToGame(context, c, gameId, (state) =>
      discardRandomGreatPerson(state, { playerId: currentPlayer(c).id, type }),
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
  // Turns (issue #215): orders and done marks. The timeline row is written after
  // the game state, in the `after` hook: the repository has no call that stores
  // both at once, so a failure there is logged, not surfaced.
  // -------------------------------------------------------------------------

  /** A whole turn number of at least 1, or `undefined` when absent; a `Response` when malformed. */
  const parseTurnNumber = (
    c: Context<{ Variables: Variables }>,
    body: Record<string, unknown>,
  ): number | undefined | Response => {
    if (body['turnNumber'] === undefined) return undefined
    const turnNumber = optionalNumber(body, 'turnNumber')
    if (turnNumber === undefined || !Number.isInteger(turnNumber) || turnNumber < 1) {
      return sendError(c, 400, 'BAD_REQUEST', 'turnNumber must be a whole number of 1 or more')
    }
    return turnNumber
  }

  /**
   * Posts an order for a phase: engine state and the `order` timeline row in one
   * request. The turn defaults to the current one.
   */
  app.post('/api/games/:gameId/turns/order', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const phase = parsePhase(c, optionalString(body, 'phase'))
    if (phase instanceof Response) return phase
    const markdown = requireString(body, 'markdown')
    if (markdown === undefined) return sendError(c, 400, 'BAD_REQUEST', 'markdown is required')
    const requestedTurn = parseTurnNumber(c, body)
    if (requestedTurn instanceof Response) return requestedTurn

    const actor = currentPlayer(c)
    const at = new Date().toISOString()
    let turnNumber = 1
    return applyToGame(
      context,
      c,
      gameId,
      (state) => {
        turnNumber = requestedTurn ?? turnStatus(state).currentTurn
        return postOrder(state, { playerId: actor.id, turnNumber, phase, markdown, at })
      },
      undefined,
      {
        description: `${actor.username} posted an order`,
        after: async ({ after }) => {
          try {
            await context.repo.appendChat({
              id: newId(),
              gameId,
              username: actor.username,
              message: markdown,
              createdAt: at,
              kind: 'order',
              turnNumber,
              phase,
            })
          } finally {
            // Same mail as a chat message, held the same way (#217). The order is
            // public, so its text may be in the body.
            await context.notifications.chatPosted(after, actor.id, actor.username, markdown)
          }
        },
      },
    )
  })

  /**
   * Marks a phase, and every phase before it, done. A `system` row is written
   * only when something changed.
   */
  app.post('/api/games/:gameId/turns/done', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const phase = parsePhase(c, optionalString(body, 'phase'))
    if (phase instanceof Response) return phase
    const requestedTurn = parseTurnNumber(c, body)
    if (requestedTurn instanceof Response) return requestedTurn

    const actor = currentPlayer(c)
    const at = new Date().toISOString()
    let turnNumber = 1
    return applyToGame(
      context,
      c,
      gameId,
      (state) => {
        turnNumber = requestedTurn ?? turnStatus(state).currentTurn
        return markPhasesDone(state, { playerId: actor.id, turnNumber, upToPhase: phase, at })
      },
      undefined,
      {
        after: async ({ before, after }) => {
          // The timeline row must not stop the mail to the new holder
          try {
            await appendSystemRow(gameId, actor.username, turnNumber, phase, before, after)
          } catch (error) {
            console.error('Writing the done row to the timeline failed', error)
          }
          await context.notifications.turnHolderChanged(before, after)
        },
      },
    )
  })

  /** Takes one phase back to not done. Later phases keep their marker. */
  app.post('/api/games/:gameId/turns/undone', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const phase = parsePhase(c, optionalString(body, 'phase'))
    if (phase instanceof Response) return phase
    const requestedTurn = parseTurnNumber(c, body)
    if (requestedTurn instanceof Response) return requestedTurn

    const actor = currentPlayer(c)
    let turnNumber = 1
    return applyToGame(
      context,
      c,
      gameId,
      (state) => {
        turnNumber = requestedTurn ?? turnStatus(state).currentTurn
        return unmarkPhaseDone(state, { playerId: actor.id, turnNumber, phase })
      },
      undefined,
      {
        after: ({ before, after }) =>
          appendSystemRow(gameId, actor.username, turnNumber, phase, before, after),
      },
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
    // Movement (issue #102) is sent as a string ("3+1") so a printed bonus can
    // be recorded, though a bare number is still accepted. Combat hand size is
    // free text the same way. Every other stat
    // keeps `optionalNumber`, including the numeric strings older clients sent.
    const rawValue = body['value']
    const isText = stat === 'mvmt' || stat === 'combatHandSize'
    const value =
      isText
        ? typeof rawValue === 'number' || typeof rawValue === 'string'
          ? rawValue
          : undefined
        : optionalNumber(body, 'value')
    if (value === undefined) {
      return sendError(
        c,
        400,
        'BAD_REQUEST',
        stat === 'mvmt'
          ? 'value must be a movement expression'
          : isText
            ? 'value must be text'
            : 'value must be a number',
      )
    }
    return applyToGame(context, c, gameId, (state) =>
      setPlayerStat(state, {
        editorPlayerId: currentPlayer(c).id,
        targetPlayerId,
        stat: stat as PlayerStatKey,
        value,
      }),
    )
  })

  /**
   * Update one coin counter on a player's shared status board. Same shared
   * bookkeeping rules as `/stat`; the engine validates the source and its limit.
   */
  app.post('/api/games/:gameId/players/:targetPlayerId/coin', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const targetPlayerId = c.req.param('targetPlayerId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const source = requireString(body, 'source')
    if (source === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'source is required')
    }
    const value = optionalNumber(body, 'value')
    if (value === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'value must be a number')
    }
    return applyToGame(context, c, gameId, (state) =>
      setCoinSource(state, {
        editorPlayerId: currentPlayer(c).id,
        targetPlayerId,
        source,
        value,
      }),
    )
  })

  /** Shared government bookkeeping, parallel to the numeric status values. */
  app.post('/api/games/:gameId/players/:targetPlayerId/government', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const targetPlayerId = c.req.param('targetPlayerId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const government = requireString(body, 'government')
    if (government === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'government is required')
    }
    return applyToGame(context, c, gameId, (state) =>
      setPlayerGovernment(state, {
        editorPlayerId: currentPlayer(c).id,
        targetPlayerId,
        government: government as Government,
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
