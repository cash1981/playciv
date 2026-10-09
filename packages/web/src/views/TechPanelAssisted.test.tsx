// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TechItem } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import { TechPanel } from './TechPanel.js'

beforeEach(() => {
  localStorage.setItem('civ.panel.techs', 'true')
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
  localStorage.removeItem('civ.panel.techs')
  vi.restoreAllMocks()
})

const tech = (name: string, level: 1 | 2 | 3 | 4 | 5 = 1): TechItem => ({
  id: `tech-${name}`,
  name,
  level,
  hidden: false,
  itemNumber: 1,
  description: null,
  used: false,
  ownerId: 'me',
  sheetName: 'LEVEL_1_TECH',
  kind: 'tech',
  type: null,
})

const action = (kind: string, label: string, status: string, reason: string) => ({
  action: kind,
  label,
  status,
  reason,
})

function viewOf(techsChosen: readonly TechItem[], opponents: readonly unknown[] = []): PlayerView {
  return {
    rev: 7,
    you: {
      playerId: 'me',
      username: 'cash1981',
      color: 'Red',
      civilization: { name: 'Rome' },
      techsChosen,
      pyramidPlacements: [],
      availableActions: [
        action('chivalry', 'Chivalry', 'ready', 'Ready to use.'),
        action('currency', 'Currency', 'ready', 'Ready to use.'),
        action('metalCasting', 'Metal Casting', 'needs-resource', 'You need an Incense token.'),
      ],
    },
    opponents,
  } as unknown as PlayerView
}

const run = async (call: () => Promise<unknown>): Promise<void> => {
  await call()
}

function renderPanel(view: PlayerView): void {
  vi.spyOn(api, 'availableTechs').mockResolvedValue([])
  render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
}

describe('the assisted action button in the tech dialog', () => {
  it('shows the Currency button for Currency, and presses it through the one route', async () => {
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue(viewOf([tech('Currency')]))
    renderPanel(viewOf([tech('Currency')]))

    fireEvent.click(await screen.findByText('Currency'))

    const dialog = screen.getByRole('dialog')
    const button = screen.getByRole('button', { name: 'Use Currency' }) as HTMLButtonElement
    expect(dialog.contains(button)).toBe(true)
    expect(button.disabled).toBe(false)
    // The other incense cards are not offered on this card's dialog
    expect(screen.queryByRole('button', { name: 'Use Chivalry' })).toBeNull()

    fireEvent.click(button)
    expect(perform).toHaveBeenCalledTimes(1)
    const [gameId, kind, requestId, rev] = perform.mock.calls[0] ?? []
    expect([gameId, kind, rev]).toEqual(['game-1', 'currency', 7])
    expect(typeof requestId).toBe('string')
  })

  it('shows Metal Casting\'s button with the reason it is blocked', async () => {
    renderPanel(viewOf([tech('Metal Casting', 3)]))

    fireEvent.click(await screen.findByText('Metal Casting'))

    const button = screen.getByRole('button', { name: 'Use Metal Casting' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByRole('dialog').textContent).toContain('You need an Incense token.')
  })

  it('shows no assisted button for a tech without an action', async () => {
    renderPanel(viewOf([tech('Writing')]))

    fireEvent.click(await screen.findByText('Writing'))

    expect(screen.getByRole('dialog').textContent).toContain('Writing')
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
  })

  it('shows no assisted button on an opponent\'s Currency', async () => {
    const opponent = {
      playerId: 'other',
      username: 'Karandras1',
      color: 'Blue',
      civilization: { name: 'Egypt' },
      revealedTechs: [tech('Currency')],
      numberOfTechsChosen: 1,
      pyramidPlacements: [],
    }
    renderPanel(viewOf([], [opponent]))

    fireEvent.click(await screen.findByRole('tab', { name: 'Karandras1' }))
    fireEvent.click(await screen.findByText('Currency'))

    expect(screen.getByRole('dialog').textContent).toContain('Currency')
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
  })
})
