/**
 * A free building put on a square of one of the player's cities, shared by A. P. Giannini
 * (`assisted-sot.ts`) and the Spanish civilization ability (`assisted-spanish.ts`). The caller owns what
 * makes the building free (an invest and a turn action, or an exploration credit), its choices and its log
 * line; this file owns the square rules, the placement as Build does it (a replaced limited building or Great
 * Person first) and the undo. Both record the effect kind `gianniniBuild`, which every later undo and board
 * Undo already handles; the record's own `kind` tells whose it is.
 */

import { placeUnchecked, removePiece } from './actions/board.js'
import { blocked, rejected } from './assisted-core.js'
import type { ApplyContext, AssistedPayload, BlockedAvailability, GianniniBuildPayload, Reversed } from './assisted-core.js'
import { putReplacedBack, removeReplaced, replacedText, reservedUndoBlock } from './assisted-replace.js'
import { mapCellOf } from './blockade.js'
import { findBoardAsset } from './board.js'
import type { BoardPiece } from './board.js'
import { buildingNameOf } from './building-data.js'
import { buildSquareRefusal, squareCentre, squareLabel } from './build-options.js'
import type { EngineError } from './errors.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { AssistedActionKind, AssistedActionRecord, AssistedEffect, FreeBuildingChoice, GameState, Playerhand } from './state.js'

/** "a Library", "an Aqueduct". */
export const withArticle = (name: string): string => `${/^[AEIO]|^U(?!ni)/.test(name) ? 'an' : 'a'} ${name}`

export const freeBuildPayloadOf = (payload: AssistedPayload | undefined): GianniniBuildPayload | undefined =>
  payload !== undefined && 'cityPieceId' in payload && 'assetId' in payload && 'column' in payload && 'row' in payload
    ? payload
    : undefined

type FreeBuildingEffect = Extract<AssistedEffect, { readonly kind: 'gianniniBuild' }>

export interface PlacedFreeBuilding {
  /** The state with the building on its square (and the replaced one off it); nothing else is changed. */
  readonly state: GameState
  readonly name: string
  readonly where: string
  readonly replaces: FreeBuildingChoice['squares'][number]['replaces']
  /** The board history entries to count as part of the action's log line, and the effect to record. */
  readonly historyIds: readonly string[]
  readonly effect: FreeBuildingEffect
}

/**
 * Validates the payload against the choices the caller offers and puts the building down. `gate` is the
 * caller's own check (asked after the payload is known to have the right shape), `undefined` to go on.
 */
export function placeFreeBuilding(
  state: GameState,
  player: Playerhand,
  context: ApplyContext,
  action: AssistedActionKind,
  choicesOf: (state: GameState, player: Playerhand) => readonly FreeBuildingChoice[],
  gate: () => BlockedAvailability | undefined,
  unreachable: string,
): Result<PlacedFreeBuilding, EngineError> {
  const payload = freeBuildPayloadOf(context.payload)
  const fail = (reason: string) => err(rejected(action, blocked('unavailable', reason)))
  if (payload === undefined) return fail('Choose the building and the square.')
  const refused = gate()
  if (refused !== undefined) return err(rejected(action, refused))
  // The server checks the shape; the engine is also called with whatever a caller sent
  const { cityPieceId, assetId, column, row } = payload as { readonly [K in keyof GianniniBuildPayload]: unknown }
  if (typeof cityPieceId !== 'string' || typeof assetId !== 'string') return fail('Choose the building and the square.')
  if (
    typeof column !== 'number' || typeof row !== 'number' ||
    !Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || column > 999 || row > 999
  ) {
    return fail('Choose a square on the map.')
  }
  const where = squareLabel({ column, row })
  const name = buildingNameOf(assetId)
  const offered = choicesOf(state, player)
    .find((choice) => choice.assetId === assetId)
    ?.squares.find((square) => square.cityPieceId === cityPieceId && square.column === column && square.row === row)
  if (name === undefined || offered === undefined) {
    const why = name === undefined ? undefined : buildSquareRefusal(state, player, cityPieceId, { kind: 'building', assetId }, { column, row })
    return fail(
      name === undefined
        ? 'Choose one of the buildings.'
        : why ?? `${withArticle(name)} cannot be built on ${where}: ${unreachable}`,
    )
  }
  const asset = findBoardAsset(assetId)
  if (asset === undefined) return fail(`The ${name} has no artwork to put on the board.`)
  const centre = squareCentre(state.board, { column, row })
  const stamp = context.at === undefined ? {} : { at: context.at }
  // As Build does: a limited building's old one is taken off first (a Great Person goes to the player's area), then the new one goes on the empty square
  let base = state
  let replaced: { readonly piece: BoardPiece; readonly historyId: string; readonly reserved: boolean } | undefined
  if (offered.replaces !== undefined) {
    const cleared = removeReplaced(state, player, offered, stamp)
    if (!cleared.ok) return fail(cleared.error)
    base = cleared.value.state
    replaced = { piece: cleared.value.piece, historyId: cleared.value.historyId, reserved: cleared.value.reserved }
  }
  const placed = placeUnchecked(base, {
    playerId: player.playerId,
    assetId,
    x: centre.x - asset.width / 2,
    y: centre.y - asset.height / 2,
    ...stamp,
  })
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
    return fail(`The ${name} could not be placed on ${where}.`)
  }
  const landed = mapCellOf(placed.board, entry.change.piece)
  if (landed === null || landed.column !== column || landed.row !== row) return fail(`The ${name} could not be placed on ${where}.`)
  return ok({
    state: placed,
    name,
    where,
    replaces: offered.replaces,
    historyIds: [entry.id, replaced?.historyId].filter((id): id is string => id !== undefined),
    effect: {
      kind: 'gianniniBuild',
      cityPieceId,
      assetId,
      label: name,
      square: { column, row, label: where },
      pieceId: entry.change.piece.id,
      historyId: entry.id,
      ...(replaced === undefined
        ? {}
        : replaced.reserved
          ? { reserved: { piece: replaced.piece, historyId: replaced.historyId } }
          : { replaced: { piece: replaced.piece, historyId: replaced.historyId } }),
    },
  })
}

