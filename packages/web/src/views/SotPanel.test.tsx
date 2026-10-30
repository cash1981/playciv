// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import type { Run } from './GameView.js'
import { StartOfTurnChoices } from './SotPanel.js'

beforeEach(() => {
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

type StartOfTurn = NonNullable<NonNullable<PlayerView['you']>['startOfTurn']>

const READY = { status: 'ready', reason: 'You may change government once in your Start of Turn.' } as const

function sotWith(overrides: Partial<StartOfTurn> = {}): StartOfTurn {
  return {
    government: {
      ...READY,
      current: 'Despotism',
      options: [],
      canEnterAnarchy: true,
    },
    feudalism: null,
    invest: {
      status: 'ready',
      reason: 'Invest one coin token this turn, and put the marker on one of your investment cards.',
      coins: [{ key: 'sheet', label: 'Sheet', coins: 2 }],
      cards: [
        { key: 'infra', label: 'Infrastructure', ability: 'Your cities produce +1/+2/+3 production.', thresholds: [1, 2, 3], markers: 1 },
        { key: 'efta', label: 'Endowment for the Arts', ability: 'Pay 0/1/2 less culture to advance; +1 culture hand size.', thresholds: [1, 2, 4], markers: 0 },
        { key: 'mic', label: 'Military-Industrial Complex', ability: 'Combat bonus +4/+8/+12.', thresholds: [2, 4, 6], markers: 0 },
        { key: 'pe', label: 'Public Education', ability: 'Each time an ability activates, learn a tech for free.', thresholds: [3, 6, 9], markers: 2 },
      ],
      totalCoins: 2,
    },
    cityLimit: { have: 2, max: 2 },
    cities: [
      { pieceId: 'c1', label: 'Capital B3' },
      { pieceId: 'c2', label: 'City F6' },
    ],
    scoutsNow: { status: 'ready', reason: 'Founding a city and sending a square can be done now.' },
    scouts: [],
    techGrants: [],
    ...overrides,
  } as StartOfTurn
}

const viewOf = (sot: StartOfTurn | null): PlayerView =>
  ({ rev: 6, you: { playerId: 'me', username: 'Alice', startOfTurn: sot }, opponents: [] }) as unknown as PlayerView

const run: Run = async (action) => {
  await action()
}

const renderChoices = (view: PlayerView, props: { busy?: boolean; readOnly?: boolean } = {}) =>
  render(
    <StartOfTurnChoices
      gameId="g1"
      view={view}
      busy={props.busy ?? false}
      readOnly={props.readOnly ?? false}
      run={run}
    />,
  )

describe('StartOfTurnChoices', () => {
  it('renders nothing for a spectator, a replay or a view without the choices', () => {
    const spectator = renderChoices({ rev: 1, you: null, opponents: [] } as unknown as PlayerView)
    expect(spectator.container.textContent).toBe('')
    cleanup()
    expect(renderChoices(viewOf(null)).container.textContent).toBe('')
    cleanup()
    const old = { rev: 1, you: { playerId: 'me', username: 'Alice' }, opponents: [] } as unknown as PlayerView
    expect(renderChoices(old).container.textContent).toBe('')
  })

  it('has a section for the government and one for the investment, and none for Feudalism by default', () => {
    renderChoices(viewOf(sotWith()))
    expect(screen.getByRole('region', { name: 'Change government' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Invest a coin' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Feudalism harvest' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Free techs' })).toBeNull()
  })
})

describe('free techs', () => {
  it('lists each free tech with where it came from, and points at the tech tree', () => {
    const sot = sotWith({
      techGrants: [
        { id: 'a', source: 'Rationalism', level: 1 },
        { id: 'b', source: 'Public Education', level: null },
      ],
    })
    renderChoices(viewOf(sot))
    const section = screen.getByRole('region', { name: 'Free techs' })
    expect(within(section).getByText('You may learn a level I tech for free (Rationalism).')).toBeTruthy()
    expect(within(section).getByText('You may learn a tech of your choice for free (Public Education).')).toBeTruthy()
    expect(within(section).getByRole('button', { name: 'Go to the tech tree' })).toBeTruthy()
  })

  it('lists the techs Edison allows instead of promising an unrestricted choice', () => {
    const sot = sotWith({
      techGrants: [
        { id: 'edison', source: 'Thomas Edison', level: null, allowedTechNames: ['Code of Laws', 'Pottery'] },
      ],
    })
    renderChoices(viewOf(sot))
    const section = screen.getByRole('region', { name: 'Free techs' })
    expect(within(section).getByText('You may learn one of Code of Laws or Pottery for free (Thomas Edison).')).toBeTruthy()
    expect(within(section).queryByText(/a tech of your choice/)).toBeNull()
  })
})

describe('changing government', () => {
  const direct = { government: 'Democracy', route: 'direct', reason: 'You learned Democracy recently, so you can change at once.' }
  const anarchy = { government: 'Feudalism', route: 'anarchy', reason: 'Changing to Feudalism now goes through Anarchy.' }

  it('names the government and offers a button for each one that can be taken at once', () => {
    const sot = sotWith({ government: { ...READY, current: 'Despotism', options: [direct, anarchy], canEnterAnarchy: true } as never })
    renderChoices(viewOf(sot))
    const button = screen.getByRole('button', { name: 'Change to Democracy' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('title')).toBe('You learned Democracy recently, so you can change at once.')
    expect(screen.queryByText(/You can change once in your Start of Turn/)).toBeNull()
  })

  it('shows no text or button for a government that needs Anarchy, and offers Anarchy itself', () => {
    const sot = sotWith({ government: { ...READY, current: 'Despotism', options: [direct, anarchy], canEnterAnarchy: true } as never })
    renderChoices(viewOf(sot))
    expect(screen.queryByRole('button', { name: 'Change to Feudalism' })).toBeNull()
    expect(screen.queryByText(/Only through Anarchy/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Change to Anarchy' }).getAttribute('title')).toMatch(/Your capital takes no action this turn/)
  })

  it('offers no Anarchy to a player who is in it or immune to it', () => {
    const sot = sotWith({ government: { ...READY, current: 'Anarchy', options: [direct], canEnterAnarchy: false } as never })
    renderChoices(viewOf(sot))
    expect(screen.queryByRole('button', { name: 'Change to Anarchy' })).toBeNull()
  })

  it('sends the change with the revision and one request for a double click', async () => {
    let release: (view: PlayerView) => void = () => undefined
    const send = vi.spyOn(api, 'actionWithArgs').mockImplementation(() => new Promise<PlayerView>((resolve) => (release = resolve)))
    const sot = sotWith({ government: { ...READY, current: 'Despotism', options: [direct], canEnterAnarchy: true } as never })
    renderChoices(viewOf(sot))
    fireEvent.click(screen.getByRole('button', { name: 'Change to Democracy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change to Democracy' }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('g1', 'switchGovernment', expect.any(String), 6, { government: 'Democracy' })
    release({} as PlayerView)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  })

  it('sends Anarchy for the Anarchy button', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderChoices(viewOf(sotWith()))
    fireEvent.click(screen.getByRole('button', { name: 'Change to Anarchy' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'switchGovernment', expect.any(String), 6, { government: 'Anarchy' })
  })

  it('disables every button and tags it Used when the change was made this turn', () => {
    const used = {
      status: 'used',
      reason: 'Changing government has already been done this turn.',
      current: 'Democracy',
      options: [direct],
      canEnterAnarchy: true,
    }
    renderChoices(viewOf(sotWith({ government: used as never })))
    const button = screen.getByRole('button', { name: 'Change to Democracy' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Used')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Change to Anarchy' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('is hidden when the change cannot be made, or there is nothing to change to', () => {
    const blockedNow = { status: 'wrong-phase', reason: 'Not now.', current: 'Democracy', options: [direct], canEnterAnarchy: true }
    renderChoices(viewOf(sotWith({ government: blockedNow as never })))
    expect(screen.queryByRole('region', { name: 'Change government' })).toBeNull()
    cleanup()
    const none = { ...READY, current: 'Despotism', options: [anarchy], canEnterAnarchy: false }
    renderChoices(viewOf(sotWith({ government: none as never })))
    expect(screen.queryByRole('region', { name: 'Change government' })).toBeNull()
  })

  it('opens the government card reference from the ? next to the buttons', () => {
    const opened = vi.fn()
    window.addEventListener('civ:open-government-reference', opened)
    const sot = sotWith({ government: { ...READY, current: 'Despotism', options: [direct], canEnterAnarchy: true } as never })
    renderChoices(viewOf(sot))
    fireEvent.click(screen.getByRole('button', { name: 'Show government card reference' }))
    window.removeEventListener('civ:open-government-reference', opened)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('is disabled while the page is busy or read only', () => {
    const sot = sotWith({ government: { ...READY, current: 'Despotism', options: [direct], canEnterAnarchy: true } as never })
    renderChoices(viewOf(sot), { busy: true })
    expect((screen.getByRole('button', { name: 'Change to Democracy' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    renderChoices(viewOf(sot), { readOnly: true })
    expect((screen.getByRole('button', { name: 'Change to Democracy' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the Feudalism harvest', () => {
  const choice = (resource: string, label: string, available = true, unavailableReason: string | null = null) => ({
    resource,
    label,
    available,
    unavailableReason,
  })
  const feudalism = {
    status: 'ready',
    reason: 'Harvest a resource from the outskirts of one of your cities, as the Start of Turn ability of Feudalism.',
    cities: [
      { pieceId: 'c1', label: 'Capital B3', choices: [choice('iron', 'Iron at A1')] },
      {
        pieceId: 'c2',
        label: 'City F6',
        choices: [choice('silk', 'Silk at E5'), choice('wheat', 'Wheat at G7 and G6'), choice('iron', 'Iron at F7', false, 'The market has no iron token left.')],
      },
    ],
  }

  it('lists what the map shows around every city in one list, and sends the city and the resource', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderChoices(viewOf(sotWith({ feudalism: feudalism as never })))
    const section = screen.getByRole('region', { name: 'Feudalism harvest' })
    const button = within(section).getByRole('button', { name: 'Harvest' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(within(section).queryByRole('combobox', { name: 'City' })).toBeNull()
    const resources = within(section).getByRole('combobox', { name: 'Resource' }) as HTMLSelectElement
    expect(resources.disabled).toBe(false)
    // Iron is near both cities, so the city tells the two apart; the others name their square
    expect(within(resources).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a resource',
      'Iron at A1 (Capital B3)',
      'Silk at E5',
      'Wheat at G7 and G6',
      'Iron at F7 (City F6): The market has no iron token left.',
    ])
    expect((within(resources).getByRole('option', { name: /Iron at F7/ }) as HTMLOptionElement).disabled).toBe(true)
    fireEvent.change(resources, { target: { value: 'c2:silk' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'feudalismHarvest', expect.any(String), 6, { cityPieceId: 'c2', resource: 'silk' })
  })

  it('harvests with the city that holds the chosen square when two cities share a resource', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const both = {
      ...feudalism,
      cities: [
        { pieceId: 'c1', label: 'Capital B3', choices: [choice('iron', 'Iron at A1')] },
        { pieceId: 'c2', label: 'City F6', choices: [choice('iron', 'Iron at F7')] },
      ],
    }
    renderChoices(viewOf(sotWith({ feudalism: both as never })))
    fireEvent.change(screen.getByRole('combobox', { name: 'Resource' }), { target: { value: 'c2:iron' } })
    fireEvent.click(screen.getByRole('button', { name: 'Harvest' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'feudalismHarvest', expect.any(String), 6, { cityPieceId: 'c2', resource: 'iron' })
  })

  it('names the city when two cities show the same square', () => {
    const scout = { ...feudalism, cities: [
      { pieceId: 'c1', label: 'Capital B3', choices: [choice('iron', 'Iron under a scout at D4')] },
      { pieceId: 'c2', label: 'City F6', choices: [choice('iron', 'Iron under a scout at D4')] },
    ] }
    renderChoices(viewOf(sotWith({ feudalism: scout as never })))
    expect(within(screen.getByRole('combobox', { name: 'Resource' })).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose a resource',
      'Iron under a scout at D4 (Capital B3)',
      'Iron under a scout at D4 (City F6)',
    ])
  })

  it('goes back to the placeholder after a harvest', async () => {
    vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderChoices(viewOf(sotWith({ feudalism: feudalism as never })))
    const resources = screen.getByRole('combobox', { name: 'Resource' }) as HTMLSelectElement
    fireEvent.change(resources, { target: { value: 'c2:silk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Harvest' }))
    await waitFor(() => expect(resources.value).toBe(''))
  })

  it('forgets a choice that disappears, so it is not selected again if it returns', () => {
    const view = viewOf(sotWith({ feudalism: feudalism as never }))
    const { rerender } = renderChoices(view)
    fireEvent.change(screen.getByRole('combobox', { name: 'Resource' }), { target: { value: 'c2:silk' } })
    const gone = { ...feudalism, cities: [feudalism.cities[0]] }
    const props = { gameId: 'g1', busy: false, readOnly: false, run }
    rerender(<StartOfTurnChoices {...props} view={viewOf(sotWith({ feudalism: gone as never }))} />)
    rerender(<StartOfTurnChoices {...props} view={view} />)
    expect((screen.getByRole('combobox', { name: 'Resource' }) as HTMLSelectElement).value).toBe('')
  })

  it('is disabled while the page is busy or read only', () => {
    const view = viewOf(sotWith({ feudalism: feudalism as never }))
    for (const props of [{ busy: true }, { readOnly: true }]) {
      renderChoices(view, props)
      expect((screen.getByRole('combobox', { name: 'Resource' }) as HTMLSelectElement).disabled).toBe(true)
      cleanup()
    }
  })

  it('does not enable Harvest for a resource that is not available', () => {
    renderChoices(viewOf(sotWith({ feudalism: feudalism as never })))
    fireEvent.change(screen.getByRole('combobox', { name: 'Resource' }), { target: { value: 'c2:iron' } })
    expect((screen.getByRole('button', { name: 'Harvest' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says so behind help when the map shows no resource around the cities', () => {
    const none = { ...feudalism, cities: [{ pieceId: 'c1', label: 'Capital B3', choices: [] }] }
    renderChoices(viewOf(sotWith({ feudalism: none as never })))
    fireEvent.click(screen.getByRole('button', { name: 'Help: Feudalism: harvest a resource' }))
    expect(within(screen.getByRole('dialog')).getByText('The map shows no resource in the outskirts of your cities.')).toBeTruthy()
  })

  it('is disabled and tagged Used when it was used, with the reason behind help', () => {
    const used = { ...feudalism, status: 'used', reason: 'Feudalism government has already been used this turn.' }
    renderChoices(viewOf(sotWith({ feudalism: used as never })))
    expect((screen.getByRole('button', { name: 'Harvest' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Used')).toBeTruthy()
    expect(screen.queryByText(/Take one resource token from the market/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: Feudalism: harvest a resource' }))
    expect(within(screen.getByRole('dialog')).getByText('Feudalism government has already been used this turn.')).toBeTruthy()
  })

  it('is hidden when it cannot be done now', () => {
    const blockedNow = { ...feudalism, status: 'wrong-phase', reason: 'Not now.' }
    renderChoices(viewOf(sotWith({ feudalism: blockedNow as never })))
    expect(screen.queryByRole('region', { name: 'Feudalism harvest' })).toBeNull()
  })
})

describe('investing', () => {
  it('puts each investment card, its markers and its active steps behind help', () => {
    renderChoices(viewOf(sotWith()))
    expect(screen.queryByRole('list', { name: 'Investment cards' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: Investment cards' }))
    const cards = within(screen.getByRole('dialog')).getByRole('list', { name: 'Investment cards' })
    const items = within(cards).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]?.textContent).toContain('Infrastructure: 1 marker.')
    expect(items[3]?.textContent).toContain('Public Education: 2 markers.')
    expect(items[3]?.textContent).toContain('Active at 3, 6, 9.')
  })

  it('needs a card, and chooses the only coin source by itself', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderChoices(viewOf(sotWith()))
    const section = screen.getByRole('region', { name: 'Invest a coin' })
    const button = within(section).getByRole('button', { name: 'Invest' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(within(section).getByRole('combobox', { name: 'Marker on' }), { target: { value: 'mic' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'invest', expect.any(String), 6, { source: 'sheet', card: 'mic' })
  })

  it('makes the player choose between several sources of coins', () => {
    const sot = sotWith()
    const two = {
      ...sot,
      invest: {
        ...sot.invest,
        coins: [
          { key: 'sheet', label: 'Sheet', coins: 1 },
          { key: 'codeOfLaws', label: 'Code of Laws (I)', coins: 2 },
        ],
      },
    } as StartOfTurn
    renderChoices(viewOf(two))
    const section = screen.getByRole('region', { name: 'Invest a coin' })
    fireEvent.change(within(section).getByRole('combobox', { name: 'Marker on' }), { target: { value: 'pe' } })
    expect((within(section).getByRole('button', { name: 'Invest' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(section).getByRole('option', { name: 'Code of Laws (I) (2)' })).toBeTruthy()
    fireEvent.change(within(section).getByRole('combobox', { name: 'Coin from' }), { target: { value: 'codeOfLaws' } })
    expect((within(section).getByRole('button', { name: 'Invest' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('is hidden when there is no coin to invest', () => {
    const sot = sotWith()
    const none = {
      ...sot,
      invest: {
        ...sot.invest,
        status: 'needs-resource',
        reason: 'You have no coin token to invest. Only coins on your sheet and on tech cards can be invested, not printed coins.',
        coins: [],
      },
    } as StartOfTurn
    renderChoices(viewOf(none))
    expect(screen.queryByRole('region', { name: 'Invest a coin' })).toBeNull()
    expect(screen.queryByText(/^You have no coin token to invest\./)).toBeNull()
  })

  it('stays as a compact disabled row after the coin was invested', () => {
    const sot = sotWith()
    const used = {
      ...sot,
      invest: {
        ...sot.invest,
        status: 'used',
        reason: 'Investing has already been done this turn.',
      },
    } as StartOfTurn
    renderChoices(viewOf(used))
    const section = screen.getByRole('region', { name: 'Invest a coin' })
    const button = within(section).getByRole('button', { name: 'Invest' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toBe('Investing has already been done this turn.')
    expect(within(section).queryByRole('combobox')).toBeNull()
    expect(within(section).queryByRole('list')).toBeNull()
    expect(within(section).getByText('Used')).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: 'Help: Invest a coin' }))
    expect(within(screen.getByRole('dialog')).getByText('Investing has already been done this turn.')).toBeTruthy()
  })

  it('explains in the help that printed coins cannot be invested', () => {
    renderChoices(viewOf(sotWith()))
    fireEvent.click(screen.getByRole('button', { name: 'Help: Investment cards' }))
    expect(screen.getByText(/not coins printed on the map, a building, a government or a card/)).toBeTruthy()
  })
})

describe('scouts and cities', () => {
  const scout = (overrides: Record<string, unknown> = {}) => ({
    pieceId: 's1',
    square: 'E5',
    terrain: 'forest',
    figure: 'scout',
    assignedTo: null,
    assignedByDefault: false,
    canSend: true,
    found: { ok: true, reasons: [], zuluHuts: [] },
    ...overrides,
  })

  it('is left out when there is no scout, whatever the city limit', () => {
    renderChoices(viewOf(sotWith()))
    expect(screen.queryByRole('region', { name: 'Scouts and cities' })).toBeNull()
  })

  it('keeps the city limit and the gathering rules behind help', () => {
    renderChoices(viewOf(sotWith({ scouts: [scout()] as never, cityLimit: { have: 1, max: 2 } as never })))
    const section = screen.getByRole('region', { name: 'Scouts and cities' })
    expect(within(section).queryByText(/You have 1 of the 2 cities you may have/)).toBeNull()
    fireEvent.click(within(section).getByRole('button', { name: 'Help: Scouts and cities' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/You have 1 of the 2 cities you may have/)).toBeTruthy()
    expect(dialog.getByText(/A scout gathers for its city alone/)).toBeTruthy()
    expect(dialog.getByText(/A scout you do not send goes to your capital/)).toBeTruthy()
    expect(dialog.getByText(/Move any other figures of yours/)).toBeTruthy()
  })

  it('lists each scout with its square and terrain', () => {
    renderChoices(viewOf(sotWith({ scouts: [scout()] as never })))
    expect(screen.getByText('Scout on E5')).toBeTruthy()
    expect(screen.getByText('(forest)')).toBeTruthy()
  })

  it('sends the square to the chosen city, and “No city” stops it', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderChoices(viewOf(sotWith({ scouts: [scout()] as never })))
    const button = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: /Send the square of E5 to/ }), { target: { value: 'c2' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'assignScout', expect.any(String), 6, { scoutPieceId: 's1', cityPieceId: 'c2' })
  })

  it('shows the capital a scout goes to when it was not sent, and sends the other city chosen', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderChoices(viewOf(sotWith({ scouts: [scout({ assignedTo: 'c1', assignedByDefault: true })] as never })))
    const select = screen.getByRole('combobox', { name: /Send the square of E5 to/ }) as HTMLSelectElement
    expect(select.value).toBe('c1')
    expect(screen.getByText('Capital')).toBeTruthy()
    expect(within(select).queryByRole('option', { name: 'No city' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(select, { target: { value: 'c2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[4]).toEqual({ scoutPieceId: 's1', cityPieceId: 'c2' })
  })

  it('offers No city for a scout that sends nothing', () => {
    renderChoices(viewOf(sotWith({ scouts: [scout({ assignedTo: null })] as never })))
    const select = screen.getByRole('combobox', { name: /Send the square of E5 to/ })
    expect(within(select).getByRole('option', { name: 'No city' })).toBeTruthy()
    expect(screen.queryByText(/because you did not send it anywhere/)).toBeNull()
  })

  it('offers a way back to the default for a square that was sent, whether or not there is a capital', () => {
    renderChoices(viewOf(sotWith({ scouts: [scout({ assignedTo: 'c2', assignedByDefault: false })] as never })))
    const select = screen.getByRole('combobox', { name: /Send the square of E5 to/ })
    expect(within(select).getByRole('option', { name: 'Back to the default' })).toBeTruthy()
  })

  it('does not bring a choice back after the answer returns to what it was', async () => {
    vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const first = viewOf(sotWith({ scouts: [scout({ assignedTo: 'c1', assignedByDefault: true })] as never }))
    const { rerender } = renderChoices(first)
    const select = () => screen.getByRole('combobox', { name: /Send the square of E5 to/ }) as HTMLSelectElement
    fireEvent.change(select(), { target: { value: 'c2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(api.actionWithArgs).toHaveBeenCalledTimes(1))
    // An undo, or another device, puts the scout back with the capital
    rerender(<StartOfTurnChoices gameId="g1" view={first} busy={false} readOnly={false} run={run} />)
    expect(select().value).toBe('c1')
  })

  it('offers no sending for a figure that cannot gather', () => {
    renderChoices(viewOf(sotWith({ scouts: [scout({ figure: 'army', canSend: false })] as never })))
    expect(screen.getByText('Army on E5')).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /Send the square/ })).toBeNull()
  })

  it('says why a scout on a city centre has no sending', () => {
    renderChoices(viewOf(sotWith({ scouts: [scout({ canSend: false })] as never })))
    expect(screen.getByText(/sends no square: it stands on a city centre/)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: /Send the square/ })).toBeNull()
  })

  it('founds a city where the scout stands, once, then goes to the map', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    render(
      <>
        <StartOfTurnChoices
          gameId="g1"
          view={viewOf(sotWith({ scouts: [scout()] as never, cityLimit: { have: 1, max: 2 } as never }))}
          busy={false}
          readOnly={false}
          run={run}
        />
        <section id="game-board">the map</section>
      </>,
    )
    try {
      const button = screen.getByRole('button', { name: 'Found a city here on E5' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      fireEvent.click(button)
      fireEvent.click(button)
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      expect(send).toHaveBeenCalledWith('g1', 'foundCity', expect.any(String), 6, { figurePieceId: 's1' })
      await waitFor(() => expect(scrolled.map((element) => element.id)).toContain('game-board'))
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('has no found button for a square where no city can go, and gives every reason behind help', () => {
    const reasons = ['E5 is a water square.', 'A hut is next to E5 (F5). Take it first.']
    renderChoices(viewOf(sotWith({ scouts: [scout({ found: { ok: false, reasons, zuluHuts: [] } })] as never })))
    expect(screen.queryByRole('button', { name: 'Found a city here on E5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Help: Scouts and cities' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/E5 is a water square\. A hut is next to E5/)).toBeTruthy()
  })

  it('tells a Zulu player about the hut next to the new city', () => {
    renderChoices(viewOf(sotWith({ scouts: [scout({ found: { ok: true, reasons: [], zuluHuts: ['F5'] } })] as never })))
    expect(screen.getByText(/The Zulu may explore the hut next to the city \(F5\)/)).toBeTruthy()
  })

  it('is hidden outside the Start of Turn', () => {
    const reason = 'Only available during your open Start of Turn phase.'
    renderChoices(viewOf(sotWith({ scouts: [scout()] as never, scoutsNow: { status: 'wrong-phase', reason } as never })))
    expect(screen.queryByRole('region', { name: 'Scouts and cities' })).toBeNull()
  })

  it('is disabled while the page is busy or read only', () => {
    const sot = sotWith({ scouts: [scout()] as never })
    renderChoices(viewOf(sot), { busy: true })
    expect((screen.getByRole('button', { name: 'Found a city here on E5' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    renderChoices(viewOf(sot), { readOnly: true })
    expect((screen.getByRole('button', { name: 'Found a city here on E5' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('growing a capital into a metropolis', () => {
  const withAgriculture = (cities: readonly { label: string }[], revealed = true): PlayerView =>
    ({
      rev: 6,
      you: {
        playerId: 'me',
        username: 'Alice',
        startOfTurn: sotWith(),
        techsChosen: [{ name: 'Agriculture', hidden: !revealed }],
        cities,
      },
      opponents: [],
    }) as unknown as PlayerView

  it('points at the map for a player with Agriculture and a capital that is not a metropolis', () => {
    renderChoices(withAgriculture([{ label: 'Capital B3' }]))
    const section = screen.getByRole('region', { name: 'Metropolis' })
    expect(within(section).getByRole('button', { name: 'Go to the map' })).toBeTruthy()
  })

  it('says nothing without Agriculture revealed, or once the capital is a metropolis', () => {
    renderChoices(withAgriculture([{ label: 'Capital B3' }], false))
    expect(screen.queryByRole('region', { name: 'Metropolis' })).toBeNull()
    cleanup()
    renderChoices(withAgriculture([{ label: 'Metropolis B3' }]))
    expect(screen.queryByRole('region', { name: 'Metropolis' })).toBeNull()
  })
})
