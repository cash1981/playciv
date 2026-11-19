/**
 * A small picture of a card, shown beside an action in "Your actions" (#367) so
 * the player sees the card the button belongs to, not only its name.
 *
 * Only an item the viewer may see is passed in: a tech from the public list or a
 * card from their own hand. The picture comes from `itemImageUrl`, so no path is
 * invented here. A card without art renders nothing, and the row keeps its name.
 */

import { itemName } from '@civ/engine'
import type { Item } from '@civ/engine'

import { itemImageUrl } from './ItemCard.js'

export function ActionCardThumb({
  item,
  decorative = false,
}: {
  readonly item: Item | undefined
  /** The row already names the card in text, so a screen reader need not hear the name twice. */
  readonly decorative?: boolean
}): React.JSX.Element | null {
  if (item === undefined) return null
  const url = itemImageUrl(item)
  if (url === null) return null
  return (
    <span className="action-card-thumb">
      <img src={url} alt={decorative ? '' : itemName(item)} loading="lazy" />
    </span>
  )
}
