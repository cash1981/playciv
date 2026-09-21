// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PLAYER_STATS, GOVERNMENT_CARDS, GOVERNMENTS } from '@civ/engine'

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
  it('shows every government in each dropdown and every reference card with all effects', () => {
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    const alice = screen.getByRole('combobox', { name: 'Alice government' })
    expect((alice as HTMLSelectElement).value).toBe('Despotism')
    expect(alice.querySelectorAll('option')).toHaveLength(GOVERNMENTS.length)
    fireEvent.click(screen.getAllByRole('button', { name: 'Show government card reference' })[0]!)
    const expectedEffects = GOVERNMENT_CARDS.flatMap((card) => card.effects)
    expect(document.querySelectorAll('.government-card p')).toHaveLength(expectedEffects.length)
    expect(document.querySelectorAll('.government-card img')).toHaveLength(GOVERNMENT_CARDS.length)

    for (const card of GOVERNMENT_CARDS) {
      expect(card.effects.length).toBeGreaterThan(0)
      expect(screen.getByRole('heading', { name: card.government, hidden: true })).toBeTruthy()
      expect(
        screen.getByRole('img', { name: `${card.government} government card`, hidden: true })
          .getAttribute('src'),
      ).toBe(`/governments/${card.government.toLowerCase()}.jpg`)
      for (const effect of card.effects) {
        expect(screen.getByText(effect, { selector: '.government-card p' })).toBeTruthy()
      }
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

describe('StatusPanel Movement (issue #102)', () => {
  it('saves a Movement expression as text', async () => {
    const setStat = vi.spyOn(api, 'setPlayerStat').mockResolvedValue(memberView)
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    const movement = screen.getByRole('textbox', { name: 'Alice Movement' })
    fireEvent.change(movement, { target: { value: '3+1' } })
    fireEvent.blur(movement)

    await waitFor(() =>
      expect(setStat).toHaveBeenCalledWith('game-1', 'player-me', 'mvmt', '3+1'),
    )
    // The cell keeps showing the expression it was given, not a reverted value.
    expect((movement as HTMLInputElement).value).toBe('3+1')
  })

  it('reverts an invalid Movement value without saving', () => {
    const setStat = vi.spyOn(api, 'setPlayerStat').mockResolvedValue(memberView)
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    const movement = screen.getByRole('textbox', { name: 'Alice Movement' }) as HTMLInputElement
    fireEvent.change(movement, { target: { value: '3+' } })
    fireEvent.blur(movement)

    expect(setStat).not.toHaveBeenCalled()
    expect(movement.value).toBe('2')
  })
})
