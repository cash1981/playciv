/**
 * Battle arena routes — issue #63.
 *
 * All routes require authentication. The arena state is fully public (both
 * sides see everything once placed). `rev` is supplied by the client on
 * writes so concurrent edits can be detected with a 409 Conflict.
 */

import type { ArenaStatKey } from '@civ/engine'
import {
  endBattleAction,
  endBattleTurn,
  initiateBattle,
  killArenaUnit,
  placeUnitInArena,
  setArenaUnitStat,
} from '@civ/engine'

import type { App } from '../app.js'
import type { AppContext } from '../context.js'
import {
  applyToGame,
  asRecord,
  authenticateWith,
  currentPlayer,
  optionalNumber,
  requireString,
} from '../context.js'
import { sendError } from '../errors.js'

export function registerArenaRoutes(app: App, context: AppContext): void {
  const auth = authenticateWith(context)

  /**
   * Initiate a battle. Body: `{ opponentId: string | 'barbarians', rev: number }`.
   * The caller becomes the attacker. Barbarians are initiated by sending
   * `opponentId: 'barbarians'`.
   */
  app.post('/api/games/:gameId/battle/arena/initiate', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const opponentId = requireString(body, 'opponentId')
    const clientRev = optionalNumber(body, 'rev')

    if (opponentId === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'opponentId is required')
    }

    return applyToGame(
      context,
      c,
      gameId,
      (state) =>
        initiateBattle(state, {
          initiatorId: currentPlayer(c).id,
          opponentId,
        }),
      clientRev,
    )
  })

  /**
   * Place a unit from the battlehand (or barbarian list) into the arena.
   * Body: `{ unitId, side, position, attack, health, rev }`.
   */
  app.post('/api/games/:gameId/battle/arena/place', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))

    const unitId = requireString(body, 'unitId')
    const sideRaw = requireString(body, 'side')
    const position = optionalNumber(body, 'position')
    const attack = optionalNumber(body, 'attack')
    const health = optionalNumber(body, 'health')
    const clientRev = optionalNumber(body, 'rev')

    if (unitId === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'unitId is required')
    }
    if (sideRaw !== 'attacker' && sideRaw !== 'defender') {
      return sendError(c, 400, 'BAD_REQUEST', 'side must be "attacker" or "defender"')
    }
    if (position === undefined || !Number.isInteger(position) || position < 0) {
      return sendError(c, 400, 'BAD_REQUEST', 'position must be a non-negative integer')
    }
    if (attack === undefined || !Number.isInteger(attack) || attack < 0) {
      return sendError(c, 400, 'BAD_REQUEST', 'attack must be a non-negative integer')
    }
    if (health === undefined || !Number.isInteger(health) || health < 0) {
      return sendError(c, 400, 'BAD_REQUEST', 'health must be a non-negative integer')
    }

    return applyToGame(
      context,
      c,
      gameId,
      (state) =>
        placeUnitInArena(state, {
          playerId: currentPlayer(c).id,
          unitId,
          side: sideRaw,
          position,
          attack,
          health,
        }),
      clientRev,
    )
  })

  /**
   * Update the attack or health of an arena unit.
   * Body: `{ key: 'attack' | 'health', value: number, rev: number }`.
   * Any game member may call this; the change is logged.
   */
  app.patch('/api/games/:gameId/battle/arena/:arenaUnitId', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const arenaUnitId = c.req.param('arenaUnitId')
    const body = asRecord(await c.req.json().catch(() => ({})))

    const keyRaw = requireString(body, 'key')
    const value = optionalNumber(body, 'value')
    const clientRev = optionalNumber(body, 'rev')

    if (keyRaw !== 'attack' && keyRaw !== 'health') {
      return sendError(c, 400, 'BAD_REQUEST', 'key must be "attack" or "health"')
    }
    if (value === undefined) {
      return sendError(c, 400, 'BAD_REQUEST', 'value is required')
    }

    return applyToGame(
      context,
      c,
      gameId,
      (state) =>
        setArenaUnitStat(state, {
          playerId: currentPlayer(c).id,
          arenaUnitId,
          key: keyRaw as ArenaStatKey,
          value,
        }),
      clientRev,
    )
  })

  /**
   * Kill (remove) an arena unit. Body: `{ rev: number }`.
   * The unit is removed from the arena; `inBattle` is cleared on the source
   * card so the player can discard/reveal it themselves.
   */
  app.post('/api/games/:gameId/battle/arena/:arenaUnitId/kill', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const arenaUnitId = c.req.param('arenaUnitId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const clientRev = optionalNumber(body, 'rev')

    return applyToGame(
      context,
      c,
      gameId,
      (state) =>
        killArenaUnit(state, {
          playerId: currentPlayer(c).id,
          arenaUnitId,
        }),
      clientRev,
    )
  })

  /**
   * End the current battle turn, flipping it to the other side.
   * Body: `{ rev: number }`.
   */
  app.post('/api/games/:gameId/battle/arena/turn/end', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const clientRev = optionalNumber(body, 'rev')

    return applyToGame(
      context,
      c,
      gameId,
      (state) => endBattleTurn(state, { playerId: currentPlayer(c).id }),
      clientRev,
    )
  })

  /**
   * End the battle entirely. Body: `{ rev: number }`.
   * Clears the arena and resets `inBattle` on all involved units.
   * If no battle is active, falls back to clearing `inBattle` on the
   * caller's own hand (the existing standalone behaviour).
   */
  app.post('/api/games/:gameId/battle/arena/end', auth, async (c) => {
    const gameId = c.req.param('gameId')
    const body = asRecord(await c.req.json().catch(() => ({})))
    const clientRev = optionalNumber(body, 'rev')

    return applyToGame(
      context,
      c,
      gameId,
      (state) => endBattleAction(state, { playerId: currentPlayer(c).id }),
      clientRev,
    )
  })
}
