// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_PLAYER_STATS, EMPTY_COIN_SOURCES, GOVERNMENT_CARDS, GOVERNMENTS } from '@civ/engine'
import type { CoinSources } from '@civ/engine'

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
    expect(document.querySelectorAll('.reference-card p')).toHaveLength(expectedEffects.length)
    expect(document.querySelectorAll('.reference-card img')).toHaveLength(GOVERNMENT_CARDS.length)

    for (const card of GOVERNMENT_CARDS) {
      expect(card.effects.length).toBeGreaterThan(0)
      expect(screen.getByRole('heading', { name: card.government, hidden: true })).toBeTruthy()
      expect(
        screen.getByRole('img', { name: `${card.government} government card`, hidden: true })
          .getAttribute('src'),
      ).toBe(`/governments/${card.government.toLowerCase()}.jpg`)
      for (const effect of card.effects) {
        expect(screen.getByText(effect, { selector: '.reference-card p' })).toBeTruthy()
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

describe('StatusPanel player colours', () => {
  it('puts each player colour on their row, so the separator identifies the row when scrolled sideways', () => {
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    // The rows are Alice (Red) and Bob (Blue) in the shared fixture.
    const rows = [...document.querySelectorAll<HTMLTableRowElement>('.status-table tbody tr')]
    expect(rows.map((row) => row.style.getPropertyValue('--player-color'))).toEqual([
      'red',
      'blue',
    ])
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

describe('StatusPanel Coins section', () => {
  /** The shared fixture with some coin counters filled in for Alice. */
  function coinView(coins: Partial<CoinSources>): PlayerView {
    return {
      you: {
        playerId: 'player-me',
        username: 'Alice',
        color: 'Red',
        yourTurn: true,
        civilization: null,
        government: 'Despotism',
        stats: {
          ...DEFAULT_PLAYER_STATS,
          coinSources: { ...EMPTY_COIN_SOURCES, ...coins },
        },
      },
      opponents: memberView.opponents,
    } as unknown as PlayerView
  }

  function openCoins(): void {
    fireEvent.click(screen.getByRole('tab', { name: 'Coins' }))
  }

  it('switches from the status table to one counter per source, with the sheet’s helper text', () => {
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    expect(screen.getByRole('tab', { name: 'Status' })).toBeTruthy()
    expect(screen.queryByText('Code of Laws (I)')).toBeNull()

    openCoins()

    expect(screen.getByText('Code of Laws (I)')).toBeTruthy()
    expect(screen.getByText('Up to 4 for winning battles')).toBeTruthy()
    expect(screen.getByText('Panama Canal')).toBeTruthy()
    expect(screen.getByText('Sheet')).toBeTruthy()
    expect(screen.getByText('Coins from culture cards, loot or village etc.')).toBeTruthy()
  })

  it('increases a counter through the shared runner', async () => {
    const setCoin = vi.spyOn(api, 'setPlayerCoin').mockResolvedValue(memberView)
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    openCoins()
    fireEvent.click(screen.getByRole('button', { name: 'Increase Bob Bank (Building)' }))

    await waitFor(() =>
      expect(setCoin).toHaveBeenCalledWith('game-1', 'player-them', 'bank', 1),
    )
  })

  it('disables + at the printed limit and − at zero, and leaves the two unlimited sources open', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({ codeOfLaws: 4 })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    openCoins()

    const increase = (name: string): HTMLButtonElement =>
      screen.getByRole('button', { name }) as HTMLButtonElement
    expect(increase('Increase Alice Code of Laws (I)').disabled).toBe(true)
    expect(increase('Decrease Alice Code of Laws (I)').disabled).toBe(false)
    expect(increase('Decrease Alice Sheet').disabled).toBe(true)
    expect(increase('Increase Alice Sheet').disabled).toBe(false)
    expect(increase('Increase Alice Panama Canal').disabled).toBe(false)
  })

  it('shows the summed total in the status table, read-only', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({ codeOfLaws: 4, sheet: 3 })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    expect(screen.getByLabelText('Alice Coins').textContent).toBe('7')
    expect(screen.queryByRole('textbox', { name: 'Alice Coins' })).toBeNull()
  })

  it('keeps every counter disabled for a spectator or replay', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({ codeOfLaws: 2 })}
        busy={false}
        readOnly={true}
        run={run}
      />,
    )

    openCoins()
    const counters = screen.getAllByRole('button', { name: /^(Increase|Decrease) / })
    expect(counters.length).toBeGreaterThan(0)
    expect(counters.every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })
})
