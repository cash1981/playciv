/**
 * The cards of the units killed in a battle. End battle puts them on the discard pile, each with a public `DISCARD` line, so
 * nobody has to discard them by hand. A card that comes back (the Chinese save one after the battle, Florence Nightingale
 * saves them, or End battle is undone) leaves the pile again, and its discard line can no longer be undone by vote: the
 * card is no longer where that line put it.
 *
 * Only a player's own units are discarded: the barbarians' units stay with whoever controls them, who discards them with
 * Discard barbarians as before. A unit Florence Nightingale saved during the battle is not killed for this.
 */

import type { ArenaUnit, Battle } from './battle.js'
import type { Item } from './item.js'
import { isUnit } from './item.js'
import { appendItemLog } from './log.js'
import type { GameState } from './state.js'
import { findPlayer, withPlayer } from './state.js'

/** One card End battle discarded: whose it is and the log line that says so. */
export interface DiscardedKilledCard {
  readonly cardId: string
  readonly ownerId: string
  readonly logId: string
  /** Where the card stood in the hand and in the battlehand (absent when it was not there), for the undo of End battle. */
  readonly itemIndex?: number
  readonly battlehandIndex?: number
}

const killedUnsaved = (battle: Battle): readonly ArenaUnit[] =>
  [...battle.arena, ...battle.departedUnits].filter((unit) => unit.killed && unit.saved !== true)

/**
 * Discards the cards of the killed, unsaved units of the player sides. A card that is no longer in `items` (discarded or
 * traded away during the battle) is left alone, whatever the battlehand still shows of it.
 */
export function discardKilledUnits(
  state: GameState,
  battle: Battle,
): { readonly state: GameState; readonly discarded: readonly DiscardedKilledCard[] } {
  let next = state
  const discarded: DiscardedKilledCard[] = []
  for (const unit of killedUnsaved(battle)) {
    const side = unit.side === 'attacker' ? battle.attacker : battle.defender
    if (side.kind !== 'player') continue
    const owner = findPlayer(next, side.playerId)
    if (owner === undefined) continue
    const itemIndex = owner.items.findIndex((item) => item.id === unit.unit.id)
    const battlehandIndex = owner.battlehand.findIndex((item) => item.id === unit.unit.id)
    // Only the card the player still holds counts: a battlehand entry can be a stale snapshot of a card that was discarded
    // by hand, and discarding it again would put it on the pile twice
    const card: Item | undefined = owner.items[itemIndex]
    if (card === undefined) continue
    const onPile = { ...card, inBattle: false, hidden: true } as Item
    const without: GameState = {
      ...withPlayer(next, {
        ...owner,
        items: owner.items.filter((item) => item.id !== card.id),
        battlehand: owner.battlehand.filter((item) => item.id !== card.id),
      }),
      discardedItems: [...next.discardedItems, onPile],
    }
    next = appendItemLog(without, 'DISCARD', owner.username, owner.playerId, onPile)
    const logId = next.log.at(-1)?.id ?? ''
    discarded.push({
      cardId: card.id,
      ownerId: owner.playerId,
      logId,
      ...(itemIndex === -1 ? {} : { itemIndex }),
      ...(battlehandIndex === -1 ? {} : { battlehandIndex }),
    })
  }
  return { state: next, discarded }
}

/** Whether End battle discarded this card and it is still on the pile. */
export function killedCardOnPile(state: GameState, record: DiscardedKilledCard): boolean {
  return state.discardedItems.some((item) => item.id === record.cardId)
}

const markLine = (state: GameState, logId: string, superseded: boolean): GameState => ({
  ...state,
  log: state.log.map((entry) => {
    if (entry.id !== logId) return entry
    if (superseded) return { ...entry, undo: null, superseded: true }
    const { superseded: _superseded, ...rest } = entry
    return rest
  }),
})

/**
 * Takes a discarded killed unit's card off the pile and back into its owner's hand, hidden like any card in a hand. Its
 * discard line is superseded. Unchanged when the card is no longer on the pile.
 */
export function returnKilledCard(state: GameState, record: DiscardedKilledCard, inBattle = false): GameState {
  const card = state.discardedItems.find((item) => item.id === record.cardId)
  const owner = findPlayer(state, record.ownerId)
  if (card === undefined || owner === undefined) return state
  const inHand = (isUnit(card) ? { ...card, inBattle, hidden: true } : { ...card, hidden: true }) as Item
  const next = withPlayer(
    { ...state, discardedItems: state.discardedItems.filter((item) => item.id !== card.id) },
    { ...owner, items: [...owner.items, inHand] },
  )
  return markLine(next, record.logId, true)
}

/**
 * The reverse of `returnKilledCard`: the card goes from the owner's hand back onto the pile and its discard line counts
 * again. Unchanged when the card is no longer in the hand.
 */
export function rediscardKilledCard(state: GameState, record: DiscardedKilledCard): GameState {
  const owner = findPlayer(state, record.ownerId)
  const card = owner?.items.find((item) => item.id === record.cardId)
  if (owner === undefined || card === undefined) return state
  // Also out of the battlehand: the player may have drawn a new one holding the card, which would keep it placeable
  const next: GameState = {
    ...withPlayer(state, {
      ...owner,
      items: owner.items.filter((item) => item.id !== card.id),
      battlehand: owner.battlehand.filter((item) => item.id !== card.id),
    }),
    discardedItems: [...state.discardedItems, { ...card, inBattle: false, hidden: true } as Item],
  }
  return markLine(next, record.logId, false)
}

const insertAt = <T>(list: readonly T[], index: number, value: T): readonly T[] => [
  ...list.slice(0, index),
  value,
  ...list.slice(index),
]

/**
 * For the undo of End battle: puts the card back where it stood in its owner's hand and battlehand, locked in the battle.
 * The card comes off the pile (its discard line superseded) or, when it was already returned (saved), is moved back into
 * place. Unchanged when the card is neither on the pile nor in the owner's hand. Undo the records in reverse order, so each
 * position is the one it had.
 */
export function restoreKilledCard(state: GameState, record: DiscardedKilledCard): GameState {
  const owner = findPlayer(state, record.ownerId)
  if (owner === undefined) return state
  const onPile = state.discardedItems.find((item) => item.id === record.cardId)
  const held = owner.items.find((item) => item.id === record.cardId) ?? owner.battlehand.find((item) => item.id === record.cardId)
  const card = onPile ?? held
  if (card === undefined) return state
  const locked = (isUnit(card) ? { ...card, inBattle: true, hidden: true } : { ...card, hidden: true }) as Item
  const items = owner.items.filter((item) => item.id !== card.id)
  const battlehand = owner.battlehand.filter((item) => item.id !== card.id)
  const next = withPlayer(
    onPile === undefined ? state : { ...state, discardedItems: state.discardedItems.filter((item) => item.id !== card.id) },
    {
      ...owner,
      items: record.itemIndex === undefined ? items : insertAt(items, record.itemIndex, locked),
      battlehand:
        record.battlehandIndex === undefined || !isUnit(locked) ? battlehand : insertAt(battlehand, record.battlehandIndex, locked),
    },
  )
  return onPile === undefined ? next : markLine(next, record.logId, true)
}
