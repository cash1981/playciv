// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PLAYER_STATS, GOVERNMENTS } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'
import { StatusPanel } from './StatusPanel.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const memberView = {
  you: {
    playerId: 'player-me',
    username: 'Alice',
    color: 'Red',
    yourTurn: true,
    civilization: null,
    government: 'Despotism',
    stats: DEFAULT_PLAYER_STATS,
  },
  opponents: [
    {
      playerId: 'player-them',
      username: 'Bob',
      color: 'Blue',
      yourTurn: false,
      civilization: null,
      government: 'Republic',
      stats: DEFAULT_PLAYER_STATS,
    },
  ],
} as unknown as PlayerView

const run: Run = async (action) => {
  await action()
}

describe('StatusPanel governments', () => {
  it('shows every government in each dropdown and every reference card', () => {
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    const alice = screen.getByRole('combobox', { name: 'Alice government' })
    expect((alice as HTMLSelectElement).value).toBe('Despotism')
    expect(alice.querySelectorAll('option')).toHaveLength(GOVERNMENTS.length)
    for (const government of GOVERNMENTS) {
      expect(screen.getByRole('heading', { name: government, hidden: true })).toBeTruthy()
    }
  })

  it('saves a selected government through the shared runner', async () => {
    const setGovernment = vi
      .spyOn(api, 'setPlayerGovernment')
      .mockResolvedValue(memberView)
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Bob government' }), {
      target: { value: 'Monarchy' },
    })

    await waitFor(() =>
      expect(setGovernment).toHaveBeenCalledWith('game-1', 'player-them', 'Monarchy'),
    )
  })

  it('keeps government and numeric bookkeeping read-only for spectators or replay', () => {
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={true} run={run} />,
    )

    expect(
      screen.getAllByRole('combobox').every((input) => (input as HTMLSelectElement).disabled),
    ).toBe(true)
    expect(
      screen.getAllByRole('textbox').every((input) => (input as HTMLInputElement).disabled),
    ).toBe(true)
  })
})
