// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '../lib/api.js'
import type { CityActionOptions, CityProduction, PlayerView, UpgradeFamilyOption } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import { AssistedActionsPanel } from './panelForTests.js'
import type { Run } from './GameView.js'

/** The two gather options every city has; these tests are about the Building Program and the Upgrades. */
const GATHER: Pick<CityActionOptions, 'devoteToTheArts' | 'harvest' | 'actedThisTurn'> = {
  devoteToTheArts: {
    status: 'ready',
    reason: 'Ready to devote this city to the arts.',
    culture: 1,
    parts: [{ label: 'The city itself', amount: 1 }],
    notes: [],
    scouts: [],
  },
  harvest: { status: 'unavailable', reason: 'No resource icon in the outskirts.', choices: [], notes: [] },
  actedThisTurn: [],
}


beforeEach(() => {
  localStorage.setItem('civ.panel.actions', 'true')
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.actions')
  vi.restoreAllMocks()
})

function city(overrides: Partial<CityProduction> = {}): CityProduction {
  return {
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
    ...overrides,
  }
}

const READY: CityActionOptions = {
  cityPieceId: 'city-1',
  label: 'Capital B3',
  ...GATHER,
  startBuildingProgram: { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker: false },
}
const WRONG_PHASE: CityActionOptions = {
  cityPieceId: 'city-1',
  label: 'Capital B3',
  ...GATHER,
  startBuildingProgram: { status: 'wrong-phase', reason: 'It is not your City Management phase.', hasMarker: false },
}
const MARKER: CityActionOptions = {
  cityPieceId: 'city-1',
  label: 'Capital B3',
  ...GATHER,
  startBuildingProgram: {
    status: 'unavailable',
    reason: 'This city already has a Building Program marker.',
    hasMarker: true,
  },
}

const GRANARY: UpgradeFamilyOption = {
  basicAssetId: 'buildings/granary',
  upgradedAssetId: 'buildings/aqueduct',
  basicLabel: 'Granary',
  upgradedLabel: 'Aqueduct',
  label: 'Granary to Aqueduct',
  count: 3,
  squares: [
    { column: 0, row: 0, label: 'A1' },
    { column: 2, row: 1, label: 'C2' },
    { column: 2, row: 2, label: 'C3' },
  ],
}
const LIBRARY: UpgradeFamilyOption = {
  basicAssetId: 'buildings/library',
  upgradedAssetId: 'buildings/university',
  basicLabel: 'Library',
  upgradedLabel: 'University',
  label: 'Library to University',
  count: 1,
  squares: [{ column: 4, row: 4, label: 'E5' }],
}

function viewOf(
  options: {
    own?: readonly CityProduction[] | null
    cityActions?: readonly CityActionOptions[]
    upgradeOptions?: readonly UpgradeFamilyOption[]
    others?: readonly CityProduction[]
    rev?: number
  } = {},
): PlayerView {
  const own = options.own === undefined ? [city()] : options.own
  return {
    rev: options.rev ?? 7,
    you:
      own === null
        ? null
        : {
            playerId: 'me',
            username: 'Alice',
            cities: own,
            cityActions: options.cityActions ?? [],
            upgradeOptions: options.upgradeOptions ?? [],
          },
    opponents: [{ playerId: 'them', username: 'Bob', cities: options.others ?? [] }],
  } as unknown as PlayerView
}

const run: Run = async (action) => {
  await action()
}

/** The page as GameView lays it out: the city actions are in Your actions. */
function page(view: PlayerView, options: { busy?: boolean; readOnly?: boolean; run?: Run } = {}): React.JSX.Element {
  return (
    <AssistedActionsPanel
      gameId="g1"
      view={view}
      busy={options.busy ?? false}
      readOnly={options.readOnly ?? false}
      run={options.run ?? run}
    />
  )
}

function renderPanel(view: PlayerView, options: { busy?: boolean; readOnly?: boolean; run?: Run } = {}): void {
  render(page(view, options))
}

const startButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Start Building Program in Capital B3' }) as HTMLButtonElement

describe('Start Building Program', () => {
  it('is an enabled button named after the city when the engine says ready', () => {
    renderPanel(viewOf({ cityActions: [READY] }))
    const button = startButton()
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Start Building Program')
    expect(screen.queryByText('Ready to start a Building Program.')).toBeNull()
  })

  it('is disabled with the engine reason as text in the wrong phase', () => {
    renderPanel(viewOf({ cityActions: [WRONG_PHASE] }))
    expect(startButton().disabled).toBe(true)
    const reason = screen.getByText('It is not your City Management phase.')
    expect(startButton().getAttribute('aria-describedby')).toContain(reason.id)
  })

  it('is disabled when the marker is there, and the card line says so only once', () => {
    renderPanel(viewOf({ own: [city({ buildingProgram: true, withBuildingProgram: 9 })], cityActions: [MARKER] }))
    expect(startButton().disabled).toBe(true)
    const line = screen.getByText('Building Program in place: 9 if this city produces now')
    expect(startButton().getAttribute('aria-describedby')).toBe(line.id)
    expect(screen.queryByText('This city already has a Building Program marker.')).toBeNull()
    expect(screen.queryByText('Building Program in place')).toBeNull()
  })

  it('says "Building Program in place" itself when the card has no line for it', () => {
    renderPanel(viewOf({ own: [city({ buildingProgram: true, withBuildingProgram: null })], cityActions: [MARKER] }))
    expect(startButton().disabled).toBe(true)
    expect(screen.getByText('Building Program in place')).toBeTruthy()
  })

  it('is disabled while the page is busy', () => {
    renderPanel(viewOf({ cityActions: [READY] }), { busy: true })
    expect(startButton().disabled).toBe(true)
  })

  it('sends exactly one request with the city, the revision and a request id', async () => {
    const send = vi.spyOn(api, 'startBuildingProgram').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf({ cityActions: [READY], rev: 12 }))
    fireEvent.click(startButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 12, 'city-1')
  })

  it('a double click sends one request', async () => {
    let release: (view: PlayerView) => void = () => undefined
    const send = vi.spyOn(api, 'startBuildingProgram').mockImplementation(
      () => new Promise<PlayerView>((resolve) => (release = resolve)),
    )
    renderPanel(viewOf({ cityActions: [READY] }))
    fireEvent.click(startButton())
    fireEvent.click(startButton())
    expect(send).toHaveBeenCalledTimes(1)
    release({} as PlayerView)
    await waitFor(() => expect(startButton().disabled).toBe(false))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('shows the server message in an alert next to the button on a refusal', async () => {
    vi.spyOn(api, 'startBuildingProgram').mockRejectedValue(
      new ApiError(422, 'ACTION_REFUSED', 'That city already has a Building Program marker.'),
    )
    renderPanel(viewOf({ cityActions: [READY] }))
    fireEvent.click(startButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That city already has a Building Program marker.')
    expect(startButton().getAttribute('aria-describedby')).toBe(alert.id)
    // The button is usable again, and a new press clears the old message.
    expect(startButton().disabled).toBe(false)
  })

  it('gives two cities two buttons, two reason ids and two separate presses', async () => {
    const second = city({ pieceId: 'city-2', label: 'City D6' })
    const secondOptions: CityActionOptions = {
      cityPieceId: 'city-2',
      label: 'City D6',
      ...GATHER,
      startBuildingProgram: { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker: false },
    }
    const send = vi.spyOn(api, 'startBuildingProgram').mockResolvedValue({} as PlayerView)
    renderPanel(
      viewOf({
        own: [city({ pieceId: 'city-1' }), second],
        cityActions: [{ ...WRONG_PHASE }, { ...secondOptions, startBuildingProgram: WRONG_PHASE.startBuildingProgram }],
        rev: 3,
      }),
    )
    const first = startButton()
    const other = screen.getByRole('button', { name: 'Start Building Program in City D6' })
    const ids = [first, other].map((button) => button.getAttribute('aria-describedby'))
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBeTruthy()
    expect(ids[0]).not.toBe(ids[1])
    cleanup()

    renderPanel(viewOf({ own: [city({ pieceId: 'city-1' }), second], cityActions: [READY, secondOptions], rev: 3 }))
    fireEvent.click(startButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Start Building Program in City D6' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(send).toHaveBeenNthCalledWith(1, 'g1', expect.any(String), 3, 'city-1')
    expect(send).toHaveBeenNthCalledWith(2, 'g1', expect.any(String), 3, 'city-2')
  })

  it('has no button for an opponent’s city, which is not listed at all', () => {
    renderPanel(viewOf({ own: [], others: [city({ pieceId: 'theirs', label: 'City H8' })], cityActions: [] }))
    expect(screen.queryByRole('heading', { name: 'City H8' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Start Building Program/ })).toBeNull()
  })

  it('has no button for a spectator, in a replay or in a locked game', () => {
    // A spectator has no `you`.
    renderPanel(viewOf({ own: null, others: [city({ pieceId: 'theirs', label: 'City H8' })] }))
    expect(screen.queryByRole('button', { name: /Start Building Program/ })).toBeNull()
    cleanup()

    // GameView passes readOnly for a replay and for a locked game.
    renderPanel(viewOf({ cityActions: [READY] }), { readOnly: true })
    expect(screen.getByRole('heading', { name: 'Capital B3' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start Building Program/ })).toBeNull()
  })

  it('treats a view without cityActions as none', () => {
    const view = viewOf()
    delete (view.you as unknown as Record<string, unknown>)['cityActions']
    delete (view.you as unknown as Record<string, unknown>)['upgradeOptions']
    renderPanel(view)
    expect(screen.getByRole('heading', { name: 'Capital B3' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start Building Program/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
  })
})

describe('Upgrades', () => {
  const block = () => within(screen.getByRole('heading', { name: 'Upgrades' }).parentElement as HTMLElement)

  it('lists each family with its count and squares, and explains what the button does', () => {
    renderPanel(viewOf({ upgradeOptions: [GRANARY, LIBRARY] }))
    expect(block().getByText('Granary to Aqueduct, 3 buildings at A1, C2 and C3')).toBeTruthy()
    expect(block().getByText('Library to University, 1 building at E5')).toBeTruthy()
    expect(
      block().getByText('Flips your basic buildings to the new form. Undo works like the other actions.'),
    ).toBeTruthy()
    expect(block().getByRole('button', { name: 'Upgrade Granary to Aqueduct (3)' })).toBeTruthy()
    expect(block().getByRole('button', { name: 'Upgrade Library to University (1)' })).toBeTruthy()
  })

  it('has "Upgrade all" only when there is more than one family', () => {
    renderPanel(viewOf({ upgradeOptions: [GRANARY] }))
    expect(screen.getByRole('button', { name: 'Upgrade Granary to Aqueduct (3)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Upgrade all' })).toBeNull()
    cleanup()

    renderPanel(viewOf({ upgradeOptions: [GRANARY, LIBRARY] }))
    expect(screen.getByRole('button', { name: 'Upgrade all' })).toBeTruthy()
  })

  it('sends one request with the family for a family button', async () => {
    const send = vi.spyOn(api, 'upgradeBuildings').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf({ upgradeOptions: [GRANARY, LIBRARY], rev: 5 }))
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade Granary to Aqueduct (3)' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 5, 'buildings/granary')
  })

  it('sends one request without a family for "Upgrade all"', async () => {
    const send = vi.spyOn(api, 'upgradeBuildings').mockResolvedValue({} as PlayerView)
    renderPanel(viewOf({ upgradeOptions: [GRANARY, LIBRARY], rev: 5 }))
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade all' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith('g1', expect.any(String), 5, undefined)
  })

  it('a double click sends one request', async () => {
    let release: (view: PlayerView) => void = () => undefined
    const send = vi.spyOn(api, 'upgradeBuildings').mockImplementation(
      () => new Promise<PlayerView>((resolve) => (release = resolve)),
    )
    renderPanel(viewOf({ upgradeOptions: [GRANARY, LIBRARY] }))
    const button = screen.getByRole('button', { name: 'Upgrade all' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(send).toHaveBeenCalledTimes(1)
    release({} as PlayerView)
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('shows a refusal in an alert', async () => {
    vi.spyOn(api, 'upgradeBuildings').mockRejectedValue(
      new ApiError(422, 'ACTION_REFUSED', 'Nothing can be upgraded now.'),
    )
    renderPanel(viewOf({ upgradeOptions: [GRANARY] }))
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade Granary to Aqueduct (3)' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing can be upgraded now.')
  })

  it('keeps a stale refusal on the refreshed view until the next revision', async () => {
    vi.spyOn(api, 'upgradeBuildings').mockRejectedValue(
      new ApiError(409, 'STALE_REVISION', 'Those buildings are already upgraded.'),
    )
    const before = viewOf({ upgradeOptions: [GRANARY], rev: 5 })
    const after = viewOf({ upgradeOptions: [], rev: 6 })
    const later = viewOf({ upgradeOptions: [], rev: 7 })
    function Harness(): React.JSX.Element {
      const [view, setView] = useState(before)
      const reloadingRun: Run = async (action) => {
        await action()
        // GameView queues the refreshed view; the action can settle before React commits it.
        setTimeout(() => setView(after), 0)
      }
      return (
        <>
          {page(view, { run: reloadingRun })}
          <button type="button" onClick={() => setView(later)}>Advance revision</button>
        </>
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade Granary to Aqueduct (3)' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Those buildings are already upgraded.')
    expect(screen.getByRole('heading', { name: 'Upgrades' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Upgrade/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Advance revision' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
  })

  it('clears the refusal when the player presses again', async () => {
    const send = vi
      .spyOn(api, 'upgradeBuildings')
      .mockRejectedValueOnce(new ApiError(422, 'ACTION_REFUSED', 'Nothing can be upgraded now.'))
      .mockResolvedValueOnce({} as PlayerView)
    renderPanel(viewOf({ upgradeOptions: [GRANARY] }))
    const button = screen.getByRole('button', { name: 'Upgrade Granary to Aqueduct (3)' })
    fireEvent.click(button)
    await screen.findByRole('alert')
    fireEvent.click(button)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shows no message when the failure is an unauthorized error', async () => {
    vi.spyOn(api, 'upgradeBuildings').mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Sign in again.'))
    const signOut = vi.fn()
    const signingOutRun: Run = async (action) => {
      try {
        await action()
      } catch {
        signOut()
      }
    }
    render(page(viewOf({ upgradeOptions: [GRANARY] }), { run: signingOutRun }))
    const button = screen.getByRole('button', { name: 'Upgrade Granary to Aqueduct (3)' }) as HTMLButtonElement
    fireEvent.click(button)
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Nothing happened.')).toBeNull()
  })

  it('is hidden when there is nothing to upgrade', () => {
    renderPanel(viewOf({ upgradeOptions: [] }))
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
  })

  it('is hidden for a spectator, in a replay and in a locked game', () => {
    renderPanel(viewOf({ own: null, others: [city({ pieceId: 'theirs' })] }))
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
    cleanup()

    renderPanel(viewOf({ upgradeOptions: [GRANARY] }), { readOnly: true })
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Upgrade/ })).toBeNull()
  })

  it('is disabled while the page is busy', () => {
    renderPanel(viewOf({ upgradeOptions: [GRANARY, LIBRARY] }), { busy: true })
    expect((screen.getByRole('button', { name: 'Upgrade all' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
