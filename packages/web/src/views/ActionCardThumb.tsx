/**
 * A small picture of a card, shown beside an action in "Your actions" (#367) so
 * the player sees the card the button belongs to, not only its name. The card's
 * own text sits behind a `?` button in the corner (`help`), not in the row.
 *
 * Only an item the viewer may see is passed in: a tech from the public list or a
 * card from their own hand. The picture comes from `itemImageUrl`, so no path is
 * invented here. A card without art renders nothing, and the row keeps its name.
 */

import { itemName } from '@civ/engine'
import type { Item } from '@civ/engine'

import { HelpHint } from './HelpHint.js'
import { itemImageUrl } from './ItemCard.js'

export function ActionCardThumb({
  item,
  decorative = false,
  help,
}: {
  readonly item: Item | undefined
  /** The row already names the card in text, so a screen reader need not hear the name twice. */
  readonly decorative?: boolean
  /** The card's text, shown behind the `?` button. No button without it. */
  readonly help?: string | undefined
}): React.JSX.Element | null {
  if (item === undefined) return null
  const url = itemImageUrl(item)
  if (url === null) return null
  const name = itemName(item)
  return (
    <span className={`action-card-thumb${item.kind === 'tech' ? ' landscape' : ''}`}>
      <img src={url} alt={decorative ? '' : name} loading="lazy" />
      {help !== undefined && help !== '' && (
        <span className="action-card-help">
          <HelpHint label={name}>{help}</HelpHint>
        </span>
      )}
    </span>
  )
}
