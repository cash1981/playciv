// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBoard, DEFAULT_PLAYER_STATS, EMPTY_COIN_SOURCES, GOVERNMENT_CARDS, GOVERNMENTS, wondersArea } from '@civ/engine'
import type { CoinSources, Government } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { Run } from './GameView.js'
import { StatusPanel } from './StatusPanel.js'

beforeEach(() => localStorage.setItem('civ.panel.status', 'true'))
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.status')
  vi.restoreAllMocks()
})

const memberView = {
  board: { pieces: [] },
  you: {
    playerId: 'player-me',
    username: 'Alice',
    color: 'Red',
    yourTurn: true,
    civilization: null,
    government: 'Despotism',
    stats: DEFAULT_PLAYER_STATS,
    techsChosen: [],
    socialPolicies: [],
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
      revealedTechs: [],
      revealedSocialPolicies: [],
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
  /**
   * The shared fixture with counters filled in for Alice, plus the optional
   * public cards and board state that make a conditional source available.
   */
  function coinView(
    coins: Partial<CoinSources> = {},
    options: {
      readonly techs?: readonly string[]
      readonly policies?: readonly string[]
      readonly government?: Government
      readonly panamaOwner?: string
      readonly panamaOutsideWondersArea?: boolean
    } = {},
  ): PlayerView {
    const board = createBoard(16, 8)
    const area = wondersArea(board)
    const pieces =
      options.panamaOwner === undefined
        ? []
        : [
            {
              id: 'panama-canal',
              assetId: 'wonders/panamacanal',
              ownerId: options.panamaOwner,
              category: 'wonder' as const,
              x: options.panamaOutsideWondersArea === true ? 300 : area.x + 20,
              y: options.panamaOutsideWondersArea === true ? 300 : area.y + 40,
              width: 86,
              height: 85,
            },
          ]
    return {
      board: { ...board, pieces },
      you: {
        playerId: 'player-me',
        username: 'Alice',
        color: 'Red',
        yourTurn: true,
        civilization: null,
        government: options.government ?? 'Despotism',
        stats: {
          ...DEFAULT_PLAYER_STATS,
          coinSources: { ...EMPTY_COIN_SOURCES, ...coins },
        },
        techsChosen: (options.techs ?? []).map((name) => ({ name, hidden: false })),
        socialPolicies: (options.policies ?? []).map((name) => ({ name, hidden: false })),
      },
      opponents: memberView.opponents,
    } as unknown as PlayerView
  }

  function openCoins(): void {
    fireEvent.click(screen.getByRole('tab', { name: 'Coins' }))
  }

  it('switches from the status table to the sources a player has, with the sheet’s helper text', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({}, { techs: ['Code of Laws'], panamaOwner: 'player-me' })}
        busy={false}
        readOnly={false}
        run={run}
      />,
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

  it('leaves out every source nobody has', () => {
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    openCoins()

    // Bank, Great People, Terrain and Sheet are the always-available rows.
    expect(screen.getByText('Bank (Building)')).toBeTruthy()
    expect(screen.getByText('Great People')).toBeTruthy()
    expect(screen.getByText('Terrain')).toBeTruthy()
    expect(screen.getByText('Sheet')).toBeTruthy()
    for (const absent of [
      'Code of Laws (I)',
      'Pottery (I)',
      'Civil Service (II)',
      'Democracy (II)',
      'Printing Press (II)',
      'Bureaucracy (II)',
      'Railroad (III)',
      'Computers (IV)',
      'Democracy (Govt)',
      'Panama Canal',
      'Organized Religion',
    ]) {
      expect(screen.queryByText(absent)).toBeNull()
    }
  })

  it('offers a tech row in the column of the player who revealed it only', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({}, { techs: ['Pottery'] })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    openCoins()

    expect(screen.getByRole('button', { name: 'Increase Alice Pottery (I)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Increase Bob Pottery (I)' })).toBeNull()
  })

  it('a hidden tech adds no row for anyone', () => {
    const view = {
      ...memberView,
      you: {
        ...memberView.you,
        techsChosen: [{ name: 'Pottery', hidden: true }],
      },
    } as unknown as PlayerView
    render(<StatusPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    openCoins()

    expect(screen.queryByText('Pottery (I)')).toBeNull()
  })

  it('offers Democracy (Govt) only to a player whose government is Democracy', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({}, { government: 'Democracy' })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    openCoins()

    expect(screen.getByRole('button', { name: 'Increase Alice Democracy (Govt)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Increase Bob Democracy (Govt)' })).toBeNull()
  })

  it('offers Organized Religion only with the revealed policy', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({}, { policies: ['Organized Religion'] })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    openCoins()

    expect(screen.getByRole('button', { name: 'Increase Alice Organized Religion' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Increase Bob Organized Religion' })).toBeNull()
  })

  it('offers Panama Canal only to the wonder’s owner in the Wonders area', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({}, { panamaOwner: 'player-me' })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    openCoins()

    expect(screen.getByRole('button', { name: 'Increase Alice Panama Canal' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Increase Bob Panama Canal' })).toBeNull()
  })

  it('a Panama Canal piece outside the Wonders area offers nothing', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({}, { panamaOwner: 'player-me', panamaOutsideWondersArea: true })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    openCoins()

    expect(screen.queryByText('Panama Canal')).toBeNull()
  })

  it('keeps a counter with coins on it visible even when its source is not available', () => {
    render(
      <StatusPanel
        gameId="game-1"
        view={coinView({ organizedReligion: 1 })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    openCoins()

    // No policy chosen: the value must stay reachable or it could never be lowered.
    expect(screen.getByRole('button', { name: 'Decrease Alice Organized Religion' })).toBeTruthy()
  })

  it('shows the Great People row without the removed helper text', () => {
    render(
      <StatusPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    openCoins()

    expect(screen.getByText('Great People')).toBeTruthy()
    expect(screen.queryByText('50% chance of providing 1 coin')).toBeNull()
  })

  it('shows the empty state when nobody has joined', () => {
    const view = { ...memberView, you: null, opponents: [] } as unknown as PlayerView
    render(<StatusPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    openCoins()

    expect(screen.getByText('Nobody has joined yet.')).toBeTruthy()
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
        view={coinView({ codeOfLaws: 4 }, { techs: ['Code of Laws'], panamaOwner: 'player-me' })}
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

  it('raises each tech source limit to six only for The Internet owner', () => {
    const board = createBoard(16, 8)
    const area = wondersArea(board)
    const view = {
      ...coinView(
        { codeOfLaws: 4, civilService: 1 },
        { techs: ['Code of Laws', 'Pottery', 'Democracy', 'Printing Press', 'Civil Service'] },
      ),
      opponents: memberView.opponents.map((opponent) => ({
        ...opponent,
        stats: { ...DEFAULT_PLAYER_STATS, coinSources: { ...EMPTY_COIN_SOURCES, codeOfLaws: 4 } },
      })),
      board: {
        ...board,
        pieces: [{
          id: 'internet', assetId: 'wonders/internet', ownerId: 'player-me',
          category: 'wonder' as const, x: area.x + 20, y: area.y + 40, width: 88, height: 90,
        }],
      },
    } as unknown as PlayerView
    render(<StatusPanel gameId="g" view={view} busy={false} readOnly={false} run={run} />)
    openCoins()
    expect((screen.getByRole('button', { name: 'Increase Alice Code of Laws (I)' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Increase Bob Code of Laws (I)' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Increase Alice Democracy (II)' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Increase Alice Pottery (I)' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Increase Alice Printing Press (II)' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Increase Alice Civil Service (II)' }) as HTMLButtonElement).disabled).toBe(true)
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
