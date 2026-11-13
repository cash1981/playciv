// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBoard, DEFAULT_PLAYER_STATS, EMPTY_COIN_SOURCES, wondersArea } from '@civ/engine'
import type { CoinSources, Government } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { CoinsPanel } from './CoinsPanel.js'

beforeEach(() => localStorage.setItem('civ.panel.coins', 'true'))
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.coins')
  vi.restoreAllMocks()
})

const memberView = {
  activeTurn: null,
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

describe('CoinsPanel', () => {
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
      activeTurn: null,
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

  it('shows the sources a player has, with the sheet’s helper text, and no status table', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({}, { techs: ['Code of Laws'], panamaOwner: 'player-me' })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    // The old Status table and its tabs moved to the sidebar beside the map.
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('table', { name: /status/i })).toBeNull()
    expect(document.querySelectorAll('table')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Coins' })).toBeTruthy()
    expect(screen.getByText('Code of Laws (I)')).toBeTruthy()
    expect(screen.getByText('Up to 4 for winning battles')).toBeTruthy()
    expect(screen.getByText('Panama Canal')).toBeTruthy()
    expect(screen.getByText('Sheet')).toBeTruthy()
    expect(screen.getByText('Coins from culture cards, loot or village etc.')).toBeTruthy()
  })

  it('shows Education coins only after Education is revealed', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({}, { techs: ['Education'] })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )
    expect(screen.getByText('Education (III)')).toBeTruthy()
    expect(screen.getByText('1 coin each time you build a wonder (up to 4)')).toBeTruthy()
  })

  it('leaves out every source nobody has', () => {
    render(
      <CoinsPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    // Bank, Great People, Terrain and Sheet are the always-available rows.
    expect(screen.getByText('Bank (Building)')).toBeTruthy()
    expect(screen.getByText('Great People')).toBeTruthy()
    expect(screen.getByText('Terrain')).toBeTruthy()
    expect(screen.getByText('Sheet')).toBeTruthy()
    for (const absent of [
      'Adam Smith',
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
      <CoinsPanel
        gameId="game-1"
        view={coinView({}, { techs: ['Pottery'] })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

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
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    expect(screen.queryByText('Pottery (I)')).toBeNull()
  })

  it('offers Democracy (Govt) only to a player whose government is Democracy', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({}, { government: 'Democracy' })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    expect(screen.getByRole('button', { name: 'Increase Alice Democracy (Govt)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Increase Bob Democracy (Govt)' })).toBeNull()
  })

  it('offers Organized Religion only with the revealed policy', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({}, { policies: ['Organized Religion'] })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    expect(screen.getByRole('button', { name: 'Increase Alice Organized Religion' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Increase Bob Organized Religion' })).toBeNull()
  })

  it('shows Adam Smith as a separate derived coin with no manual controls', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({ adamSmith: 1 })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )
    expect(screen.getByText('Adam Smith')).toBeTruthy()
    expect(screen.getByLabelText('Alice Adam Smith').textContent).toBe('1')
    expect(screen.queryByRole('button', { name: 'Increase Alice Adam Smith' })).toBeNull()
  })

  it('hides the Adam Smith row until he is revealed and usable (issue #310)', () => {
    render(
      <CoinsPanel gameId="game-1" view={coinView({})} busy={false} readOnly={false} run={run} />,
    )
    expect(screen.queryByText('Adam Smith')).toBeNull()
  })

  const democracyAction = (
    status: 'ready' | 'wrong-phase' | 'needs-resource' | 'used',
    reason: string,
  ) => ({ action: 'democracy' as const, label: 'Democracy', status, reason })

  /** The viewer holds a revealed Democracy; the engine's `availableActions` say what can be pressed. */
  function democracyView(action: ReturnType<typeof democracyAction>): PlayerView {
    const base = coinView({}, { techs: ['Democracy'] })
    return {
      ...base,
      rev: 7,
      you: { ...base.you!, availableActions: [action] },
    } as unknown as PlayerView
  }

  it('buys a Democracy coin through the assisted action route, with the revision it saw', async () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue(memberView)
    const view = democracyView(democracyAction('ready', 'Spend 6 trade to add 1 coin to Democracy.'))
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    fireEvent.click(screen.getByRole('button', { name: 'Spend 6 trade' }))

    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    expect(perform).toHaveBeenCalledWith('game-1', 'democracy', expect.any(String), 7)
  })

  it('takes the Democracy button state and reason from availableActions, not from its own rules', () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue(memberView)
    const view = democracyView(
      democracyAction('wrong-phase', 'Only available during your open City Management phase.'),
    )
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    const button = screen.getByRole('button', { name: 'Spend 6 trade' })

    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('title')).toBe('Only available during your open City Management phase.')
    expect(screen.queryByText('Only available during your open City Management phase.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: Democracy' }))
    expect(within(screen.getByRole('dialog')).getByText('Only available during your open City Management phase.')).toBeTruthy()
    fireEvent.click(button)
    expect(perform).not.toHaveBeenCalled()
  })

  it('a Democracy purchase already made this turn stays pressable, asks first and sends confirmedRepeat after a yes', async () => {
    resetPendingRequestIds()
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue(memberView)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const view = democracyView(
      democracyAction('used', 'Democracy has already been used this turn. You will be asked to confirm.'),
    )
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    const button = screen.getByRole('button', { name: 'Spend 6 trade' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('title')).toBe('Democracy has already been used this turn. You will be asked to confirm.')
    expect(screen.queryByText('Democracy has already been used this turn. You will be asked to confirm.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: Democracy' }))
    expect(
      within(screen.getByRole('dialog')).getByText('Democracy has already been used this turn. You will be asked to confirm.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledWith(
      'You have already used Democracy this turn. The rules allow it once per turn. Use it again?',
    )
    expect(perform).not.toHaveBeenCalled()

    fireEvent.click(button)
    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    expect(perform).toHaveBeenCalledWith('game-1', 'democracy', expect.any(String), 7, true)
  })

  const printingPressAction = (
    status: 'ready' | 'wrong-phase' | 'needs-resource' | 'used',
    reason: string,
  ) => ({ action: 'printingPress' as const, label: 'Printing Press', status, reason })

  it('buys a Printing Press coin from the viewer\'s own row through performAction, with the revision it saw', async () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue(memberView)
    const base = coinView({}, { techs: ['Printing Press'] })
    const view = {
      ...base,
      rev: 9,
      you: {
        ...base.you!,
        availableActions: [printingPressAction('ready', 'Spend 5 culture to add 1 coin to Printing Press.')],
      },
      // Bob holds it too, so a button on his row would show up as a second one
      opponents: [
        {
          ...memberView.opponents[0]!,
          revealedTechs: [{ name: 'Printing Press', hidden: false }],
        },
      ],
    } as unknown as PlayerView
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    const buttons = screen.getAllByRole('button', { name: 'Spend 5 culture' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)

    await waitFor(() => expect(perform).toHaveBeenCalledTimes(1))
    expect(perform).toHaveBeenCalledWith('game-1', 'printingPress', expect.any(String), 9)
  })

  it('offers no Printing Press purchase on another player\'s row', () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue(memberView)
    const base = coinView()
    const view = {
      ...base,
      you: {
        ...base.you!,
        // Even a ready action for the viewer must not put a button on Bob's row
        availableActions: [printingPressAction('ready', 'Spend 5 culture to add 1 coin to Printing Press.')],
      },
      opponents: [
        {
          ...memberView.opponents[0]!,
          revealedTechs: [{ name: 'Printing Press', hidden: false }],
        },
      ],
    } as unknown as PlayerView
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    // Bob's counter is there, so the source row renders, but without the purchase
    expect(screen.getByRole('button', { name: 'Increase Bob Printing Press (II)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Spend 5 culture' })).toBeNull()
    expect(perform).not.toHaveBeenCalled()
  })

  it('offers Panama Canal to its owner wherever the wonder is displayed', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({}, { panamaOwner: 'player-me' })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    expect(screen.getByRole('button', { name: 'Increase Alice Panama Canal' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Increase Bob Panama Canal' })).toBeNull()
  })

  it('a Panama Canal in a player area or on the map remains an active source', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({}, { panamaOwner: 'player-me', panamaOutsideWondersArea: true })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    expect(screen.getByRole('button', { name: 'Increase Alice Panama Canal' })).toBeTruthy()
  })

  it('keeps a counter with coins on it visible even when its source is not available', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({ organizedReligion: 1 })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    // No policy chosen: the value must stay reachable or it could never be lowered.
    expect(screen.getByRole('button', { name: 'Decrease Alice Organized Religion' })).toBeTruthy()
  })

  it('shows the Great People row without the removed helper text', () => {
    render(
      <CoinsPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    expect(screen.getByText('Great People')).toBeTruthy()
    expect(screen.queryByText('50% chance of providing 1 coin')).toBeNull()
  })

  it('shows the Great People row as a number the engine derives, with no buttons (issue #241)', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({ greatPeople: 2 })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    expect(screen.getByText("Builder, Merchant and Humanitarian on the map in your cities' outskirts")).toBeTruthy()
    expect(screen.getByLabelText('Alice Great People').textContent).toBe('2')
    expect(screen.queryByRole('button', { name: 'Increase Alice Great People' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Decrease Alice Great People' })).toBeNull()
    // The other rows keep their buttons.
    expect(screen.queryByRole('button', { name: 'Increase Alice Bank (Building)' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Increase Alice Sheet' })).toBeTruthy()
  })

  it('shows a blockaded hint on the Panama Canal row, with no buttons, while an enemy figure is on it (issue #241)', () => {
    const view = {
      // A stored count of 3 must not show while the wonder is blockaded.
      ...coinView({ panamaCanal: 3 }, { panamaOwner: 'player-me', panamaOutsideWondersArea: true }),
      blockadedPieceIds: ['panama-canal'],
    } as PlayerView
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    // The engine already shows the coins as 0; the row stays visible so the reason can be read.
    expect(screen.getByText('Panama Canal')).toBeTruthy()
    expect(screen.getByLabelText('Alice Panama Canal').textContent).toBe('0')
    expect(screen.getByText('blockaded')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Increase Alice Panama Canal' })).toBeNull()
  })

  it('shows no hint and the usual buttons when the Panama Canal is free', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({}, { panamaOwner: 'player-me' })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

    expect(screen.queryByText('blockaded')).toBeNull()
    expect(screen.getByRole('button', { name: 'Increase Alice Panama Canal' })).toBeTruthy()
  })

  it('shows the empty state when nobody has joined', () => {
    const view = { ...memberView, you: null, opponents: [] } as unknown as PlayerView
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    expect(screen.getByText('Nobody has joined yet.')).toBeTruthy()
  })

  it('increases a counter through the shared runner', async () => {
    const setCoin = vi.spyOn(api, 'setPlayerCoin').mockResolvedValue(memberView)
    render(
      <CoinsPanel gameId="game-1" view={memberView} busy={false} readOnly={false} run={run} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Increase Bob Sheet' }))

    await waitFor(() =>
      expect(setCoin).toHaveBeenCalledWith('game-1', 'player-them', 'sheet', 1),
    )
  })

  it('disables + at the printed limit and − at zero, and leaves the two unlimited sources open', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({ codeOfLaws: 4 }, { techs: ['Code of Laws'], panamaOwner: 'player-me' })}
        busy={false}
        readOnly={false}
        run={run}
      />,
    )

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
    render(<CoinsPanel gameId="g" view={view} busy={false} readOnly={false} run={run} />)
    expect((screen.getByRole('button', { name: 'Increase Alice Code of Laws (I)' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Increase Bob Code of Laws (I)' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Increase Alice Democracy (II)' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Increase Alice Pottery (I)' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Increase Alice Printing Press (II)' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Increase Alice Civil Service (II)' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps every counter disabled for a spectator or replay', () => {
    render(
      <CoinsPanel
        gameId="game-1"
        view={coinView({ codeOfLaws: 2 })}
        busy={false}
        readOnly={true}
        run={run}
      />,
    )

    const counters = screen.getAllByRole('button', { name: /^(Increase|Decrease) / })
    expect(counters.length).toBeGreaterThan(0)
    expect(counters.every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })

  it('heads a player column with their civilization once chosen, and their username while it is not (issue #173)', () => {
    const view = {
      ...coinView(),
      you: { ...coinView().you, civilization: { name: 'Egypt' } },
    } as unknown as PlayerView
    render(<CoinsPanel gameId="game-1" view={view} busy={false} readOnly={false} run={run} />)

    const headers = [...document.querySelectorAll('.coin-table thead th')].slice(1)
    expect(headers.map((header) => header.textContent)).toEqual(['Egypt', 'Bob'])
  })

  it('gives every player column in the Coins table a vertical divider (issue #173)', () => {
    render(
      <CoinsPanel gameId="game-1" view={coinView({ sheet: 1 })} busy={false} readOnly={false} run={run} />,
    )

    const headers = [...document.querySelectorAll('.coin-table thead th')].slice(1)
    expect(headers.every((header) => header.classList.contains('status-group-start'))).toBe(true)
    const bodyCells = [...document.querySelectorAll('.coin-table tbody td')]
    expect(bodyCells.length).toBeGreaterThan(0)
    expect(bodyCells.every((cell) => cell.classList.contains('status-group-start'))).toBe(true)
    const totalCells = [...document.querySelectorAll('.coin-table tfoot td')]
    expect(totalCells.length).toBeGreaterThan(0)
    expect(totalCells.every((cell) => cell.classList.contains('status-group-start'))).toBe(true)
  })
})
