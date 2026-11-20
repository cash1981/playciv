/**
 * The conquest rewards of the civ cards (issue #368). The Romans advance one space on the culture track for free each time
 * they conquer a city (another player's) or a village; the Chinese gain 3 culture when they conquer a village. The human
 * wants a prompt, never an automatic gain, so a conquest only ever creates an offer the player answers
 * (`claimConquest`, `assisted-conquest.ts`).
 *
 * The game does not model a conquest, so it is recognised from what it can see, in two steps:
 *
 * 1. An own army of a Roman or Chinese player ends its move (`travelFigureCollecting`) on a village token, or (Romans only)
 *    on a centre square of another player's city. That is recorded as the player's pending conquest, one per player.
 * 2. When a battle ends (`endBattleAction`) and that player won it with that army still on the recorded square, against the
 *    matching side (the barbarians for a village, the city's owner for a city), an offer is made. The pending conquests of
 *    the combatants are used up whatever the outcome.
 *
 * What this cannot tell: that the battle was really fought for that village or city (the same player, an army that stands on
 * the square and a won battle with the right opponent is taken as it), and a city that changes owner is not modelled.
 */

import { cityCentredAt, figureKindOf } from './disband.js'
import { mapCellOf } from './blockade.js'
import type { Cell } from './blockade.js'
import { squareLabel } from './build-options.js'
import { findPiece } from './board.js'
import type { EngineError } from './errors.js'
import { figureBelongsTo } from './movement.js'
import { nextId } from './random.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import type { BattleSideId } from './battle.js'
import type { ConquestCiv, ConquestOffer, EndedBattle, GameState, PendingConquest, Playerhand } from './state.js'
import { mapTokensOf } from './zheng-he.js'

const CONQUEST_CIVS: readonly ConquestCiv[] = ['Romans', 'Chinese']

/** The civ whose conquests give a reward, or `undefined` for every other player. */
export function conquestCivOf(player: Pick<Playerhand, 'civilization'> | undefined): ConquestCiv | undefined {
  const name = player?.civilization?.name
  return CONQUEST_CIVS.find((civ) => civ === name)
}

const sameCell = (a: Cell, b: Cell): boolean => a.column === b.column && a.row === b.row

/** Another player's city with a centre on the square, and its owner: a player of another colour than `player`'s. */
function foreignCityAt(state: GameState, player: Playerhand, cell: Cell) {
  const own = player.color?.toLowerCase()
  for (const other of state.players) {
    const colour = other.color?.toLowerCase()
    if (other.playerId === player.playerId || colour === undefined || colour === own) continue
    const city = cityCentredAt(state.board, colour, cell)
    if (city !== undefined) return { city, owner: other }
  }
  return undefined
}

/**
 * The conquest the move of `pieceId` to `cell` makes, judged on the board as it stood before the move (a village token
 * that is collected on the move is still there then). `undefined` unless the piece is an army of a Roman or Chinese player
 * and the square holds a village token, or (Romans) a city of another player. A scout never conquers.
 */
export function pendingConquestOf(state: GameState, playerId: string, pieceId: string, cell: Cell): PendingConquest | undefined {
  const player = state.players.find((candidate) => candidate.playerId === playerId)
  const civ = conquestCivOf(player)
  const piece = findPiece(state.board, pieceId)
  if (player === undefined || civ === undefined || piece === undefined || figureKindOf(piece) !== 'army') return undefined
  const where = { playerId, pieceId, column: cell.column, row: cell.row, square: squareLabel(cell) }
  if (mapTokensOf(state.board).some((token) => token.sheet === 'VILLAGES' && sameCell(token.cell, cell))) {
    return { ...where, kind: 'village' }
  }
  if (civ === 'Romans' && foreignCityAt(state, player, cell) !== undefined) return { ...where, kind: 'city' }
  return undefined
}

/** The lists with the empty ones left out, so a game without conquests carries no trace of them. */
function withConquestLists(
  state: GameState,
  pending: readonly PendingConquest[],
  offers: readonly ConquestOffer[],
): GameState {
  const { pendingConquests: _pending, conquestOffers: _offers, ...rest } = state
  return {
    ...rest,
    ...(pending.length === 0 ? {} : { pendingConquests: pending }),
    ...(offers.length === 0 ? {} : { conquestOffers: offers }),
  }
}

/** The open offers replaced by `offers`, the pending conquests as they are. */
export function withConquestOffers(state: GameState, offers: readonly ConquestOffer[]): GameState {
  return withConquestLists(state, state.pendingConquests ?? [], offers)
}

/** Records the conquest as the player's pending one, in place of the one they had. */
export function withPendingConquest(state: GameState, conquest: PendingConquest | undefined): GameState {
  if (conquest === undefined) return state
  const others = (state.pendingConquests ?? []).filter((entry) => entry.playerId !== conquest.playerId)
  return withConquestLists(state, [...others, conquest], state.conquestOffers ?? [])
}

