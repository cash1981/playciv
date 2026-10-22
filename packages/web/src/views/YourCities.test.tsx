// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CityActionOptions, CityBuildOptions, CityProduction, PlayerView, UpgradeFamilyOption } from '../lib/api.js'
import type { BuildFlow } from './buildFlow.js'
import type { Run } from './GameView.js'
import { YourCities } from './YourCities.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function city(overrides: Partial<CityProduction> = {}): CityProduction {
  return {
    pieceId: 'city-1',
    label: 'Capital D5',
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

const second = city({ pieceId: 'city-2', label: 'City B2', estimate: 6, effective: 6 })

const buildOptions = (cityPieceId: string, label: string): CityBuildOptions => ({
  cityPieceId,
  label,
  status: 'ready',
  reason: 'Ready to build.',
  production: 4,
  productionSource: 'estimate',
  choices: [],
  unavailable: [],
})

const startProgram = (cityPieceId: string, label: string): CityActionOptions => ({
  cityPieceId,
  label,
  startBuildingProgram: { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker: false },
})

const GRANARY: UpgradeFamilyOption = {
  basicAssetId: 'buildings/granary',
  upgradedAssetId: 'buildings/aqueduct',
  basicLabel: 'Granary',
  upgradedLabel: 'Aqueduct',
  label: 'Granary to Aqueduct',
  count: 1,
  squares: [{ column: 0, row: 0, label: 'A1' }],
}

/** A flow that does nothing: the cards only read `pickerCityId` and call the setters on a press. */
const flow: BuildFlow = {
  pickerCityId: null,
  plan: null,
  note: null,
  message: null,
  openPicker: () => undefined,
  closePicker: () => undefined,
  start: () => undefined,
  pick: () => undefined,
  clear: () => undefined,
  refused: () => undefined,
}

function viewOf(
  you: Record<string, unknown> | null,
  others: readonly CityProduction[] = [],
): PlayerView {
  return {
    rev: 7,
    you: you === null ? null : { playerId: 'me', username: 'Alice', ...you },
    opponents: [{ playerId: 'them', username: 'Bob', cities: others }],
  } as unknown as PlayerView
}

const run: Run = async (action) => {
  await action()
}

function renderSection(view: PlayerView, props: { busy?: boolean; readOnly?: boolean; build?: BuildFlow } = {}) {
  return render(
    <YourCities
      gameId="g1"
      view={view}
      busy={props.busy ?? false}
      readOnly={props.readOnly ?? false}
      run={run}
      build={props.build}
    />,
  )
}

describe('YourCities', () => {
  it('is a labelled section headed "Your cities" with one card per own city', () => {
    renderSection(viewOf({ cities: [city(), second] }))
    const section = screen.getByRole('region', { name: 'Your cities' })
    expect(within(section).getByRole('heading', { level: 3, name: 'Your cities' })).toBeTruthy()
    expect(within(section).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual([
      'Capital D5',
      'City B2',
    ])
    expect(within(section).getByText('Estimated production: 4')).toBeTruthy()
    expect(within(section).getByText('Estimated production: 6')).toBeTruthy()
  })

  it('renders nothing for a spectator', () => {
    const { container } = renderSection(viewOf(null, [city({ pieceId: 'theirs', label: 'City H8' })]))
    expect(container.textContent).toBe('')
  })

  it('does not list the opponents’ cities', () => {
    renderSection(viewOf({ cities: [city()] }, [city({ pieceId: 'theirs', label: 'City H8' })]))
    expect(screen.queryByRole('heading', { name: 'City H8' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Bob' })).toBeNull()
  })

  it('says so when the viewer has no city on the map', () => {
    renderSection(viewOf({ cities: [] }))
    expect(screen.getByText('No cities of yours on the map yet.')).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('copes with a view that has no cities field, the way a replayed view does', () => {
    renderSection(viewOf({}))
    expect(screen.getByText('No cities of yours on the map yet.')).toBeTruthy()
  })

  it('puts the Upgrades block above the city cards', () => {
    renderSection(viewOf({ cities: [city()], upgradeOptions: [GRANARY] }))
    const section = screen.getByRole('region', { name: 'Your cities' })
    const upgrades = within(section).getByRole('heading', { level: 4, name: 'Upgrades' })
    const card = within(section).getByRole('heading', { name: 'Capital D5' })
    expect(upgrades.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(section).getByRole('button', { name: 'Upgrade Granary to Aqueduct (1)' })).toBeTruthy()
  })

  it('gives each city the Build and Start buttons of its own options, by piece id', () => {
    renderSection(
      viewOf({
        cities: [city(), second],
        buildOptions: [buildOptions('city-2', 'City B2')],
        cityActions: [startProgram('city-1', 'Capital D5')],
      }),
      { build: flow },
    )
    expect(screen.getByRole('button', { name: 'Build in City B2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Build in Capital D5' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start Building Program in Capital D5' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start Building Program in City B2' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Production, set by hand, City B2' })).toBeTruthy()
  })

  it('has no Build button without a flow', () => {
    renderSection(viewOf({ cities: [city()], buildOptions: [buildOptions('city-1', 'Capital D5')] }))
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Production, set by hand, Capital D5' })).toBeTruthy()
  })

  it('keeps the figures and the popup links, and drops every control, when read only', () => {
    renderSection(
      viewOf({
        cities: [city()],
        buildOptions: [buildOptions('city-1', 'Capital D5')],
        cityActions: [startProgram('city-1', 'Capital D5')],
        upgradeOptions: [GRANARY],
      }),
      { readOnly: true, build: flow },
    )
    expect(screen.getByText('Estimated production: 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not a complete count: Capital D5' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Build in/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Start Building Program/ })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
  })
})
