/**
 * Cards that go back in the deck.
 *
 * A discard names the card and its item number in the public log. If the same
 * number came back when the card is drawn again, a later hidden draw or trade
 * line would tell everyone which card it is. So a card that returns to a deck
 * gets a new number. The new number is not the next plain count: a player sees
 * the counter in the number of a policy they choose, and could then predict the
 * number of a card returned for someone else. It is a keyed permutation of the
 * counter instead, in a range of its own that no plain number reaches. This takes
 * nothing from the random source, so shuffles and seeds are unchanged.
 */

import type { Item } from './item.js'
import { keyedHash } from './log.js'
import { SHUFFLABLE_ITEMS } from './sheet-name.js'
import type { GameState } from './state.js'

/** The renumbered cards are numbered from here; the plain count of a game stays far below it. */
const RENUMBERED_FROM = 100_000
const HALF_BITS = 8
const HALF_MASK = (1 << HALF_BITS) - 1

/** A 16-bit Feistel network keyed by the game's secret: a permutation, so two cards never share a number. */
function renumbered(secret: string, counter: number): number {
  const index = counter & ((1 << (2 * HALF_BITS)) - 1)
  let left = index >> HALF_BITS
  let right = index & HALF_MASK
  for (let round = 0; round < 6; round += 1) {
    const mixed = keyedHash(`${secret}|renumber|${round}|${right}`) & HALF_MASK
    ;[left, right] = [right, left ^ mixed]
  }
  return RENUMBERED_FROM + ((left << HALF_BITS) | right)
}

/**
 * The deck with `cards` added, face down and owned by no one, and the counter to go with it. Spread it into the next
 * state: `{ ...next, ...deckWith(state, cards) }`. Only the shuffled decks are renumbered; huts, villages and the
 * rest are never discarded into a deck and keep the number the board shows.
 */
export function deckWith(state: GameState, cards: readonly Item[]): Pick<GameState, 'items' | 'itemCounter'> {
  let counter = state.itemCounter
  const back = cards.map((card): Item => {
    const hidden: Item = { ...card, hidden: true, ownerId: null }
    if (!SHUFFLABLE_ITEMS.has(card.sheetName)) return hidden
    counter += 1
    return { ...hidden, itemNumber: renumbered(state.logSecret, counter) }
  })
  return { items: [...state.items, ...back], itemCounter: counter }
}
