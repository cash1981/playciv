// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../lib/api.js'
import type { CityProduction, PlayerView } from '../lib/api.js'
import { CityCard } from './CityCard.js'
import type { Run } from './GameView.js'

afterEach(() => {
  cleanup()
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

const run: Run = async (action) => {
  await action()
}

const view = { rev: 7, you: { playerId: 'me', username: 'Alice' }, opponents: [] } as unknown as PlayerView

interface Options {
  /** The viewer's own card, with its controls. Off for an opponent's card. */
  readonly own?: boolean
  readonly busy?: boolean
  readonly readOnly?: boolean
}

function cards(cities: readonly CityProduction[], options: Options = {}): React.JSX.Element {
  const own = options.own ?? true
  return (
    <ul>
      {cities.map((one) => (
        <CityCard
          key={one.pieceId}
          city={one}
          own={
            own
              ? { gameId: 'g1', view, busy: options.busy ?? false, readOnly: options.readOnly ?? false, run }
              : undefined
          }
        />
      ))}
    </ul>
  )
}

function renderCards(cities: readonly CityProduction[], options: Options = {}): void {
  render(cards(cities, options))
}

const productionField = (): HTMLInputElement =>
  screen.getByRole('textbox', { name: /^Production override/ }) as HTMLInputElement

describe('CityCard, the figure', () => {
  it('shows the estimate with a "Not a complete count" link to the arithmetic', () => {
    renderCards([city()])
    expect(screen.getByRole('heading', { name: 'Capital D5' })).toBeTruthy()
    const figure = document.querySelector('.city-figure')
    expect(figure?.textContent).toBe('Estimated production: 9 Not a complete count')
    const link = screen.getByRole('button', { name: 'Not a complete count: Capital D5' })
    expect(link.getAttribute('type')).toBe('button')
    expect(link.getAttribute('aria-haspopup')).toBe('dialog')
    expect(document.querySelector('details')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/Set by hand:/)).toBeNull()
  })

  it('shows a typed number as "Set by hand" with the estimate in small text, and the same popup', () => {
    renderCards([city({ override: 11, effective: 11 })])
    expect(screen.getByText('Set by hand: 11')).toBeTruthy()
    expect(screen.getByText('estimate was 9').tagName).toBe('SMALL')
    expect(screen.queryByRole('button', { name: /^Not a complete count/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'How the estimate is counted: Capital D5' }))
    const dialog = screen.getByRole('dialog', { name: 'Capital D5: how the estimate is counted' })
    expect(within(dialog).getByText('Estimate: 9')).toBeTruthy()
    expect(screen.queryByText(/Estimated production/)).toBeNull()
  })

  it('shows 0 typed by hand as a number, not as no override', () => {
    renderCards([city({ override: 0, effective: 0 })])
    expect(screen.getByText('Set by hand: 0')).toBeTruthy()
  })

  it('shows the building program figure only when the marker is there', () => {
    renderCards([city({ buildingProgram: true, withBuildingProgram: 17 })])
    expect(screen.getByText('Building Program in place: 17 if this city produces now')).toBeTruthy()
    cleanup()

    renderCards([city()])
    expect(screen.queryByText(/Building Program/)).toBeNull()
  })

  it('shows no doubled figure for a Building Program city that is set by hand', () => {
    renderCards([city({ buildingProgram: true, withBuildingProgram: 17, override: 11, effective: 11 })])
    expect(
      screen.getByText('Building Program in place. The figure above is set by hand, so no doubled figure is shown.'),
    ).toBeTruthy()
    expect(screen.queryByText(/17/)).toBeNull()
    expect(screen.queryByText(/if this city produces now/)).toBeNull()
  })

  it('opens a dialog with the squares, modifiers and notes', () => {
    renderCards([city()])
    fireEvent.click(screen.getByRole('button', { name: 'Not a complete count: Capital D5' }))
    const details = screen.getByRole('dialog', { name: 'Capital D5: how the estimate is counted' })

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

    expect(within(details).getByText('Estimate: 9')).toBeTruthy()
    const notes = within(within(details).getByRole('list', { name: 'Capital D5 notes' }))
    expect(notes.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Not a complete count: the map data does not hold every icon.',
      'E6 is unknown and counts as 0.',
    ])
  })

  it('closes the dialog with Escape and with Close, and gives focus back to the link', () => {
    renderCards([city()])
    const link = screen.getByRole('button', { name: 'Not a complete count: Capital D5' })

    fireEvent.click(link)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(link)

    fireEvent.click(link)
    const dialog = screen.getByRole('dialog')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(link)
  })

  it('opens the dialog outside the figure paragraph, with no React nesting error', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderCards([city()])
    fireEvent.click(screen.getByRole('button', { name: 'Not a complete count: Capital D5' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.closest('p')).toBeNull()
    expect(document.querySelector('p.city-figure')?.contains(dialog)).toBe(false)
    expect(errors).not.toHaveBeenCalled()
  })

  it('opens the dialog of the city whose link was pressed, one at a time', () => {
    renderCards([city(), city({ pieceId: 'city-2', label: 'City B2' })])
    fireEvent.click(screen.getByRole('button', { name: 'Not a complete count: City B2' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'City B2: how the estimate is counted' })).toBeTruthy()
  })

  it('says so when no square and no modifier counts', () => {
    renderCards([city({ outskirts: 0, outskirtsDetail: [], modifiers: [], estimate: 0, effective: 0 })])
    fireEvent.click(screen.getByRole('button', { name: 'Not a complete count: Capital D5' }))
    expect(screen.getByText('No outskirts square gives production.')).toBeTruthy()
    expect(screen.getByText('Nothing is added.')).toBeTruthy()
  })
})

describe('CityCard, setting a number by hand', () => {
  it('calls the api with the typed whole number', () => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(view)
    renderCards([city()])
    fireEvent.change(productionField(), { target: { value: '11' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set production of Capital D5' }))
    expect(setProduction).toHaveBeenCalledWith('g1', 'city-1', 11)
  })

  it('sets the number on Enter too, and accepts the edges 0 and 99', () => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(view)
    renderCards([city()])
    fireEvent.change(productionField(), { target: { value: ' 99 ' } })
    fireEvent.submit(productionField().closest('form') as HTMLFormElement)
    expect(setProduction).toHaveBeenLastCalledWith('g1', 'city-1', 99)

    fireEvent.change(productionField(), { target: { value: '0' } })
    fireEvent.submit(productionField().closest('form') as HTMLFormElement)
    expect(setProduction).toHaveBeenLastCalledWith('g1', 'city-1', 0)
  })

  it('"Use the estimate" sends null, and is disabled while there is nothing to remove', () => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(view)
    renderCards([city()])
    expect((screen.getByRole('button', { name: 'Use the estimate for Capital D5' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    renderCards([city({ override: 11, effective: 11 })])
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
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(view)
    renderCards([city()])
    fireEvent.change(productionField(), { target: { value: typed } })
    fireEvent.click(screen.getByRole('button', { name: 'Set production of Capital D5' }))
    expect(setProduction).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Type a whole number from 0 to 99.')
    expect(productionField().getAttribute('aria-invalid')).toBe('true')
  })

  it('clears the message when the player types again', () => {
    renderCards([city()])
    fireEvent.click(screen.getByRole('button', { name: 'Set production of Capital D5' }))
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.change(productionField(), { target: { value: '5' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps a half typed number when the view refreshes with the same saved value', () => {
    const { rerender } = render(cards([city()]))
    fireEvent.change(productionField(), { target: { value: '1' } })

    // A refresh gives new objects with the same override.
    rerender(cards([city()]))
    expect(productionField().value).toBe('1')
  })

  it('shows the saved number in the field, and follows it when someone else changes it', () => {
    const { rerender } = render(cards([city({ override: 11, effective: 11 })]))
    expect(productionField().value).toBe('11')

    rerender(cards([city({ override: 6, effective: 6 })]))
    expect(productionField().value).toBe('6')

    rerender(cards([city()]))
    expect(productionField().value).toBe('')
  })

  it('disables the field and both buttons while busy', () => {
    renderCards([city({ override: 11, effective: 11 })], { busy: true })
    expect(productionField().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Set production of Capital D5' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Use the estimate for Capital D5' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('gives every city its own field and names it after the city', () => {
    const setProduction = vi.spyOn(api, 'setCityProduction').mockResolvedValue(view)
    renderCards([city(), city({ pieceId: 'city-2', label: 'City B2' })])
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    fireEvent.change(screen.getByRole('textbox', { name: 'Production override, City B2' }), { target: { value: '4' } })
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

describe('CityCard, who may edit', () => {
  it('shows an opponent’s card with the figure and the popup, and nothing else to press', () => {
    renderCards([city({ override: 14, effective: 14 })], { own: false })
    expect(screen.getByText('Set by hand: 14')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Use the estimate/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Set production/ })).toBeNull()
    // The count link is the only button on the card.
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.getAttribute('aria-label')).toBe('How the estimate is counted: Capital D5')
  })

  it('shows no field while replaying or locked, but still shows the numbers and the link', () => {
    renderCards([city({ override: 11, effective: 11 })], { readOnly: true })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Set production/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Use the estimate/ })).toBeNull()
    expect(screen.getByText('Set by hand: 11')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'How the estimate is counted: Capital D5' })).toBeTruthy()
  })
})
