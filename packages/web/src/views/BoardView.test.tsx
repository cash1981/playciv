// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createBoard, findBoardAsset } from '@civ/engine'
import type { BoardPiece, PlayerView } from '@civ/engine'

import type { GameRevisionView } from '../lib/api.js'
import { api } from '../lib/api.js'

import { BoardPalette, BoardView } from './BoardView.js'
import {
  GlobalReplayBar,
  loadConsistentLive,
  loadHistoricalIfCurrent,
  refreshBeforeLive,
} from './GameView.js'

const piece = (assetId: string, id: string): BoardPiece => ({
  id,
  assetId,
  path: 'buildings/academy.png',
  label: 'Academy',
  category: 'building',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  rotation: 0,
  placedBy: null,
})

describe('global replay controls', () => {
  const revisions = [
    {
      gameId: 'game',
      revision: 0,
      createdAt: '2026-09-19T10:00:00.000Z',
      actor: { playerId: 'one', username: 'Alice' },
      publicDescription: 'Game created',
      privateDescription: null,
      logIds: [],
    },
    {
      gameId: 'game',
      revision: 1,
      createdAt: '2026-09-19T10:01:00.000Z',
      actor: { playerId: 'two', username: 'Bob' },
      publicDescription: 'Bob joined',
      privateDescription: null,
      logIds: ['log-1'],
    },
  ] as const

  it('shows one global Back, Forward and Live timeline', () => {
    const markup = renderToStaticMarkup(
      <GlobalReplayBar
        revisions={revisions}
        selectedRevision={0}
        busy={false}
        onRevision={() => undefined}
        onLive={() => undefined}
      />,
    )
    expect(markup).toContain('Forward')
    expect(markup).toContain('Live')
    expect(markup).toContain('Revision 0')
    expect(markup).toContain('Newer revisions available')
    expect(markup).toContain('Game created')
  })

  it('refreshes the live cache before leaving a historical revision', async () => {
    const events: string[] = []
    await refreshBeforeLive(
      async () => {
        events.push('reload')
        return true
      },
      () => events.push('live'),
    )
    expect(events).toEqual(['reload', 'live'])

    await refreshBeforeLive(async () => false, () => events.push('must not leave replay'))
    expect(events).toEqual(['reload', 'live'])
  })

  it('reads revisions before the live game and retries a torn snapshot', async () => {
    const events: string[] = []
    let viewRevision = 3
    const loaded = await loadConsistentLive(
      async () => {
        events.push('revisions')
        return [{ ...revisions[1], revision: 4 }]
      },
      async () => {
        events.push(`game-${viewRevision}`)
        const view = { rev: viewRevision } as PlayerView
        viewRevision = 4
        return view
      },
    )

    expect(events).toEqual(['revisions', 'game-3', 'revisions', 'game-4'])
    expect(loaded.view.rev).toBe(4)
    expect(loaded.revisions.at(-1)?.revision).toBe(4)
  })

  it('discards a historical response after navigation changes the active game', async () => {
    let active = true
    const pending = loadHistoricalIfCurrent(
      async () => {
        active = false
        return { revision: 1 } as GameRevisionView
      },
      () => active,
    )
    await expect(pending).resolves.toBeNull()
  })
})

describe('BoardPalette finite supplies', () => {
  it('calls the tap selection callback for an available asset', () => {
    const hut = findBoardAsset('resources/hut')
    if (hut === undefined) throw new Error('hut missing from manifest')
    let selected: string | null = null

    render(
      <BoardPalette
        assets={[hut]}
        category="resource"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={[]}
        numOfPlayers={2}
        onSelectAsset={(asset) => { selected = asset.id }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /hut/i }))
    expect(selected).toBe('resources/hut')
    cleanup()
  })

  it('shows the remaining count and disables an exhausted building family', () => {
    const academy = findBoardAsset('buildings/academy')
    if (academy === undefined) throw new Error('academy missing from manifest')

    const exhausted = renderToStaticMarkup(
      <BoardPalette
        assets={[academy]}
        category="building"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={Array.from({ length: 5 }, (_, index) => piece('buildings/barracks', String(index)))}
        numOfPlayers={4}
      />,
    )
    expect(exhausted).toContain('Academy (0)')
    expect(exhausted).toContain('type="button"')
    expect(exhausted).toContain('draggable="false"')

    const restored = renderToStaticMarkup(
      <BoardPalette
        assets={[academy]}
        category="building"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={Array.from({ length: 4 }, (_, index) => piece('buildings/barracks', String(index)))}
        numOfPlayers={4}
      />,
    )
    expect(restored).toContain('Academy (1)')
    expect(restored).toContain('draggable="true"')
  })

  it('shows no count and keeps a hut draggable at the cap (issue #116)', () => {
    const hut = findBoardAsset('resources/hut')
    if (hut === undefined) throw new Error('hut missing from manifest')

    // Two huts in a two-player game is exactly where a capped resource would be
    // exhausted; a hut must stay unlimited, so it must not show "(0)".
    const huts: readonly BoardPiece[] = [0, 1].map((index) => ({
      ...piece('resources/hut', String(index)),
      category: 'resource',
    }))

    const markup = renderToStaticMarkup(
      <BoardPalette
        assets={[hut]}
        category="resource"
        onCategoryChange={() => undefined}
        replaying={false}
        pieces={huts}
        numOfPlayers={2}
      />,
    )
    expect(markup).toContain('Hut')
    expect(markup).not.toContain('Hut (')
    expect(markup).toContain('draggable="true"')
    expect(markup).not.toContain('unavailable')
  })
})

describe('BoardView mobile placement', () => {
  it('shows a pending placement status after tapping a palette asset', async () => {
    const hut = findBoardAsset('resources/hut')
    if (hut === undefined) throw new Error('hut missing from manifest')
    const assets = vi.spyOn(api, 'boardAssets').mockResolvedValue([hut])

    render(
      <BoardView
        gameId="game"
        board={createBoard()}
        numOfPlayers={2}
        areas={[]}
        busy={false}
        run={async () => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resources' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /hut/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /hut/i }))
    expect(screen.getByRole('status').textContent).toContain('Placing Hut')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    assets.mockRestore()
    cleanup()
  })
})
