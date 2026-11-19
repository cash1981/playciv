/**
 * Cards that go back in the deck.
 *
 * A discard names the card and its item number in the public log. If the same
 * number came back when the card is drawn again, a later hidden draw or trade
 * line would tell everyone which card it is. So a card that returns to a deck
 * gets a new number from `itemCounter`. This takes nothing from the random
 * source, so shuffles and seeds are unchanged.
 */

import type { Item } from './item.js'
import { SHUFFLABLE_ITEMS } from './sheet-name.js'
import type { GameState } from './state.js'

/**
 * The deck with `cards` added, face down and owned by no one, and the counter to go with it. Spread it into the next
 * state: `{ ...next, ...deckWith(state, cards) }`. Only the shuffled decks are renumbered; huts, villages and the
 * rest are never discarded into a deck and keep the number the board shows.
 */
export function deckWith(
  state: GameState,
  cards: readonly Item[],
): Pick<GameState, 'items' | 'itemCounter' | 'previousItemNumbers'> {
  let counter = state.itemCounter
  const previous: Record<string, number> = { ...state.previousItemNumbers }
  const back = cards.map((card): Item => {
    const hidden: Item = { ...card, hidden: true, ownerId: null }
    if (!SHUFFLABLE_ITEMS.has(card.sheetName)) return hidden
    counter += 1
    previous[card.id] = card.itemNumber
    return { ...hidden, itemNumber: counter }
  })
  return { items: [...state.items, ...back], itemCounter: counter, previousItemNumbers: previous }
}
