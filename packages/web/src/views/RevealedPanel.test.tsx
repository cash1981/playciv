// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { Item, RevealedEntry, RevealedPage } from '../lib/api.js'
import { RevealedPanel, RevealedRow } from './RevealedPanel.js'

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

const feedEntry = (n: number): RevealedEntry => ({
  item: { ...cultureCard, id: `item-${n}`, name: `Item ${n}` },
  playerId: null,
  username: null,
  revealed: true,
  discarded: false,
  createdAt: null,
})

const feed = Array.from({ length: 11 }, (_, i) => feedEntry(i + 1))

describe('RevealedPanel', () => {
  beforeEach(() => localStorage.setItem('civ.panel.revealed', 'true'))
  afterEach(() => {
    cleanup()
    localStorage.removeItem('civ.panel.revealed')
    vi.restoreAllMocks()
  })

  it('shows at most 6 items on first load, then 5 more per "Load more" click', async () => {
    vi.spyOn(api, 'revealed').mockImplementation(async (_gameId, page, size) => {
      expect(page).toBe(1)
      const items: readonly RevealedEntry[] = feed.slice(0, size)
      const result: RevealedPage = { items, total: feed.length, page: 1, size }
      return result
    })

    render(<RevealedPanel gameId="game-1" reloadCount={0} />)

    await waitFor(() => expect(screen.getByText('Item 6')).toBeTruthy())
    expect(screen.queryByText('Item 7')).toBeNull()
    expect(screen.getByText('Showing 6 of 11')).toBeTruthy()

    fireEvent.click(screen.getByText('Load more'))

    await waitFor(() => expect(screen.getByText('Item 11')).toBeTruthy())
    expect(screen.getByText('Showing 11 of 11')).toBeTruthy()
    expect(screen.getByText('Load more')).toHaveProperty('disabled', true)
  })
})
