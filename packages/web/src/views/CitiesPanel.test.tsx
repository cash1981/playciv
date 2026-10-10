// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { CityProduction, PlayerView } from '../lib/api.js'
import { CitiesPanel } from './CitiesPanel.js'
import type { Run } from './GameView.js'

beforeEach(() => localStorage.setItem('civ.panel.cities', 'true'))
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.cities')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function city(overrides: Partial<CityProduction> = {}): CityProduction {
  return {
    pieceId: 'city-1',
    label: 'Capital D5',
    outskirts: 7,
    outskirtsDetail: [
      { square: 'D4', source: 'forest', amount: 2, blockaded: false },
      { square: 'E5', source: 'Workshop', amount: 3, blockaded: false },
      { square: 'C5', source: 'mountain', amount: 0, blockaded: true },
      { square: 'E6', source: 'unknown terrain', amount: 0, blockaded: false },
    ],
    modifiers: [
      { label: 'Infrastructure', amount: 2, applied: true, note: null },
      { label: 'Chichen Itza', amount: 0, applied: false, note: 'Blockaded, so its +3 is switched off.' },
    ],
    buildingProgram: false,
    estimate: 9,
    withBuildingProgram: null,
    override: null,
    effective: 9,
    notes: ['Not a complete count: the map data does not hold every icon.', 'E6 is unknown and counts as 0.'],
    ...overrides,
  }
}

function viewOf(
  own: readonly CityProduction[] | null,
  others: readonly CityProduction[] = [],
): PlayerView {
  return {
    you: own === null ? null : { playerId: 'me', username: 'Alice', cities: own },
    opponents: [
      { playerId: 'them', username: 'Bob', cities: others },
      { playerId: 'idle', username: 'Carol', cities: [] },
    ],
  } as unknown as PlayerView
}

const run: Run = async (action) => {
  await action()
}

function renderPanel(view: PlayerView, options: { busy?: boolean; readOnly?: boolean } = {}): void {
  render(
    <CitiesPanel
      gameId="g1"
      view={view}
      busy={options.busy ?? false}
      readOnly={options.readOnly ?? false}
      run={run}
    />,
  )
}

const productionField = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: /^Production, set by hand/ }) as HTMLInputElement

