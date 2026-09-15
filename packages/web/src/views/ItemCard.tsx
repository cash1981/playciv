/**
 * An item shown as its card, the way the AngularJS app did it.
 *
 * The file name comes from `itemImage()` in the engine, which is a port of the
 * Java `Image` implementations, so the client never invents a path. The one
 * card with no artwork is Space Flight, which is added in code rather than read
 * from the spreadsheet; that falls back to the name in a frame.
 *
 * Showing the picture is a private matter. Your own hand renders in the clear
 * because it is yours; an opponent's hand never reaches the client at all, and
 * the revealed panel only ever gets what its owner has published.
 */

import { itemImage, itemName, revealAll } from '@civ/engine'
import type { Item } from '@civ/engine'

/** File names may contain spaces and apostrophes, for example "Leonardo's Workshop". */
export function itemImageUrl(item: Item): string | null {
  const file = itemImage(item)
  return file === null ? null : `/items/${encodeURIComponent(file)}`
}

export function ItemCard({
  item,
  /** What the viewer is allowed to read: the whole card, or only its public face. */
  reveal = 'all',
  children,
}: {
  readonly item: Item
  readonly reveal?: 'all' | 'public'
  readonly children?: React.ReactNode
}): React.JSX.Element {
  const label = reveal === 'all' ? revealAll(item) : itemName(item)
  const url = itemImageUrl(item)

  return (
    <li className="card">
      <div className="card-art">
        {url === null ? (
          <span className="card-art-fallback">{label}</span>
        ) : (
          <img
            src={url}
            alt={label}
            onError={(event) => {
              // A missing file should leave the name readable, not a broken icon
              event.currentTarget.style.display = 'none'
            }}
          />
        )}
      </div>

      <div className="card-caption">
        <strong>{label}</strong>
        <span className="muted">
          {item.sheetName} · #{item.itemNumber}
        </span>
        {item.description !== null && item.description !== '' && (
          <span className="card-text">{item.description}</span>
        )}
      </div>

      {children !== undefined && <div className="card-actions">{children}</div>}
    </li>
  )
}
