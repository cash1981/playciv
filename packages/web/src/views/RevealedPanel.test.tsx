import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Item, RevealedEntry } from '../lib/api.js'
import { RevealedRow } from './RevealedPanel.js'

const cultureCard: Item = {
  kind: 'cultureI',
  sheetName: 'CULTURE_1',
  id: 'item-1',
  itemNumber: 42,
  name: 'Philosophy',
  type: null,
  description: 'A one-time boost.',
  used: false,
  hidden: false,
  ownerId: 'player-cash1981',
}

describe('RevealedRow', () => {
  it('shows the card, the revealing player and both statuses', () => {
    const entry: RevealedEntry = {
      item: cultureCard,
      playerId: 'player-cash1981',
      username: 'cash1981',
      revealed: true,
      discarded: true,
      createdAt: '2026-01-01T10:00:00.000Z',
    }

    const markup = renderToStaticMarkup(<RevealedRow entry={entry} />)
    expect(markup).toContain('Philosophy')
    expect(markup).toContain('A one-time boost.')
    expect(markup).toContain('by cash1981')
    expect(markup).toContain('revealed')
    expect(markup).toContain('discarded')
    // The image is lazy so a full page of them does not load at once.
    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('/items/')
  })

  it('omits the discarded tag for a revealed-but-kept item with an unknown player', () => {
    const entry: RevealedEntry = {
      item: cultureCard,
      playerId: null,
      username: null,
      revealed: true,
      discarded: false,
      createdAt: null,
    }

    const markup = renderToStaticMarkup(<RevealedRow entry={entry} />)
    expect(markup).toContain('revealed')
    expect(markup).not.toContain('discarded')
    expect(markup).not.toContain('by ')
  })
})
