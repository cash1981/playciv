/**
 * The Great Persons that hang on Devote to the Arts: Akira Kurosawa pays his holder when another
 * player devotes a city, and Charles Darwin turns a devoted city's culture into trade once a turn.
 * Jerry Garcia and Ada Lovelace are played as cards (`assisted-cards.ts`, `assisted-core.ts`).
 */

import { createPlayerTurn, turnStatus } from './turn.js'
import { activeGreatPerson } from './great-person-effects.js'
import { playerOf, useTurnAction, withPlayerHand } from './assisted-core.js'
import { tradeCeilingOf } from './limits.js'
import type { GameState, KurosawaPayment, Playerhand } from './state.js'

export const KUROSAWA_NAME = 'Akira Kurosawa'
export const DARWIN_NAME = 'Charles Darwin'
/** The once-a-turn marker Charles Darwin writes on the turn's record. */
export const DARWIN_KEY = 'person:Charles Darwin'

/**
 * Akira Kurosawa: "Each time another player devotes a city to the arts, you gain 1 culture." Pays
 * the faceup holder (never the player who devoted) 1 culture for each city devoted.
 */
export function payKurosawa(
  state: GameState,
  devoter: Playerhand,
  cities: number,
): { readonly state: GameState; readonly paid: readonly KurosawaPayment[]; readonly said: string } {
  const holders =
    cities < 1
      ? []
      : state.players.filter((candidate) => candidate.playerId !== devoter.playerId && activeGreatPerson(state, candidate, KUROSAWA_NAME))
  const paid = holders.map((holder) => ({ playerId: holder.playerId, culture: cities }))
  const next = holders.reduce(
    (current, holder) =>
      withPlayerHand(current, {
        ...(playerOf(current, holder.playerId) ?? holder),
        stats: { ...holder.stats, culture: holder.stats.culture + cities },
      }),
    state,
  )
  const said = holders.map((holder) => ` (Akira Kurosawa gives ${holder.username} ${cities} culture)`).join('')
  return { state: next, paid, said }
}

/**
 * Takes Akira Kurosawa's culture back from the holders when the devotion is undone. What the holder
 * has spent since is not taken twice: the stock stops at 0, and the undo line says so.
 */
export function takeBackKurosawa(
  state: GameState,
  paid: readonly KurosawaPayment[],
): { readonly state: GameState; readonly said: string } {
  const notes: string[] = []
  const next = paid.reduce((current, payment) => {
    const holder = playerOf(current, payment.playerId)
    if (holder === undefined) return current
    const taken = Math.min(payment.culture, holder.stats.culture)
    if (taken < payment.culture) notes.push(`${holder.username} had spent ${payment.culture - taken} of the culture from Akira Kurosawa`)
    return withPlayerHand(current, { ...holder, stats: { ...holder.stats, culture: holder.stats.culture - taken } })
  }, state)
  return { state: next, said: notes.length === 0 ? '' : ` (${notes.join('; ')})` }
}

/** The current turn's record, or a fresh one when the player has not written anything yet. */
export function currentTurnOf(state: GameState, player: Playerhand) {
  const turnNumber = turnStatus(state).currentTurn
  return player.playerTurns.find((turn) => turn.turnNumber === turnNumber) ?? createPlayerTurn(player.username, turnNumber)
}

/**
 * Charles Darwin for a devotion: `null` without the faceup card, `used` once he has been used this
 * turn, else `ready`.
 */
export function darwinStatusOf(state: GameState, player: Playerhand): 'ready' | 'used' | null {
  if (!activeGreatPerson(state, player, DARWIN_NAME)) return null
  return currentTurnOf(state, player).usedActions.includes(DARWIN_KEY) ? 'used' : 'ready'
}

/**
 * Charles Darwin: all of the culture the city produced becomes trade 1-for-1. The trade track ends at
 * its ceiling, so only the room left is added.
 */
export function darwinTradeOf(player: Playerhand, culture: number): number {
  return Math.max(0, Math.min(culture, tradeCeilingOf(player.civilization?.name) - player.stats.trade))
}

/** Marks Charles Darwin used for the turn, writing the stats at the same time. */
export function useDarwin(state: GameState, player: Playerhand, stats: Playerhand['stats']): {
  readonly state: GameState
  readonly usedAction: { readonly key: string; readonly turnNumber: number }
} {
  const turn = currentTurnOf(state, player)
  return { state: useTurnAction(state, player, turn, DARWIN_KEY, stats), usedAction: { key: DARWIN_KEY, turnNumber: turn.turnNumber } }
}
