/**
 * What a building put on a square takes the place of, shared by Build and by A. P. Giannini's free
 * building (base rules p. 17 and 18). Split out of `assisted.ts` because `assisted-sot.ts`, which
 * `assisted.ts` imports, needs the same code; this file imports neither of them.
 */
import { movePieceUnchecked, removePiece } from './actions/board.js'
import { placeBack } from './assisted-core.js'
import { ownAreaOf } from './assisted-culture.js'
import { AREA_LABEL_HEIGHT, areaAt, boardAreas, nextFreeSlot } from './board.js'
import type { BoardPiece } from './board.js'
import { mapCellOf } from './blockade.js'
import { buildingNameOf } from './building-data.js'
import type { BuildSquare, ReplacedPiece } from './build-options.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { GameState, Playerhand } from './state.js'

/** What a build replaced, as its effect keeps it: a building or wonder that was removed, or a Great Person that was held in reserve. */
export interface ReplacedEffect {
  readonly replaced?: { readonly piece: BoardPiece; readonly historyId: string } | undefined
  readonly reserved?: { readonly piece: BoardPiece; readonly historyId: string } | undefined
}

/** ", and the Library it replaced was put back": the part of an undo line about a replaced building, wonder or Great Person. */
export function replacedText(effect: ReplacedEffect): string {
  const old = effect.replaced?.piece ?? effect.reserved?.piece
  if (old === undefined) return ''
  const name = old.category === 'building' ? (buildingNameOf(old.assetId) ?? old.label) : old.label
  return `, and ${old.category === 'wonder' ? name.replace(/^The /, 'the ') : `the ${name}`} it replaced was put back`
}

/**
 * The public log's part about what a building replaced, for a build or a free building: ", replacing the Library",
 * with where a wonder or a Great Person ends up. Empty when nothing was replaced.
 */
export function replacingText(replaces: ReplacedPiece | undefined): string {
  if (replaces === undefined) return ''
  return replaces.kind === 'wonder'
    ? `, replacing ${replaces.label.replace(/^The /, 'the ')}, which is destroyed`
    : replaces.kind === 'greatperson'
      ? `, replacing the ${replaces.label} (Great Person), which goes back to the player area`
      : `, replacing the ${replaces.label}`
}

/**
 * Whether the Great Person a build held in reserve can be moved back: it is still on the board and
 * still in its owner's player area. `undefined` when it can, else the sentence that says why not.
 */
export function reservedUndoBlock(state: GameState, ownerId: string, effect: ReplacedEffect): string | undefined {
  if (effect.reserved === undefined) return undefined
  const person = state.board.pieces.find((candidate) => candidate.id === effect.reserved?.piece.id)
  const name = effect.reserved.piece.label
  if (person === undefined) return `The ${name} is no longer on the board, so the build cannot be undone.`
  const inArea =
    areaAt(boardAreas(state.board, state.players), person.x + person.width / 2, person.y + person.height / 2)?.playerId === ownerId
  return inArea ? undefined : `The ${name} has left your player area. Move it back first.`
}

/** Puts back what a build replaced: a removed piece exactly as it was, or a Great Person on the square it stood on. */
export function putReplacedBack(state: GameState, player: Playerhand, effect: ReplacedEffect, at: string | null): GameState {
  if (effect.replaced !== undefined) return placeBack(state, player, effect.replaced.piece, at)
  if (effect.reserved === undefined) return state
  const back = movePieceUnchecked(state, {
    playerId: player.playerId,
    pieceId: effect.reserved.piece.id,
    x: effect.reserved.piece.x,
    y: effect.reserved.piece.y,
    snap: false,
    ...(at === null ? {} : { at }),
  })
  return back ?? state
}

/**
 * Takes the building, wonder or Great Person a new piece replaces off its square (base rules p. 17
 * and 18: the old piece goes first, then the new one is placed on the empty square). A building or
 * wonder is removed from the board; a Great Person is held in reserve, which is the player's own
 * area, where it has no effect. The piece is the one standing on the square; `square.replaces` was
 * read from this same state by `buildOptionsOf`. `Err` is a sentence for the player and nothing is
 * changed.
 */
export function removeReplaced(
  state: GameState,
  player: Playerhand,
  square: BuildSquare,
  at: { readonly at?: string },
): Result<
  { readonly state: GameState; readonly piece: BoardPiece; readonly historyId: string; readonly reserved: boolean },
  string
> {
  const replaces = square.replaces
  if (replaces === undefined) return err('There is nothing to replace on that square.')
  const old = state.board.pieces.find((piece) => {
    if (piece.category !== 'building' && piece.category !== 'wonder' && piece.category !== 'greatperson') return false
    if (piece.assetId !== replaces.assetId) return false
    const cell = mapCellOf(state.board, piece)
    return cell !== null && cell.column === square.column && cell.row === square.row
  })
  if (old === undefined) return err(`${replaces.label} is no longer on ${square.label}.`)

  if (old.category === 'greatperson') {
    const area = ownAreaOf(state, player.playerId)
    if (area === undefined) return err('You have no player area on the board to hold the Great Person in.')
    const [slotX, slotY] = nextFreeSlot(state.board, area, state.board.pieces, {
      x: area.x + 20,
      y: area.y + AREA_LABEL_HEIGHT + 10,
    })
    const held = movePieceUnchecked(state, {
      playerId: player.playerId,
      pieceId: old.id,
      x: slotX,
      y: slotY,
      ...at,
    })
    const entry = held?.board.history.at(-1)
    if (held === undefined || entry === undefined || entry.change.kind !== 'move') {
      return err(`${replaces.label} on ${square.label} could not be put back in your player area.`)
    }
    return ok({ state: held, piece: old, historyId: entry.id, reserved: true })
  }

  const removed = removePiece(state, { playerId: player.playerId, pieceId: old.id, ...at })
  const entry = removed.ok ? removed.value.board.history.at(-1) : undefined
  if (!removed.ok || entry === undefined) return err(`${replaces.label} on ${square.label} could not be taken off the board.`)
  return ok({ state: removed.value, piece: old, historyId: entry.id, reserved: false })
}
