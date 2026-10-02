// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBoard, wondersArea } from '@civ/engine'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'
import { WondersPanel } from './WondersPanel.js'

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

const board = createBoard(16, 8)
const area = wondersArea(board)
const internetPiece = {
  id: 'internet', assetId: 'wonders/internet', label: 'The Internet', path: 'wonders/internet.png',
  category: 'wonder', x: area.x + 20, y: area.y + 40, width: 88, height: 90, ownerId: null,
}
const redArmyPiece = {
  id: 'unit', assetId: 'figures/redarmy', label: 'Red army', category: 'figure',
  x: area.x + 20, y: area.y + 40, width: 80, height: 80,
}
const view = {
  you: { playerId: 'alice', username: 'Alice' },
  opponents: [{ playerId: 'bob', username: 'Bob' }],
  boardAreas: [area],
  board: { ...board, pieces: [internetPiece, redArmyPiece] },
} as unknown as PlayerView

const run: Run = async (action) => { await action() }

describe('WondersPanel', () => {
  it('lists wonders in play, identifies owners, and persists an owner assignment', async () => {
    const setOwner = vi.spyOn(api, 'setWonderOwner').mockResolvedValue(view)
    render(<WondersPanel gameId="g" view={view} busy={false} readOnly={false} run={run} />)
    const toggle = screen.getByRole('button', { name: 'Wonders in play (1)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByText('The Internet')).toBeTruthy()
    expect(
      screen.getByText('The maximum number of coins you can add to each of your techs is increased by 2.'),
    ).toBeTruthy()
    expect(screen.queryByText('Red army')).toBeNull()
    const owner = screen.getByRole('combobox', { name: 'The Internet owner' }) as HTMLSelectElement
    expect(owner.value).toBe('')
    expect(owner.querySelectorAll('option')).toHaveLength(3)
    fireEvent.change(owner, { target: { value: 'bob' } })
    await waitFor(() => expect(setOwner).toHaveBeenCalledWith('g', 'internet', 'bob'))
  })

  it('sorts wonders by level, then alphabetically within a level', () => {
    const wonder = (id: string, label: string) => ({ ...internetPiece, id, label })
    const sorted = {
      ...view,
      board: {
        ...view.board,
        // Modern, Ancient (T), Medieval, Ancient (H): the order a board can end up in
        pieces: [
          wonder('i', 'The Internet'),
          wonder('p', 'The Pyramids'),
          wonder('m', "Leonardo's Workshop"),
          wonder('h', 'The Hanging Gardens'),
        ],
      },
    } as unknown as PlayerView
    render(<WondersPanel gameId="g" view={sorted} busy={false} readOnly={false} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: /Wonders in play/ }))
    const names = screen.getAllByRole('combobox').map((el) => el.getAttribute('aria-label'))
    expect(names).toEqual([
      'The Hanging Gardens owner',
      'The Pyramids owner',
      "Leonardo's Workshop owner",
      'The Internet owner',
    ])
  })

  it('shows an empty state when no wonders are in play', () => {
    render(<WondersPanel gameId="g" view={({ ...view, board: { ...view.board, pieces: [] } } as PlayerView)} busy={false} readOnly={false} run={run} />)
    expect(screen.getByText('No wonders in play.')).toBeTruthy()
  })

  it('keeps owner controls disabled in a read-only view', () => {
    render(<WondersPanel gameId="g" view={view} busy={false} readOnly={true} run={run} />)
    expect((screen.getByRole('combobox', { name: 'The Internet owner', hidden: true }) as HTMLSelectElement).disabled).toBe(true)
  })

  it('keeps listing a wonder moved out of the Wonders area, onto the map (issue #191)', () => {
    // Left of the area's x and above its y (area sits at the board's own
    // right edge, below the map rows), so this is comfortably outside
    // `isInWondersArea`'s bounds rather than an accident of arithmetic.
    const movedView = {
      ...view,
      board: { ...view.board, pieces: [{ ...internetPiece, x: 0, y: 0 }, redArmyPiece] },
    } as unknown as PlayerView
    render(<WondersPanel gameId="g" view={movedView} busy={false} readOnly={false} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Wonders in play (1)' }))
    expect(screen.getByText('The Internet')).toBeTruthy()
  })

  it('removes a wonder from the panel via its own Remove button (issue #191)', async () => {
    const removePiece = vi.spyOn(api, 'removePiece').mockResolvedValue(view)
    render(<WondersPanel gameId="g" view={view} busy={false} readOnly={false} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Wonders in play (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove The Internet' }))
    await waitFor(() => expect(removePiece).toHaveBeenCalledWith('g', 'internet'))
  })

  it('disables the Remove button in a read-only view', () => {
    render(<WondersPanel gameId="g" view={view} busy={false} readOnly={true} run={run} />)
    expect(
      (screen.getByRole('button', { name: 'Remove The Internet', hidden: true }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
