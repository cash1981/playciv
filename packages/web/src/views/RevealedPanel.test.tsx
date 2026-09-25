// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { GameRevisionView, Item, RevealedEntry, RevealedPage } from '../lib/api.js'
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

const feed = (length: number): RevealedEntry[] => Array.from({ length }, (_, i) => feedEntry(i + 1))

/** Mirrors the real route's clamp: `size` in the response is what the server
 *  actually used, capped at `cap`, independent of how many items exist. */
const serverRevealed =
  (allItems: readonly RevealedEntry[], cap = 100) =>
  async (_gameId: string, page: number, size: number): Promise<RevealedPage> => {
    const used = Math.min(size, cap)
    const start = (page - 1) * used
    return { items: allItems.slice(start, start + used), total: allItems.length, page, size: used }
  }

describe('RevealedPanel', () => {
  beforeEach(() => localStorage.setItem('civ.panel.revealed', 'true'))
  afterEach(() => {
    cleanup()
    localStorage.removeItem('civ.panel.revealed')
    vi.restoreAllMocks()
  })

  it('shows at most 6 items on first load, then exactly 5 more per "Load more" click', async () => {
    const revealed = vi.spyOn(api, 'revealed').mockImplementation(serverRevealed(feed(20)))

    render(<RevealedPanel gameId="game-1" reloadCount={0} />)

    await waitFor(() => expect(screen.getByText('Item 6')).toBeTruthy())
    expect(screen.queryByText('Item 7')).toBeNull()
    expect(screen.getByText('Showing 6 of 20')).toBeTruthy()
    expect(revealed).toHaveBeenNthCalledWith(1, 'game-1', 1, 6)

    fireEvent.click(screen.getByText('Load more'))

    await waitFor(() => expect(screen.getByText('Item 11')).toBeTruthy())
    expect(screen.queryByText('Item 12')).toBeNull()
    expect(screen.getByText('Showing 11 of 20')).toBeTruthy()
    expect(revealed).toHaveBeenNthCalledWith(2, 'game-1', 1, 11)
    expect(screen.getByText('Load more')).toHaveProperty('disabled', false)

    fireEvent.click(screen.getByText('Load more'))

    await waitFor(() => expect(screen.getByText('Item 16')).toBeTruthy())
    expect(screen.getByText('Showing 16 of 20')).toBeTruthy()
  })

  it('stops offering "Load more" once the server-side cap is hit, instead of looping forever', async () => {
    vi.spyOn(api, 'revealed').mockImplementation(serverRevealed(feed(105), 100))

    render(<RevealedPanel gameId="game-1" reloadCount={0} />)
    await waitFor(() => expect(screen.getByText('Item 6')).toBeTruthy())

    // 19 clicks: 6 + 19*5 = 101, past the 100 cap.
    let visibleSize = 6
    for (let click = 0; click < 19; click++) {
      const button = screen.getByText('Load more') as HTMLButtonElement
      if (button.disabled) break
      fireEvent.click(button)
      visibleSize += 5
      const expectedShown = Math.min(visibleSize, 100)
      await waitFor(() => expect(screen.getByText(`Showing ${expectedShown} of 105`)).toBeTruthy())
    }

    expect(screen.getByText('Showing 100 of 105')).toBeTruthy()
    expect(screen.getByText('Load more')).toHaveProperty('disabled', true)
  })

  it('paginates the historical (replay) feed client-side the same way', async () => {
    const historical = { revealed: feed(20) } as unknown as GameRevisionView

    render(<RevealedPanel gameId="game-1" reloadCount={0} historical={historical} />)

    await waitFor(() => expect(screen.getByText('Item 6')).toBeTruthy())
    expect(screen.queryByText('Item 7')).toBeNull()
    expect(screen.getByText('Showing 6 of 20')).toBeTruthy()

    fireEvent.click(screen.getByText('Load more'))

    await waitFor(() => expect(screen.getByText('Item 11')).toBeTruthy())
    expect(screen.getByText('Showing 11 of 20')).toBeTruthy()
  })
})