/** A side of a battle: who controls it, and whether it is a player's army or the barbarians. */
export interface Combatant {
  readonly kind: 'player' | 'barbarians'
  readonly playerId: string
}

/** Whether the pending conquest's army still stands on its square. */
function stillStandsOn(state: GameState, player: Playerhand, entry: PendingConquest): boolean {
  const piece = findPiece(state.board, entry.pieceId)
  if (piece === undefined || figureKindOf(piece) !== 'army' || !figureBelongsTo(player, piece)) return false
  const cell = mapCellOf(state.board, piece)
  return cell !== null && sameCell(cell, entry)
}

/** Whether the beaten side is the one this conquest is over: the barbarians for a village, the city's owner for a city. */
function beatenMatches(state: GameState, entry: PendingConquest, civ: ConquestCiv, loser: Combatant): boolean {
  if (entry.kind === 'village') return loser.kind === 'barbarians'
  if (civ !== 'Romans' || loser.kind !== 'player' || loser.playerId === entry.playerId) return false
  const colour = state.players.find((candidate) => candidate.playerId === loser.playerId)?.color?.toLowerCase()
  return colour !== undefined && cityCentredAt(state.board, colour, entry) !== undefined
}

/**
 * The end of a battle settles the conquests of its combatants: whatever the outcome their pending conquests are used up,
 * and a combatant who won with the army still on the recorded square against the matching side gets an offer. Barbarians
 * are nobody's army, so the player who only controls them loses nothing. `conquest` is what the end must remember, to be
 * given back by `takeBackConquest`; `undefined` when the battle had nothing to do with a conquest.
 */
export function settleConquests(
  state: GameState,
  battle: { readonly attacker: Combatant; readonly defender: Combatant },
  winnerSide: BattleSideId | null,
): { readonly state: GameState; readonly conquest: EndedBattle['conquest'] } {
  const fighting = new Set([battle.attacker, battle.defender].filter((side) => side.kind === 'player').map((side) => side.playerId))
  const used = (state.pendingConquests ?? []).filter((entry) => fighting.has(entry.playerId))
  if (used.length === 0) return { state, conquest: undefined }
  const winner = winnerSide === null ? undefined : battle[winnerSide]
  const loser = winnerSide === null ? undefined : battle[winnerSide === 'attacker' ? 'defender' : 'attacker']

  let rng = state.rng
  const offers: ConquestOffer[] = []
  for (const entry of used) {
    if (winner === undefined || loser === undefined || winner.kind !== 'player' || winner.playerId !== entry.playerId) continue
    const player = state.players.find((candidate) => candidate.playerId === entry.playerId)
    const civ = conquestCivOf(player)
    if (player === undefined || civ === undefined || !stillStandsOn(state, player, entry)) continue
    if (!beatenMatches(state, entry, civ, loser)) continue
    const [id, next] = nextId(rng)
    rng = next
    offers.push({ id, playerId: entry.playerId, kind: entry.kind, square: entry.square, civ })
  }
  const rest = (state.pendingConquests ?? []).filter((entry) => !used.includes(entry))
  return {
    state: withConquestLists({ ...state, rng }, rest, [...(state.conquestOffers ?? []), ...offers]),
    conquest: { offerIds: offers.map((offer) => offer.id), pending: used },
  }
}

/** The applied answer to an offer, if one stands: the claim that took it or declined it. */
export function answeredClaimOf(state: GameState, offerId: string) {
  return state.assistedActions.find(
    (record) => record.status === 'applied' && record.effect.kind === 'conquestClaim' && record.effect.offer.id === offerId,
  )
}

/**
 * Undoing the end of a battle takes back what it settled: the offers still open are removed and the pending conquests it
 * used up are given back (unless the player has made a newer move since), so ending the battle again can offer again. An
 * offer that was answered stands in the way: the answer is undone first, which opens the offer again.
 */
export function takeBackConquest(state: GameState, conquest: NonNullable<EndedBattle['conquest']>): Result<GameState, EngineError> {
  for (const id of conquest.offerIds) {
    const answered = answeredClaimOf(state, id)
    if (answered === undefined || answered.effect.kind !== 'conquestClaim') continue
    const { offer, accepted } = answered.effect
    const what = offer.kind === 'village' ? 'village' : 'city'
    return err({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: answered.logId,
      reason: accepted
        ? `The conquest of the ${what} on ${offer.square} was taken (${offer.civ === 'Romans' ? 'the free advance' : 'the 3 culture'}). Undo that first, then undo the end of the battle.`
        : `The offer for the ${what} on ${offer.square} was declined. Undo that first, then undo the end of the battle.`,
    })
  }
  const offers = (state.conquestOffers ?? []).filter((offer) => !conquest.offerIds.includes(offer.id))
  const pending = [...(state.pendingConquests ?? [])]
  for (const entry of conquest.pending) {
    if (!pending.some((other) => other.playerId === entry.playerId)) pending.push(entry)
  }
  return ok(withConquestLists(state, pending, offers))
}