describe('CitiesPanel', () => {
  it('is collapsed by default and counts the viewer’s cities in its title', () => {
    localStorage.removeItem('civ.panel.cities')
    renderPanel(viewOf([city(), city({ pieceId: 'city-2', label: 'City B2' })], [city({ pieceId: 'c3' })]))
    const toggle = screen.getByRole('button', { name: 'Cities (2)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('says that cities off the map are not listed', () => {
    renderPanel(viewOf([city()]))
    expect(screen.getByText('Cities that are not on the map are not listed.')).toBeTruthy()
  })

  it('shows the estimate and says it is not a complete count', () => {
    renderPanel(viewOf([city()]))
    expect(screen.getByRole('heading', { name: 'Capital D5' })).toBeTruthy()
    const figure = document.querySelector('.city-figure')
    expect(figure?.textContent).toBe('Estimated production: 9, not a complete count')
    expect(screen.queryByText(/Set by hand:/)).toBeNull()
  })

  it('shows a typed number as "Set by hand" with the estimate in small text', () => {
    renderPanel(viewOf([city({ override: 11, effective: 11 })]))
    expect(screen.getByText('Set by hand: 11')).toBeTruthy()
    expect(screen.getByText('estimate was 9').tagName).toBe('SMALL')
    expect(screen.queryByText(/Estimated production/)).toBeNull()
  })

  it('shows 0 typed by hand as a number, not as no override', () => {
    renderPanel(viewOf([city({ override: 0, effective: 0 })]))
    expect(screen.getByText('Set by hand: 0')).toBeTruthy()
  })

  it('shows the building program figure only when the marker is there', () => {
    renderPanel(viewOf([city({ buildingProgram: true, withBuildingProgram: 17 })]))
    expect(screen.getByText('Building Program in place: 17 if this city produces now')).toBeTruthy()
    cleanup()

    renderPanel(viewOf([city()]))
    expect(screen.queryByText(/Building Program/)).toBeNull()
  })

  it('shows no doubled figure for a Building Program city that is set by hand', () => {
    renderPanel(viewOf([city({ buildingProgram: true, withBuildingProgram: 17, override: 11, effective: 11 })]))
    expect(
      screen.getByText('Building Program in place. The figure above is set by hand, so no doubled figure is shown.'),
    ).toBeTruthy()
    expect(screen.queryByText(/17/)).toBeNull()
    expect(screen.queryByText(/if this city produces now/)).toBeNull()
  })

  it('lists the squares, modifiers and notes under "How it is counted"', () => {
    renderPanel(viewOf([city()]))
    const details = screen.getByText('How it is counted').closest('details') as HTMLElement
    expect(details).toBeTruthy()

    const squares = within(within(details).getByRole('list', { name: 'Capital D5 outskirts squares' }))
    expect(squares.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'D4: Forest, 2',
      'E5: Workshop, 3',
      'C5: Mountain, 0 (blockaded)',
      'E6: Unknown terrain, 0',
    ])

    const modifiers = within(within(details).getByRole('list', { name: 'Capital D5 modifiers' }))
    expect(modifiers.getAllByRole('listitem').map((item) => item.textContent?.trim())).toEqual([
      'Infrastructure: +2',
      'Chichen Itza: +0 (switched off) Blockaded, so its +3 is switched off.',
    ])

    const notes = within(within(details).getByRole('list', { name: 'Capital D5 notes' }))
    expect(notes.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Not a complete count: the map data does not hold every icon.',
      'E6 is unknown and counts as 0.',
    ])
  })

  it('says so when no square and no modifier counts', () => {
    renderPanel(viewOf([city({ outskirts: 0, outskirtsDetail: [], modifiers: [], estimate: 0, effective: 0 })]))
    expect(screen.getByText('No outskirts square gives production.')).toBeTruthy()
    expect(screen.getByText('Nothing is added.')).toBeTruthy()
  })

  it('lists no city for a player with none, and says so when nobody has one', () => {
    renderPanel(viewOf([], []))
    expect(screen.getByText('No cities on the map.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cities (0)' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Carol' })).toBeNull()
  })
})

describe('CitiesPanel, title', () => {
  it('reads "0 yours" for a player without a city while an opponent has one', () => {
    renderPanel(viewOf([], [city()]))
    expect(screen.getByRole('button', { name: 'Cities (0 yours)' })).toBeTruthy()
  })

  it('keeps the plain count when the player has a city, or nobody does', () => {
    renderPanel(viewOf([city()], [city({ pieceId: 'c3' })]))
    expect(screen.getByRole('button', { name: 'Cities (1)' })).toBeTruthy()
  })

  it('counts the opponents’ cities for a spectator, never "yours"', () => {
    renderPanel(viewOf(null, []), { readOnly: true })
    expect(screen.getByRole('button', { name: 'Cities (0)' })).toBeTruthy()
  })

  it('copes with an opponent whose view carries no cities field', () => {
    const view = {
      you: { playerId: 'me', username: 'Alice', cities: [] },
      opponents: [{ playerId: 'them', username: 'Bob' }],
    } as unknown as PlayerView
    renderPanel(view)
    expect(screen.getByRole('button', { name: 'Cities (0)' })).toBeTruthy()
    expect(screen.getByText('No cities on the map.')).toBeTruthy()
  })
})

describe('CitiesPanel, setting a number by hand', () => {
  it('calls the api with the typed whole number', () => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(viewOf([city()]))
    renderPanel(viewOf([city()]))
    fireEvent.change(productionField(), { target: { value: '11' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set production of Capital D5' }))
    expect(setProduction).toHaveBeenCalledWith('g1', 'city-1', 11)
  })

  it('sets the number on Enter too, and accepts the edges 0 and 99', () => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(viewOf([city()]))
    renderPanel(viewOf([city()]))
    fireEvent.change(productionField(), { target: { value: ' 99 ' } })
    fireEvent.submit(productionField().closest('form') as HTMLFormElement)
    expect(setProduction).toHaveBeenLastCalledWith('g1', 'city-1', 99)

    fireEvent.change(productionField(), { target: { value: '0' } })
    fireEvent.submit(productionField().closest('form') as HTMLFormElement)
    expect(setProduction).toHaveBeenLastCalledWith('g1', 'city-1', 0)
  })

  it('"Use the estimate" sends null, and is disabled while there is nothing to remove', () => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(viewOf([city()]))
    renderPanel(viewOf([city()]))
    expect((screen.getByRole('button', { name: 'Use the estimate for Capital D5' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    renderPanel(viewOf([city({ override: 11, effective: 11 })]))
    const button = screen.getByRole('button', { name: 'Use the estimate for Capital D5' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(setProduction).toHaveBeenCalledWith('g1', 'city-1', null)
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['negative', '-1'],
    ['too big', '100'],
    ['fractional', '1.5'],
    ['a comma fraction', '1,5'],
    ['text', 'abc'],
    ['an exponent', '1e1'],
  ])('does not call the api for %s input, and says what is expected', (_name, typed) => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(viewOf([city()]))
    renderPanel(viewOf([city()]))
    fireEvent.change(productionField(), { target: { value: typed } })
    fireEvent.click(screen.getByRole('button', { name: 'Set production of Capital D5' }))
    expect(setProduction).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Type a whole number from 0 to 99.')
    expect(productionField().getAttribute('aria-invalid')).toBe('true')
  })

  it('clears the message when the player types again', () => {
    renderPanel(viewOf([city()]))
    fireEvent.click(screen.getByRole('button', { name: 'Set production of Capital D5' }))
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.change(productionField(), { target: { value: '5' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a half typed number when the view refreshes with the same saved value', () => {
    const view = viewOf([city()])
    const { rerender } = render(
      <CitiesPanel gameId="g1" view={view} busy={false} readOnly={false} run={run} />,
    )
    fireEvent.change(productionField(), { target: { value: '1' } })

    // A refresh gives new objects with the same override.
    rerender(
      <CitiesPanel gameId="g1" view={viewOf([city()])} busy={false} readOnly={false} run={run} />,
    )
    expect(productionField().value).toBe('1')
  })

  it('shows the saved number in the field, and follows it when someone else changes it', () => {
    const { rerender } = render(
      <CitiesPanel gameId="g1" view={viewOf([city({ override: 11, effective: 11 })])} busy={false} readOnly={false} run={run} />,
    )
    expect(productionField().value).toBe('11')

    rerender(
      <CitiesPanel gameId="g1" view={viewOf([city({ override: 6, effective: 6 })])} busy={false} readOnly={false} run={run} />,
    )
    expect(productionField().value).toBe('6')

    rerender(<CitiesPanel gameId="g1" view={viewOf([city()])} busy={false} readOnly={false} run={run} />)
    expect(productionField().value).toBe('')
  })

  it('disables the field and both buttons while busy', () => {
    renderPanel(viewOf([city({ override: 11, effective: 11 })]), { busy: true })
    expect(productionField().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Set production of Capital D5' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Use the estimate for Capital D5' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('gives every city its own field and names it after the city', () => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(viewOf([city()]))
    renderPanel(viewOf([city(), city({ pieceId: 'city-2', label: 'City B2' })]))
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    fireEvent.change(screen.getByRole('textbox', { name: 'Production, set by hand, City B2' }), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set production of City B2' }))
    expect(setProduction).toHaveBeenCalledWith('g1', 'city-2', 4)
  })

  it('posts the typed number to the production route of the piece', async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      statusText: '',
      ok: true,
      text: async () => JSON.stringify({ you: null, opponents: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await api.setCityProduction('g1', 'city-1', 11)
    await api.setCityProduction('g1', 'city-1', null)
    const calls = fetchMock.mock.calls as unknown as [string, { method?: string; body?: string }][]
    expect(calls.map(([path, init]) => [path, init.method, init.body])).toEqual([
      ['/api/games/g1/board/pieces/city-1/production', 'POST', '{"production":11}'],
      ['/api/games/g1/board/pieces/city-1/production', 'POST', '{"production":null}'],
    ])
  })
})

describe('CitiesPanel, who may edit', () => {
  it('lists the opponents’ cities under their name, read only, below the viewer’s', () => {
    renderPanel(viewOf([city()], [city({ pieceId: 'c9', label: 'Capital J10', estimate: 5, effective: 5 })]))
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Your cities', 'Bob'])
    expect(screen.getByRole('heading', { name: 'Capital J10' })).toBeTruthy()
    expect(screen.getByText('Estimated production: 5')).toBeTruthy()
    // One field only: Alice's. Bob's city has none.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Capital J10/ })).toBeNull()
    // The arithmetic is still there for the opponent's city.
    expect(screen.getAllByText('How it is counted')).toHaveLength(2)
  })

  it('shows an opponent’s typed number as set by hand, without a way to change it', () => {
    renderPanel(viewOf([], [city({ override: 14, effective: 14 })]))
    expect(screen.getByText('Set by hand: 14')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Use the estimate/ })).toBeNull()
  })

  it('shows a spectator every city read only, and counts them in the title', () => {
    renderPanel(viewOf(null, [city(), city({ pieceId: 'c2', label: 'City B2' })]), { readOnly: true })
    expect(screen.getByRole('button', { name: 'Cities (2)' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Bob' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Set / })).toBeNull()
  })

  it('shows no field while replaying or locked, but still shows the numbers', () => {
    renderPanel(viewOf([city({ override: 11, effective: 11 })]), { readOnly: true })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Set production/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Use the estimate/ })).toBeNull()
    expect(screen.getByText('Set by hand: 11')).toBeTruthy()
  })
})
