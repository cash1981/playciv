// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CityProduction, PlayerView } from '../lib/api.js'
import { CitiesPanel } from './CitiesPanel.js'

beforeEach(() => localStorage.setItem('civ.panel.cities', 'true'))
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.cities')
  vi.restoreAllMocks()
})

function city(overrides: Partial<CityProduction> = {}): CityProduction {
  return {
    pieceId: 'city-1',
    label: 'Capital D5',
    outskirts: 7,
    outskirtsDetail: [{ square: 'D4', source: 'forest', amount: 2, blockaded: false }],
    modifiers: [],
    buildingProgram: false,
    estimate: 9,
    withBuildingProgram: null,
    override: null,
    effective: 9,
    notes: ['Not a complete count: the map data does not hold every icon.'],
    ...overrides,
  }
}

/** `own` is the viewer's cities, or null for a spectator; `others` are Bob's. Carol has none. */
function viewOf(own: readonly CityProduction[] | null, others: readonly CityProduction[] = []): PlayerView {
  return {
    you: own === null ? null : { playerId: 'me', username: 'Alice', cities: own },
    opponents: [
      { playerId: 'them', username: 'Bob', cities: others },
      { playerId: 'idle', username: 'Carol', cities: [] },
    ],
  } as unknown as PlayerView
}

const theirs = (overrides: Partial<CityProduction> = {}): CityProduction =>
  city({ pieceId: 'c9', label: 'Capital J10', estimate: 5, effective: 5, ...overrides })

describe('CitiesPanel for a player', () => {
  it('is titled "Opponents\' cities" with the number of cities listed, and is collapsed by default', () => {
    localStorage.removeItem('civ.panel.cities')
    render(<CitiesPanel view={viewOf([city()], [theirs(), theirs({ pieceId: 'c10', label: 'City K11' })])} />)
    const toggle = screen.getByRole('button', { name: "Opponents' cities (2)" })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /^Cities/ })).toBeNull()
  })

  it('lists the opponents’ cities under their name and not the viewer’s own', () => {
    render(<CitiesPanel view={viewOf([city()], [theirs()])} />)
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Bob'])
    expect(screen.getByRole('heading', { name: 'Capital J10' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Capital D5' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your cities' })).toBeNull()
    // The count in the title is the opponents' only: the viewer's city is not in it.
    expect(screen.getByRole('button', { name: "Opponents' cities (1)" })).toBeTruthy()
  })

  it('does not name an opponent with no city on the map', () => {
    render(<CitiesPanel view={viewOf([], [theirs()])} />)
    expect(screen.queryByRole('heading', { name: 'Carol' })).toBeNull()
  })

  it('is not rendered when no opponent has a city, however many the viewer has', () => {
    const { container } = render(<CitiesPanel view={viewOf([city(), city({ pieceId: 'city-2' })], [])} />)
    expect(container.textContent).toBe('')
    expect(screen.queryByText('No cities on the map.')).toBeNull()
  })

  it('copes with an opponent whose view carries no cities field', () => {
    const view = {
      you: { playerId: 'me', username: 'Alice', cities: [] },
      opponents: [{ playerId: 'them', username: 'Bob' }],
    } as unknown as PlayerView
    const { container } = render(<CitiesPanel view={view} />)
    expect(container.textContent).toBe('')
  })

  it('says that cities off the map are not listed', () => {
    render(<CitiesPanel view={viewOf([], [theirs()])} />)
    expect(screen.getByText('Cities that are not on the map are not listed.')).toBeTruthy()
  })

  it('shows the figure and the popup link of an opponent’s city, and nothing to press besides', () => {
    render(<CitiesPanel view={viewOf([city()], [theirs()])} />)
    expect(screen.getByText('Estimated production: 5')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    // Read only: the count link is the only button named for the opponent's city.
    const buttons = screen.getAllByRole('button', { name: /Capital J10/ })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Not a complete count: Capital J10')
    expect(screen.queryByRole('button', { name: /^(Build|Start Building Program|Set production|Use the estimate)/ })).toBeNull()

    fireEvent.click(buttons[0] as HTMLElement)
    const dialog = screen.getByRole('dialog', { name: 'Capital J10: how the estimate is counted' })
    expect(within(dialog).getByText('Estimate: 5')).toBeTruthy()
  })

  it('shows an opponent’s typed number as set by hand, without a way to change it', () => {
    render(<CitiesPanel view={viewOf([], [theirs({ override: 14, effective: 14 })])} />)
    expect(screen.getByText('Set by hand: 14')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Use the estimate/ })).toBeNull()
  })

  it('has no Upgrades block, which belongs to the viewer’s own cities', () => {
    const view = viewOf([city()], [theirs()])
    ;(view.you as unknown as Record<string, unknown>)['upgradeOptions'] = [
      { basicAssetId: 'buildings/granary', label: 'Granary to Aqueduct', count: 1, squares: [] },
    ]
    render(<CitiesPanel view={view} />)
    expect(screen.queryByRole('heading', { name: 'Upgrades' })).toBeNull()
  })
})

describe('CitiesPanel for a spectator', () => {
  it('is titled "Cities" and counts every city on the map', () => {
    render(<CitiesPanel view={viewOf(null, [theirs(), theirs({ pieceId: 'c2', label: 'City B2' })])} />)
    expect(screen.getByRole('button', { name: 'Cities (2)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Opponents/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Bob' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Set / })).toBeNull()
  })

  it('stays on the page and says so when nobody has a city', () => {
    render(<CitiesPanel view={viewOf(null, [])} />)
    expect(screen.getByRole('button', { name: 'Cities (0)' })).toBeTruthy()
    expect(screen.getByText('No cities on the map.')).toBeTruthy()
  })
})
