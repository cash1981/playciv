/**
 * Translates `EngineError` into HTTP.
 *
 * The status codes are the ones Java used when it threw
 * `WebApplicationException` straight from the domain logic. The choice now
 * lives here, where it belongs.
 */

import type { EngineError } from '@civ/engine'
import { describeError } from '@civ/engine'
import type { Context } from 'hono'
import type { ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'

/**
 * Statuses the Fetch spec forbids a body on. A `Response` built with one of
 * these and a non-null body throws, so we answer them empty — matching how
 * Fastify's `reply.code(304).send(body)` stripped the payload. In practice only
 * 304 (`ITEM_ALREADY_REVEALED`) reaches this from `statusFor`.
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

export function statusFor(error: EngineError): number {
  switch (error.kind) {
    case 'PLAYER_NOT_FOUND':
    case 'ITEM_NOT_FOUND':
    case 'LOG_ENTRY_NOT_FOUND':
    case 'TURN_NOT_FOUND':
    case 'NOTHING_TO_LOOT':
    case 'NOTHING_TO_DISCARD':
    case 'BOARD_PIECE_NOT_FOUND':
      return 404
    // Nothing on the board to take back
    case 'NOTHING_TO_UNDO_ON_BOARD':
      return 412
    // Java: 409 Conflict — there is no current turn to end yet
    case 'GAME_NOT_STARTED':
      return 409
    // The client asked for a piece that is not in the manifest
    case 'BOARD_ASSET_NOT_FOUND':
    // A player-stat update named an unknown stat or an invalid value
    case 'UNKNOWN_STAT':
    case 'INVALID_STAT_VALUE':
    case 'UNKNOWN_GOVERNMENT':
    case 'INVALID_ARENA_STAT_VALUE':
    case 'CANNOT_BATTLE_YOURSELF':
      return 400
    case 'BOARD_ASSET_LIMIT_REACHED':
    case 'BATTLE_ALREADY_ACTIVE':
    case 'UNIT_ALREADY_IN_BATTLE':
    case 'ARENA_POSITION_OCCUPIED':
      return 409
    case 'NO_BATTLE_ACTIVE':
    case 'ARENA_UNIT_NOT_FOUND':
      return 404
    case 'NOT_IN_THIS_BATTLE':
      return 403
    case 'NOT_YOUR_TURN':
    case 'NO_ACCESS':
    case 'GAME_CREATOR_MUST_END_GAME':
    case 'ONLY_GAME_CREATOR_CAN_END_GAME':
      return 403
    case 'ITEM_NOT_LOOTABLE':
      return 406
    case 'ITEM_ALREADY_REVEALED':
      return 304
    // Java: 412 Precondition Failed
    case 'BARBARIANS_NOT_DISCARDED':
    case 'UNDO_NOT_INITIATED':
      return 412
    // Java: 410 Gone — the deck is empty and cannot be refilled
    case 'NO_MORE_ITEMS':
      return 410
    case 'TECHS_ARE_CHOSEN_NOT_DRAWN':
    case 'NOT_SHUFFLABLE':
    case 'TECH_ALREADY_CHOSEN':
    case 'SOCIAL_POLICY_ALREADY_CHOSEN':
    case 'SOCIAL_POLICY_FLIPSIDE_TAKEN':
    case 'CIVILIZATION_ALREADY_CHOSEN':
    case 'UNDO_ALREADY_INITIATED':
    case 'NOTHING_TO_UNDO':
    case 'GAME_IS_FULL':
    case 'ALREADY_JOINED':
    case 'NO_COLOR_AVAILABLE':
      return 400
  }
}

/** The shape the client sees for every error. */
export interface ErrorBody {
  readonly error: string
  readonly message: string
}

export function sendEngineError(c: Context, error: EngineError): Response {
  return sendError(c, statusFor(error), error.kind, describeError(error))
}

export function sendError(c: Context, status: number, kind: string, message: string): Response {
  if (NULL_BODY_STATUSES.has(status)) {
    return c.body(null, status as StatusCode)
  }
  const body: ErrorBody = { error: kind, message }
  return c.json(body, status as ContentfulStatusCode)
}
