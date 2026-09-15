/**
 * Oversetter `EngineError` til HTTP.
 *
 * Statuskodene er de Java brukte da den kastet `WebApplicationException` rett
 * fra domenelogikken. Nå ligger valget her, der det hører hjemme.
 */

import type { EngineError } from '@civ/engine'
import { describeError } from '@civ/engine'
import type { FastifyReply } from 'fastify'

export function statusFor(error: EngineError): number {
  switch (error.kind) {
    case 'PLAYER_NOT_FOUND':
    case 'ITEM_NOT_FOUND':
    case 'LOG_ENTRY_NOT_FOUND':
    case 'TURN_NOT_FOUND':
    case 'NOTHING_TO_LOOT':
    case 'BOARD_PIECE_NOT_FOUND':
      return 404
    // Klienten ba om en brikketype som ikke finnes i manifestet
    case 'BOARD_ASSET_NOT_FOUND':
      return 400
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
    // Java: 410 Gone — stokken er tom og kan ikke fylles
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

/** Svarformatet klienten forholder seg til for alle feil. */
export interface ErrorBody {
  readonly error: string
  readonly message: string
}

export function sendEngineError(reply: FastifyReply, error: EngineError): FastifyReply {
  const body: ErrorBody = { error: error.kind, message: describeError(error) }
  return reply.code(statusFor(error)).send(body)
}

export function sendError(
  reply: FastifyReply,
  status: number,
  kind: string,
  message: string,
): FastifyReply {
  const body: ErrorBody = { error: kind, message }
  return reply.code(status).send(body)
}
