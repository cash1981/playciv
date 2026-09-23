// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBoard, wondersArea } from '@civ/engine'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'
import { WondersPanel } from './WondersPanel.js'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const board = createBoard(16, 8)
const area = wondersArea(board)
const view = {
  you: { playerId: 'alice', username: 'Alice' },
  opponents: [{ playerId: 'bob', username: 'Bob' }],
  boardAreas: [area],
  board: { ...board, pieces: [
    { id: 'internet', assetId: 'wonders/internet', label: 'The Internet', path: 'wonders/internet.png', category: 'wonder', x: area.x + 20, y: area.y + 40, width: 88, height: 90, ownerId: null },
    { id: 'unit', assetId: 'figures/redarmy', label: 'Red army', category: 'figure', x: area.x + 20, y: area.y + 40, width: 80, height: 80 },
  ] },
} as unknown as PlayerView

const run: Run = async (action) => { await action() }

describe('WondersPanel', () => {
  it('lists wonders in play, identifies owners, and persists an owner assignment', async () => {
    const setOwner = vi.spyOn(api, 'setWonderOwner').mockResolvedValue(view)
    render(<WondersPanel gameId="g" view={view} busy={false} readOnly={false} run={run} />)
    expect(screen.getByText('The Internet')).toBeTruthy()
    expect(screen.queryByText('Red army')).toBeNull()
    const owner = screen.getByRole('combobox', { name: 'The Internet owner' }) as HTMLSelectElement
    expect(owner.value).toBe('')
    expect(owner.querySelectorAll('option')).toHaveLength(3)
    fireEvent.change(owner, { target: { value: 'bob' } })
    await waitFor(() => expect(setOwner).toHaveBeenCalledWith('g', 'internet', 'bob'))
  })

  it('shows an empty state when no wonders are in play', () => {
    render(<WondersPanel gameId="g" view={({ ...view, board: { ...view.board, pieces: [] } } as PlayerView)} busy={false} readOnly={false} run={run} />)
    expect(screen.getByText('No wonders in play.')).toBeTruthy()
  })

  it('keeps owner controls disabled in a read-only view', () => {
    render(<WondersPanel gameId="g" view={view} busy={false} readOnly={true} run={run} />)
    expect((screen.getByRole('combobox', { name: 'The Internet owner' }) as HTMLSelectElement).disabled).toBe(true)
  })
})
