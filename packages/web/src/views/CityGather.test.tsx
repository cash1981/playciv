// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '../lib/api.js'
import type { CityActionOptions, CityProduction, PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import { AssistedActionsPanel } from './panelForTests.js'
import type { Run } from './GameView.js'

beforeEach(() => {
  localStorage.setItem('civ.panel.actions', 'true')
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.actions')
  vi.restoreAllMocks()
})

const city: CityProduction = {
  pieceId: 'city-1',
  label: 'Capital B3',
  outskirts: 4,
  outskirtsDetail: [],
  modifiers: [],
  buildingProgram: false,
  estimate: 4,
  withBuildingProgram: null,
  override: null,
  effective: 4,
  notes: [],
}

const DEVOTE: CityActionOptions['devoteToTheArts'] = {
  status: 'ready',
  reason: 'Ready to devote this city to the arts.',
  culture: 3,
  parts: [
    { label: 'The city itself', amount: 1 },
    { label: 'Temple at A3', amount: 2 },
  ],
  notes: ['Culture from other civilization, government, tech and card effects is not counted.'],
  scouts: [{ pieceId: 'scout-1', square: 'E5', source: 'Culture icon', culture: 1, resource: null }],
}

const HARVEST: CityActionOptions['harvest'] = {
  status: 'ready',
  reason: 'Choose a resource.',
  notes: ['The same resource icon cannot be harvested twice in a turn, also not by two cities. The game does not track that.'],
  choices: [
    { resource: 'incense', label: 'Incense at C3', scoutPieceId: null, available: true, unavailableReason: null },
    { resource: 'iron', label: 'Iron at A1', scoutPieceId: null, available: false, unavailableReason: 'The market has no iron token left.' },
    { resource: 'wheat', label: 'Wheat under a scout at E5', scoutPieceId: 'scout-1', available: true, unavailableReason: null },
  ],
}

const options = (overrides: Partial<CityActionOptions> = {}): CityActionOptions => ({
  cityPieceId: 'city-1',
  label: 'Capital B3',
  startBuildingProgram: { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker: false },
  devoteToTheArts: DEVOTE,
  harvest: HARVEST,
  actedThisTurn: [],
  ...overrides,
})

function viewOf(cityActions: readonly CityActionOptions[], rev = 7): PlayerView {
  return {
    rev,
    you: { playerId: 'me', username: 'Alice', cities: [city], cityActions, upgradeOptions: [] },
    opponents: [],
  } as unknown as PlayerView
}

const run: Run = async (action) => {
  await action()
}

function renderPanel(view: PlayerView): void {
  render(<AssistedActionsPanel gameId="g1" view={view} busy={false} readOnly={false} run={run} />)
}

const devoteButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Devote to the Arts in Capital B3' }) as HTMLButtonElement
const harvestButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Harvest a resource in Capital B3' }) as HTMLButtonElement

describe('Devote to the Arts', () => {
  it('is a button on the city card, with no panel until it is pressed', () => {
    renderPanel(viewOf([options()]))
    expect(devoteButton().textContent).toBe('Devote to the Arts')
    expect(devoteButton().disabled).toBe(false)
    expect(devoteButton().getAttribute('title')).toBe('Devote to the Arts in Capital B3')
    expect(screen.queryByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeNull()
  })

  it('is disabled with the engine reason when City Management is closed', () => {
    const closed = options({ devoteToTheArts: { ...DEVOTE, status: 'wrong-phase', reason: 'Only available during your open City Management phase.' } })
    renderPanel(viewOf([closed]))
    expect(devoteButton().disabled).toBe(true)
    expect(screen.getAllByText('Only available during your open City Management phase.').length).toBeGreaterThan(0)
  })

  it('opens a panel with the parts, the total as the number to take, and what is not counted', () => {
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    const panel = screen.getByRole('group', { name: 'Devote Capital B3 to the arts' })
    expect(within(panel).getByText('The city itself: +1')).toBeTruthy()
    expect(within(panel).getByText('Temple at A3: +2')).toBeTruthy()
    expect((within(panel).getByLabelText('Culture to take') as HTMLInputElement).value).toBe('3')
    expect(within(panel).getByRole('button', { name: 'Devote and take 3 culture' })).toBeTruthy()
    expect(within(panel).getByText(/not counted/)).toBeTruthy()
    expect(devoteButton().getAttribute('aria-expanded')).toBe('true')
  })

  it('sends the city and nothing else when the estimate is taken as it is', async () => {
    const send = vi.spyOn(api, 'devoteToTheArts').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Devote and take 3 culture' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', { scoutPieceIds: [] })
  })

  it('closes the panel when the request went through', async () => {
    vi.spyOn(api, 'devoteToTheArts').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Devote and take 3 culture' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeNull())
  })

  it('adds a scout to the total when it is ticked, and sends it', async () => {
    const send = vi.spyOn(api, 'devoteToTheArts').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    fireEvent.click(screen.getByLabelText('Scout at E5 (Culture icon): +1 culture'))
    expect((screen.getByLabelText('Culture to take') as HTMLInputElement).value).toBe('4')
    fireEvent.click(screen.getByRole('button', { name: 'Devote and take 4 culture' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', { scoutPieceIds: ['scout-1'] })
  })

  it('sends the number the player typed, and offers to go back to the estimate', async () => {
    const send = vi.spyOn(api, 'devoteToTheArts').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    fireEvent.change(screen.getByLabelText('Culture to take'), { target: { value: '6' } })
    expect(screen.getByRole('button', { name: 'Use 3' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Devote and take 6 culture' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', { scoutPieceIds: [], culture: 6 })
  })

  it('"Use 3" puts the estimate back', () => {
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    fireEvent.change(screen.getByLabelText('Culture to take'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use 3' }))
    expect((screen.getByLabelText('Culture to take') as HTMLInputElement).value).toBe('3')
    expect(screen.queryByRole('button', { name: 'Use 3' })).toBeNull()
  })

  it('will not send a number that is not a whole number from 0 to 99, and says so', () => {
    const send = vi.spyOn(api, 'devoteToTheArts').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    for (const bad of ['', '-1', '1.5', 'x', '100']) {
      fireEvent.change(screen.getByLabelText('Culture to take'), { target: { value: bad } })
      expect((screen.getByRole('button', { name: 'Devote' }) as HTMLButtonElement).disabled, bad).toBe(true)
      expect(screen.getByRole('alert').textContent).toBe('Type a whole number from 0 to 99.')
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('shows a refusal in the panel and keeps it open', async () => {
    vi.spyOn(api, 'devoteToTheArts').mockRejectedValue(new ApiError(422, 'ACTION_REFUSED', 'Only available during your open City Management phase.'))
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Devote and take 3 culture' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Only available during your open City Management phase.')
    expect(screen.getByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeTruthy()
  })

  it('Cancel closes the panel and sends nothing', () => {
    const send = vi.spyOn(api, 'devoteToTheArts').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('a panel and the phase', () => {
  it('does not come back by itself when the phase closes and opens again', () => {
    const closed = options({
      devoteToTheArts: { ...DEVOTE, status: 'wrong-phase', reason: 'Only available during your open City Management phase.' },
    })
    const { rerender } = render(<AssistedActionsPanel gameId="g1" view={viewOf([options()])} busy={false} readOnly={false} run={run} />)
    fireEvent.click(devoteButton())
    expect(screen.getByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeTruthy()
    rerender(<AssistedActionsPanel gameId="g1" view={viewOf([closed])} busy={false} readOnly={false} run={run} />)
    expect(screen.queryByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeNull()
    rerender(<AssistedActionsPanel gameId="g1" view={viewOf([options()])} busy={false} readOnly={false} run={run} />)
    expect(screen.queryByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeNull()
    expect(devoteButton().getAttribute('aria-expanded')).toBe('false')
  })
})

describe('Harvest', () => {
  it('is disabled with the engine reason when the city has nothing to harvest', () => {
    const none = options({ harvest: { status: 'unavailable', reason: 'No resource icon in the outskirts of Capital B3, and none under a scout of yours.', choices: [], notes: [] } })
    renderPanel(viewOf([none]))
    expect(harvestButton().disabled).toBe(true)
    expect(harvestButton().getAttribute('title')).toBe(none.harvest.reason)
    expect(screen.getByText('No resource icon in the outskirts of Capital B3, and none under a scout of yours.')).toBeTruthy()
  })

  it('lists each resource with where it is, and a resource the market lacks is disabled with its reason', () => {
    renderPanel(viewOf([options()]))
    fireEvent.click(harvestButton())
    const panel = screen.getByRole('group', { name: 'Harvest a resource in Capital B3' })
    expect(within(panel).getByText('Incense at C3')).toBeTruthy()
    expect(within(panel).getByText('Wheat under a scout at E5')).toBeTruthy()
    expect((within(panel).getByRole('button', { name: 'Take Incense at C3' }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(panel).getByRole('button', { name: 'Take Iron at A1' }) as HTMLButtonElement).disabled).toBe(true)
    const why = within(panel).getByText('The market has no iron token left.')
    expect(within(panel).getByRole('button', { name: 'Take Iron at A1' }).getAttribute('aria-describedby')).toBe(why.id)
  })

  it('sends the city and the resource from the outskirts, with no scout', async () => {
    const send = vi.spyOn(api, 'harvest').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(harvestButton())
    fireEvent.click(screen.getByRole('button', { name: 'Take Incense at C3' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', 'incense', undefined)
  })

  it('sends the scout for a resource under one, and closes the panel', async () => {
    const send = vi.spyOn(api, 'harvest').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(harvestButton())
    fireEvent.click(screen.getByRole('button', { name: 'Take Wheat under a scout at E5' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', 'wheat', 'scout-1')
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Harvest a resource in Capital B3' })).toBeNull())
  })

  it('shows a refusal in the panel and keeps it open', async () => {
    vi.spyOn(api, 'harvest').mockRejectedValue(new ApiError(422, 'ACTION_REFUSED', 'The market has no incense token left.'))
    renderPanel(viewOf([options()]))
    fireEvent.click(harvestButton())
    fireEvent.click(screen.getByRole('button', { name: 'Take Incense at C3' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The market has no incense token left.')
    expect(screen.getByRole('group', { name: 'Harvest a resource in Capital B3' })).toBeTruthy()
  })

  it('one panel at a time: opening Harvest closes Devote', () => {
    renderPanel(viewOf([options()]))
    fireEvent.click(devoteButton())
    fireEvent.click(harvestButton())
    expect(screen.queryByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeNull()
    expect(screen.getByRole('group', { name: 'Harvest a resource in Capital B3' })).toBeTruthy()
  })

  it('a spectator or a replay has neither button', () => {
    render(<AssistedActionsPanel gameId="g1" view={viewOf([options()])} busy={false} readOnly={true} run={run} />)
    expect(screen.queryByRole('button', { name: 'Harvest a resource in Capital B3' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Devote to the Arts in Capital B3' })).toBeNull()
  })
})

describe('a second action of the same city this turn', () => {
  const question = 'Capital B3 has already acted this turn (Build, Harvest). A city takes one action each turn. Do it anyway?'
  const acted = (): PlayerView => viewOf([options({ actedThisTurn: ['Build', 'Harvest'] })])

  it('Devote asks before the panel opens, and a no opens nothing', () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPanel(acted())
    fireEvent.click(devoteButton())
    expect(ask).toHaveBeenCalledWith(question)
    expect(screen.queryByRole('group', { name: 'Devote Capital B3 to the arts' })).toBeNull()
  })

  it('Devote with a yes sends confirmedRepeat', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const send = vi.spyOn(api, 'devoteToTheArts').mockResolvedValue({} as PlayerView)
    renderPanel(acted())
    fireEvent.click(devoteButton())
    fireEvent.click(screen.getByRole('button', { name: 'Devote and take 3 culture' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', { scoutPieceIds: [], confirmedRepeat: true })
  })

  it('Harvest asks, and a yes sends confirmedRepeat', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    const send = vi.spyOn(api, 'harvest').mockResolvedValue({} as PlayerView)
    renderPanel(acted())
    fireEvent.click(harvestButton())
    expect(screen.queryByRole('group', { name: 'Harvest a resource in Capital B3' })).toBeNull()
    fireEvent.click(harvestButton())
    expect(ask).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Take Incense at C3' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', 'incense', undefined, true)
  })

  it('Start Building Program asks, a no sends nothing, a yes sends confirmedRepeat', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    const send = vi.spyOn(api, 'startBuildingProgram').mockResolvedValue({} as PlayerView)
    renderPanel(acted())
    const start = screen.getByRole('button', { name: 'Start Building Program in Capital B3' })
    fireEvent.click(start)
    expect(send).not.toHaveBeenCalled()
    fireEvent.click(start)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(ask).toHaveBeenCalledWith(question)
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', true)
  })

  it('a panel opened before the city acted asks when it sends, and a no sends nothing', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true)
    const send = vi.spyOn(api, 'devoteToTheArts').mockResolvedValue({} as PlayerView)
    const { rerender } = render(<AssistedActionsPanel gameId="g1" view={viewOf([options()])} busy={false} readOnly={false} run={run} />)
    fireEvent.click(devoteButton())
    expect(ask).not.toHaveBeenCalled()
    // Another action of the city lands while the panel is open
    rerender(<AssistedActionsPanel gameId="g1" view={acted()} busy={false} readOnly={false} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Devote and take 3 culture' }))
    expect(ask).toHaveBeenCalledWith(question)
    expect(send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Devote and take 3 culture' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1', { scoutPieceIds: [], confirmedRepeat: true })
  })

  it('nothing is asked of a city that has not acted', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const send = vi.spyOn(api, 'startBuildingProgram').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf([options()]))
    fireEvent.click(screen.getByRole('button', { name: 'Start Building Program in Capital B3' }))
    fireEvent.click(devoteButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(ask).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 7, 'city-1')
  })
})
