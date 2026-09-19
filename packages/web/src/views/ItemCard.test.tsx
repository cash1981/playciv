import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Item } from '../lib/api.js'
import { ItemCard, itemImageUrl } from './ItemCard.js'

const artillery: Item = {
  kind: 'artillery',
  sheetName: 'ARTILLERY',
  id: 'unit-1',
  itemNumber: 43,
  description: null,
  used: false,
  hidden: false,
  ownerId: 'player-cash1981',
  attack: 1,
  health: 3,
  level: 0,
  killed: false,
  inBattle: false,
}

describe('ItemCard', () => {
  it('looks up the image from the item passed in, not from labelOverride', () => {
    // itemImage() builds the filename from the item's own attack/health
    // (e.g. "Artillery1.3.png"). A caller showing a different live value —
    // an arena unit's current stats, edited away from the card's own — must
    // not be able to point the lookup at a file that does not exist by
    // passing a labelOverride (issue #71 follow-up: this broke the art).
    const markup = renderToStaticMarkup(
      <ItemCard item={artillery} labelOverride="Artillery 9.9" />,
    )
    const url = itemImageUrl(artillery)
    expect(url).not.toBeNull()
    expect(markup).toContain(url ?? '')
    expect(markup).not.toContain('Artillery9.9')
    expect(markup).toContain('Artillery 9.9')
  })

  it('falls back to the computed label when no override is given', () => {
    const markup = renderToStaticMarkup(<ItemCard item={artillery} />)
    expect(markup).toContain('Artillery 1.3')
  })
})
