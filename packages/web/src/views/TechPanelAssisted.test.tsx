// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TechItem } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { resetPendingRequestIds } from './AssistedActions.js'
import { TechPanel } from './TechPanel.js'

beforeEach(() => {
  resetPendingRequestIds()
})
afterEach(() => {
  cleanup()
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
    expect(button.getAttribute('title')).toBe('You need an Incense token.')
    expect(screen.getByRole('dialog').textContent).toContain('You need an Incense token.')
  })

  it('keeps a used card\'s button pressable in the dialog, and asks before sending confirmedRepeat', async () => {
    const used = viewOf([tech('Currency')])
    const withUsed = {
      ...used,
      you: {
        ...used.you!,
        availableActions: [
          action('currency', 'Currency', 'used', 'Currency has already been used this turn. You will be asked to confirm.'),
        ],
      },
    } as unknown as PlayerView
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue(withUsed)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPanel(withUsed)

    fireEvent.click(await screen.findByText('Currency'))

    const dialog = screen.getByRole('dialog')
    const button = screen.getByRole('button', { name: 'Use Currency' }) as HTMLButtonElement
    expect(dialog.contains(button)).toBe(true)
    expect(button.disabled).toBe(false)
    expect(dialog.textContent).toContain('Used')
    expect(button.getAttribute('title')).toBe('Currency has already been used this turn. You will be asked to confirm.')
    expect(dialog.textContent).toContain('Currency has already been used this turn.')

    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledWith(
      'You have already used Currency this turn. The rules allow it once per turn. Use it again?',
    )
    expect(perform).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(perform).toHaveBeenCalledTimes(1)
    expect(perform).toHaveBeenCalledWith('game-1', 'currency', expect.any(String), 7, true)
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

describe('the unit techs in the tech dialog (issue #327)', () => {
  const unitView = (techName: string, kind: string, status: string, reason: string, buttonText?: string): PlayerView => {
    const base = viewOf([tech(techName, 3)])
    return {
      ...base,
      you: {
        ...base.you!,
        availableActions: [{ ...action(kind, techName, status, reason), ...(buttonText === undefined ? {} : { buttonText }) }],
      },
    } as unknown as PlayerView
  }

  it('lets the player name the two resources Gunpowder pays, and sends them as args', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(viewOf([tech('Gunpowder', 3)]))
    renderPanel(unitView('Gunpowder', 'gunpowder', 'ready', 'Ready to use.', 'Use Gunpowder (any 2 resources)'))
    fireEvent.click(await screen.findByText('Gunpowder'))

    // Nothing is paid by opening the dialog or pressing the button: the picker comes first
    fireEvent.click(screen.getByRole('button', { name: 'Use Gunpowder (any 2 resources)' }))
    expect(send).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Resource 1'), { target: { value: 'Silk' } })
    fireEvent.change(screen.getByLabelText('Resource 2'), { target: { value: 'Incense' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pay Silk and Incense' }))

    expect(send).toHaveBeenCalledTimes(1)
    const [gameId, kind, , rev, args] = send.mock.calls[0] ?? []
    expect([gameId, kind, rev, args]).toEqual(['game-1', 'gunpowder', 7, { resources: ['Silk', 'Incense'] }])
  })

  it('can cancel the Gunpowder picker without paying', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(viewOf([tech('Gunpowder', 3)]))
    renderPanel(unitView('Gunpowder', 'gunpowder', 'ready', 'Ready to use.'))
    fireEvent.click(await screen.findByText('Gunpowder'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Gunpowder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Resource 1')).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('shows Mathematics with the reason it is not usable outside a battle', async () => {
    renderPanel(unitView('Mathematics', 'mathematics', 'wrong-phase', 'Used during a battle you are fighting in.'))
    fireEvent.click(await screen.findByText('Mathematics'))
    const button = screen.getByRole('button', { name: 'Use Mathematics' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByRole('dialog').textContent).toContain('Used during a battle you are fighting in.')
  })
})
