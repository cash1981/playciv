/**
 * An item shown as its card, the way the AngularJS app did it.
 *
 * The file name comes from `itemImage()` in the engine, which is a port of the
 * Java `Image` implementations, so the client never invents a path. Space
 * Flight is the level 5 tech added in code rather than read from the
 * spreadsheet, but it does have card art, copied separately by
 * `tools/tech-assets.ps1`.
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
  draggable,
  onClick,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  role,
  tabIndex,
  className,
  onDragStart,
  onDragEnd,
  /**
   * Visual rotation in degrees — the physical card prints one unit level per
   * edge. A plain number rather than the engine's `Rotation` union, since a
   * caller may add a base orientation on top of the stored value (e.g. an
   * arena side facing its opponent) and the sum need not be one of the four
   * named angles by construction, only by arithmetic.
   */
  rotation,
  /**
   * Shown instead of the computed label (the caption text, and the fallback
   * shown in place of missing art), without changing which image is looked
   * up or its `alt` text. The printed art is tied to `item`'s own attack/
   * health (`itemImage` builds the filename from them), so a caller that
   * wants to show a different current value — an arena unit's live stats,
   * edited away from the card's own — must not also pass a mutated `item`:
   * that would point the image lookup at a file that does not exist. This
   * also bypasses the `reveal === 'public'` gate, so only ever pass text
   * that is already safe to show in full — arena stats are, since arena
   * units are fully public once placed.
   */
  labelOverride,
  children,
}: {
  readonly item: Item
  readonly reveal?: 'all' | 'public'
  readonly draggable?: boolean
  readonly onClick?: React.MouseEventHandler<HTMLLIElement>
  readonly onKeyDown?: React.KeyboardEventHandler<HTMLLIElement>
  readonly onPointerDown?: React.PointerEventHandler<HTMLLIElement>
  readonly onPointerMove?: React.PointerEventHandler<HTMLLIElement>
  readonly onPointerUp?: React.PointerEventHandler<HTMLLIElement>
  readonly onPointerCancel?: React.PointerEventHandler<HTMLLIElement>
  readonly role?: React.AriaRole
  readonly tabIndex?: number
  readonly className?: string
  readonly onDragStart?: (e: React.DragEvent<HTMLLIElement>) => void
  readonly onDragEnd?: (e: React.DragEvent<HTMLLIElement>) => void
  readonly rotation?: number
  readonly labelOverride?: string
  readonly children?: React.ReactNode
}): React.JSX.Element {
  // The image's own description — kept separate from `label` so a caller
  // overriding the caption (a live stat value, say) cannot also change what
  // the alt text claims is pictured, since the art itself never changes.
  const imageLabel = reveal === 'all' ? revealAll(item) : itemName(item)
  const label = labelOverride ?? imageLabel
  const url = itemImageUrl(item)
  const imageStyle = rotation ? { transform: `rotate(${rotation}deg)` } : undefined

  return (
    <li
      className={`card${className === undefined ? '' : ` ${className}`}`}
      draggable={draggable}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      role={role}
      tabIndex={tabIndex}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="card-art">
        {url === null ? (
          <span className="card-art-fallback" style={imageStyle}>{label}</span>
        ) : (
          <img
            src={url}
            alt={imageLabel}
            style={imageStyle}
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