/**
 * Takes the free building back off the board and puts back what it replaced. `source` names where it came from
 * ("A. P. Giannini") and `again` what the player may do now; the caller changes whatever made it free.
 */
export function reverseFreeBuilding(
  state: GameState,
  player: Playerhand,
  record: AssistedActionRecord,
  at: string | null,
  text: { readonly source: string; readonly again: string },
): Result<Reversed, EngineError> {
  const effect = record.effect
  if (effect.kind !== 'gianniniBuild') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
  const blockedBy = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
  const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
  // A building taken off the board by hand is already gone: the undo gives the free building back all the same.
  // One a later build or upgrade replaced comes back with that action's undo, so that goes first.
  if (piece === undefined) {
    const holder = state.assistedActions.find(
      (other) =>
        other.status === 'applied' &&
        ((other.effect.kind === 'build' && 'replaced' in other.effect && other.effect.replaced?.piece.id === effect.pieceId) ||
          (other.effect.kind === 'gianniniBuild' && other.effect.replaced?.piece.id === effect.pieceId) ||
          (other.effect.kind === 'upgradeBuildings' && other.effect.flipped.some((flip) => flip.from.id === effect.pieceId))),
    )
    if (holder !== undefined) {
      return blockedBy(`The ${effect.label} on ${effect.square.label} was replaced by a later action (${holder.kind}). Undo that first.`)
    }
    // What it replaced stands again all the same, unless a Great Person put in reserve has left the player's area
    const reservedGone = reservedUndoBlock(state, record.playerId, effect)
    if (reservedGone !== undefined) return blockedBy(reservedGone)
    // ...and unless the square or the city cannot take it back now: the piece goes where it stood, so nothing else may stand there
    const before = effect.replaced?.piece ?? effect.reserved?.piece
    if (before !== undefined) {
      const taken = state.board.pieces.some((other) => {
        if (other.category !== 'building' && other.category !== 'wonder' && other.category !== 'greatperson') return false
        const spot = mapCellOf(state.board, other)
        return spot !== null && spot.column === effect.square.column && spot.row === effect.square.row
      })
      if (taken) return blockedBy(`Something stands on ${effect.square.label} now, where the ${before.label} goes back. Take it off first.`)
      if (effect.replaced !== undefined) {
        const why = buildSquareRefusal(
          state,
          player,
          effect.cityPieceId,
          { kind: before.category === 'wonder' ? 'wonder' : 'building', assetId: before.assetId },
          effect.square,
        )
        if (why !== undefined) return blockedBy(`The ${before.label} cannot go back: ${why}`)
      }
    }
    return ok({
      state: putReplacedBack(state, player, effect, at),
      text: `${player.username}'s free ${effect.label} from ${text.source} was undone: it had already left ${effect.square.label} and ${text.again}${replacedText(effect)}`,
    })
  }
  const cell = mapCellOf(state.board, piece)
  if (cell === null || cell.column !== effect.square.column || cell.row !== effect.square.row) {
    return blockedBy(`The ${effect.label} has left ${effect.square.label}. Move it back first.`)
  }
  // Everything is checked before anything is changed, so a refusal leaves the game as it was
  const reservedBlock = reservedUndoBlock(state, record.playerId, effect)
  if (reservedBlock !== undefined) return blockedBy(reservedBlock)
  const removed = removePiece(state, {
    playerId: player.playerId,
    pieceId: effect.pieceId,
    ...(at === null ? {} : { at }),
  })
  if (!removed.ok) return blockedBy(`The ${effect.label} on ${effect.square.label} could not be taken off the board.`)
  return ok({
    state: putReplacedBack(removed.value, player, effect, at),
    text: `${player.username}'s free ${effect.label} from ${text.source} was undone: it is off ${effect.square.label} and ${text.again}${replacedText(effect)}`,
  })
}
