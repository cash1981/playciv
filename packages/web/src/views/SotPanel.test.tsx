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
})

describe('changing government', () => {
  const direct = { government: 'Democracy', route: 'direct', reason: 'You learned Democracy recently, so you can change at once.' }
  const anarchy = { government: 'Feudalism', route: 'anarchy', reason: 'Changing to Feudalism now goes through Anarchy.' }

  it('names the government and offers a button for each one that can be taken at once', () => {
    const sot = sotWith({ government: { ...READY, current: 'Despotism', options: [direct, anarchy], canEnterAnarchy: true } as never })
    renderChoices(viewOf(sot))
    expect(screen.getByText('Despotism', { selector: 'strong' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Change to Democracy' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('You learned Democracy recently, so you can change at once.')).toBeTruthy()
  })

  it('lists a government that needs Anarchy as text, not as a button, and offers Anarchy itself', () => {
    const sot = sotWith({ government: { ...READY, current: 'Despotism', options: [direct, anarchy], canEnterAnarchy: true } as never })
    renderChoices(viewOf(sot))
    expect(screen.queryByRole('button', { name: 'Change to Feudalism' })).toBeNull()
    expect(screen.getByText(/Only through Anarchy\. Changing to Feudalism now goes through Anarchy\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change to Anarchy' })).toBeTruthy()
    expect(screen.getByText(/Your capital takes no action this turn/)).toBeTruthy()
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

  it('disables every button with the reason as text when the engine says it is used or the phase is wrong', () => {
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
    const reason = screen.getByText('Changing government has already been done this turn.')
    expect(button.getAttribute('aria-describedby')).toBe(reason.id)
    expect((screen.getByRole('button', { name: 'Change to Anarchy' }) as HTMLButtonElement).disabled).toBe(true)
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

  it('lists only what the map shows around the chosen city, and sends the city and the resource', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderChoices(viewOf(sotWith({ feudalism: feudalism as never })))
    const section = screen.getByRole('region', { name: 'Feudalism harvest' })
    const button = within(section).getByRole('button', { name: 'Harvest' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const resources = within(section).getByRole('combobox', { name: 'Resource' }) as HTMLSelectElement
    expect(resources.disabled).toBe(true)
    fireEvent.change(within(section).getByRole('combobox', { name: 'City' }), { target: { value: 'c2' } })
    expect(button.disabled).toBe(true)
    expect(within(resources).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a resource',
      'Silk at E5',
      'Wheat at G7 and G6',
      'Iron at F7 (The market has no iron token left.)',
    ])
    expect((within(resources).getByRole('option', { name: /Iron at F7/ }) as HTMLOptionElement).disabled).toBe(true)
    fireEvent.change(resources, { target: { value: 'silk' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'feudalismHarvest', expect.any(String), 6, { cityPieceId: 'c2', resource: 'silk' })
  })

  it('forgets the resource when another city is chosen, which may not hold it', () => {
    renderChoices(viewOf(sotWith({ feudalism: feudalism as never })))
    const section = screen.getByRole('region', { name: 'Feudalism harvest' })
    fireEvent.change(within(section).getByRole('combobox', { name: 'City' }), { target: { value: 'c2' } })
    fireEvent.change(within(section).getByRole('combobox', { name: 'Resource' }), { target: { value: 'silk' } })
    fireEvent.change(within(section).getByRole('combobox', { name: 'City' }), { target: { value: 'c1' } })
    expect((within(section).getByRole('button', { name: 'Harvest' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('chooses the only city by itself', () => {
    const one = { ...feudalism, cities: [{ pieceId: 'c1', label: 'Capital B3', choices: [choice('iron', 'Iron at A1')] }] }
    renderChoices(viewOf(sotWith({ feudalism: one as never })))
    fireEvent.change(screen.getByRole('combobox', { name: 'Resource' }), { target: { value: 'iron' } })
    expect((screen.getByRole('button', { name: 'Harvest' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('says so when the map shows no resource around the city', () => {
    const none = { ...feudalism, cities: [{ pieceId: 'c1', label: 'Capital B3', choices: [] }] }
    renderChoices(viewOf(sotWith({ feudalism: none as never })))
    expect(screen.getByText('The map shows no resource in the outskirts of Capital B3.')).toBeTruthy()
  })

  it('is disabled with the reason when it is used or not allowed', () => {
    const used = { ...feudalism, status: 'used', reason: 'Feudalism government has already been used this turn.' }
    renderChoices(viewOf(sotWith({ feudalism: used as never })))
    expect((screen.getByRole('button', { name: 'Harvest' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Feudalism government has already been used this turn.')).toBeTruthy()
  })
})

describe('investing', () => {
  it('shows each investment card with its markers and when its ability is active', () => {
    renderChoices(viewOf(sotWith()))
    const cards = screen.getByRole('list', { name: 'Your investment cards' })
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

  it('is disabled with the reason as text when there is no coin or the investment is used', () => {
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
    expect((screen.getByRole('button', { name: 'Invest' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/^You have no coin token to invest\./)).toBeTruthy()
  })

  it('explains that printed coins cannot be invested', () => {
    renderChoices(viewOf(sotWith()))
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

  it('is left out when there is no scout and no city left to found', () => {
    renderChoices(viewOf(sotWith()))
    expect(screen.queryByRole('region', { name: 'Scouts and cities' })).toBeNull()
  })

  it('says how many cities you may have and that only production moves, and that there is no scout', () => {
    renderChoices(viewOf(sotWith({ cityLimit: { have: 1, max: 2 } as never })))
    const section = screen.getByRole('region', { name: 'Scouts and cities' })
    expect(within(section).getByText(/You have 1 of the 2 cities you may have/)).toBeTruthy()
    expect(within(section).getByText(/A scout gathers for its city alone/)).toBeTruthy()
    expect(within(section).getByText(/A scout you do not send goes to your capital/)).toBeTruthy()
    expect(within(section).getByText('You have no scout on the map.')).toBeTruthy()
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
    expect(screen.getByText('Your capital, because you did not send it anywhere.')).toBeTruthy()
    expect(within(select).queryByRole('option', { name: 'No city' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(select, { target: { value: 'c2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]?.[4]).toEqual({ scoutPieceId: 's1', cityPieceId: 'c2' })
  })

  it('offers No city only when there is no capital to go to', () => {
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

  it('founds a city where the scout stands, once, when nothing is in the way', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue({} as PlayerView)
    renderChoices(viewOf(sotWith({ scouts: [scout()] as never, cityLimit: { have: 1, max: 2 } as never })))
    const button = screen.getByRole('button', { name: 'Found a city here on E5' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.getByText(/Move any other figures of yours on E5/)).toBeTruthy()
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', 'foundCity', expect.any(String), 6, { figurePieceId: 's1' })
  })

  it('lists every reason a city cannot be founded, and disables the button', () => {
    const reasons = ['E5 is a water square.', 'A hut is next to E5 (F5). Take it first.']
    renderChoices(viewOf(sotWith({ scouts: [scout({ found: { ok: false, reasons, zuluHuts: [] } })] as never })))
    const button = screen.getByRole('button', { name: 'Found a city here on E5' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const list = screen.getByRole('list', { name: 'Why no city on E5' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual(reasons)
    expect(button.getAttribute('aria-describedby')).toBe(list.id)
  })

  it('tells a Zulu player about the hut next to the new city', () => {
    renderChoices(viewOf(sotWith({ scouts: [scout({ found: { ok: true, reasons: [], zuluHuts: ['F5'] } })] as never })))
    expect(screen.getByText(/The Zulu may explore the hut next to the city \(F5\)/)).toBeTruthy()
  })

  it('is disabled outside the Start of Turn, with the reason shown', () => {
    const reason = 'Only available during your open Start of Turn phase.'
    renderChoices(viewOf(sotWith({ scouts: [scout()] as never, scoutsNow: { status: 'wrong-phase', reason } as never })))
    const found = screen.getByRole('button', { name: 'Found a city here on E5' }) as HTMLButtonElement
    expect(found.disabled).toBe(true)
    expect(screen.getByRole('list', { name: 'Why no city on E5' }).textContent).toBe(reason)
    expect((screen.getByRole('combobox', { name: /Send the square of E5 to/ }) as HTMLSelectElement).disabled).toBe(true)
    expect(within(screen.getByRole('region', { name: 'Scouts and cities' })).getAllByText(reason).length).toBeGreaterThan(0)
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
