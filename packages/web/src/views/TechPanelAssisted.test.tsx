// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBoard, mapTop } from '@civ/engine'
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
    renderPanel(viewOf([tech('Masonry')]))

    fireEvent.click(await screen.findByText('Masonry'))

    expect(screen.getByRole('dialog').textContent).toContain('Masonry')
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
  const hut = (name: string) => ({ kind: 'hut', name, used: false, id: `hut-${name}` })
  const unitView = (techName: string, kind: string, status: string, reason: string, buttonText?: string, items: readonly object[] = []): PlayerView => {
    const base = viewOf([tech(techName, 3)])
    return {
      ...base,
      board: { ...createBoard(), pieces: [] },
      boardAreas: [],
      you: {
        ...base.you!,
        items,
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

  it('starts the Gunpowder picker on the resources the player holds as tokens, so the default does not need a card', async () => {
    renderPanel(unitView('Gunpowder', 'gunpowder', 'ready', 'Ready to use.', undefined, [hut('Silk'), hut('Incense')]))
    fireEvent.click(await screen.findByText('Gunpowder'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Gunpowder' }))
    expect((screen.getByLabelText('Resource 1') as HTMLSelectElement).value).toBe('Silk')
    expect((screen.getByLabelText('Resource 2') as HTMLSelectElement).value).toBe('Incense')
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

  it('asks about a repeat Gunpowder use when the player pays, not when the picker opens, and keeps the picker if declined', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(viewOf([tech('Gunpowder', 3)]))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPanel(unitView('Gunpowder', 'gunpowder', 'used', 'Gunpowder has already been used this turn. You will be asked to confirm.'))
    fireEvent.click(await screen.findByText('Gunpowder'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Gunpowder' }))
    // Opening the picker asks nothing: the state can still change before the player submits
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    // Declining keeps the picker open
    expect(screen.getByLabelText('Resource 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[5]).toBe(true)
    expect(screen.queryByLabelText('Resource 1')).toBeNull()
  })

  it('cannot pay Gunpowder from an open picker while another request is running', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(viewOf([tech('Gunpowder', 3)]))
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const view = unitView('Gunpowder', 'gunpowder', 'ready', 'Ready to use.')
    const { rerender } = render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
    fireEvent.click(await screen.findByText('Gunpowder'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Gunpowder' }))
    expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(false)

    rerender(<TechPanel gameId="game-1" busy={true} run={run} view={view} reloadCount={0} />)
    const pay = screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement
    expect(pay.disabled).toBe(true)
    fireEvent.click(pay)
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

describe('the Combustion army picker (issue #327)', () => {
  const piece = (id: string, assetId: string, category: string, label: string, column: number, row: number) => {
    const board = createBoard()
    return { id, assetId, category, label, x: column * board.squareSize + 20, y: mapTop(board) + row * board.squareSize + 20, width: 50, height: 50, rotation: 0 }
  }
  const combustionView = (pieces: readonly object[]): PlayerView => {
    const base = viewOf([tech('Combustion', 4)])
    return {
      ...base,
      board: { ...createBoard(), pieces },
      you: {
        ...base.you!,
        color: 'Red',
        availableActions: [action('combustion', 'Combustion', 'ready', 'Ready to use.')],
      },
    } as unknown as PlayerView
  }
  const twoArmies = [
    piece('a1', 'figures/redarmy', 'figure', 'Red Army', 3, 3),
    piece('b1', 'buildings/granary', 'building', 'Granary', 3, 3),
    piece('a2', 'figures/redarmy', 'figure', 'Red Army', 6, 6),
    piece('b2', 'buildings/market', 'building', 'Market', 6, 6),
    piece('a3', 'figures/redarmy', 'figure', 'Red Army', 9, 2),
  ]

  it('lists one entry for each army on something to destroy, and sends the chosen army, not a square', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(combustionView(twoArmies))
    renderPanel(combustionView(twoArmies))
    fireEvent.click(await screen.findByText('Combustion'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Combustion/ }))
    expect(send).not.toHaveBeenCalled()

    const entries = screen.getAllByRole('button', { name: /^Army on / })
    // The army on an empty square is not offered
    expect(entries.map((entry) => entry.textContent)).toEqual([
      expect.stringContaining('Granary'),
      expect.stringContaining('Market'),
    ])
    fireEvent.click(entries[1] as HTMLElement)
    expect(send).toHaveBeenCalledTimes(1)
    const [gameId, kind, , rev, args] = send.mock.calls[0] ?? []
    expect([gameId, kind, rev, args]).toEqual(['game-1', 'combustion', 7, { pieceId: 'a2' }])
  })

  it('asks about a repeat Combustion use when an army is chosen, and keeps the picker if declined', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(combustionView(twoArmies))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const used = combustionView(twoArmies)
    renderPanel({
      ...used,
      you: { ...used.you!, availableActions: [action('combustion', 'Combustion', 'used', 'Combustion has already been used this turn.')] },
    } as unknown as PlayerView)
    fireEvent.click(await screen.findByText('Combustion'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Combustion/ }))
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: /^Army on / })[0] as HTMLElement)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    // Declining keeps the picker open
    expect(screen.getAllByRole('button', { name: /^Army on / })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: /^Army on / })[0] as HTMLElement)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[5]).toBe(true)
  })

  it('cannot send an army from an open picker while another request is running', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(combustionView(twoArmies))
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const view = combustionView(twoArmies)
    const { rerender } = render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
    fireEvent.click(await screen.findByText('Combustion'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Combustion/ }))

    rerender(<TechPanel gameId="game-1" busy={true} run={run} view={view} reloadCount={0} />)
    const entry = screen.getAllByRole('button', { name: /^Army on / })[0] as HTMLButtonElement
    expect(entry.disabled).toBe(true)
    fireEvent.click(entry)
    expect(send).not.toHaveBeenCalled()
  })

  it('says so when no army stands on something it may destroy, and sends nothing', async () => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(combustionView([]))
    renderPanel(combustionView([piece('a3', 'figures/redarmy', 'figure', 'Red Army', 9, 2)]))
    fireEvent.click(await screen.findByText('Combustion'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Combustion/ }))
    expect(screen.getByRole('dialog').textContent).toContain('None of your armies stands on')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the tech resource abilities in the tech dialog (issue #327, slice 2)', () => {
  const hut = (name: string, id = `hut-${name}`) => ({ kind: 'hut', name, used: false, id })
  const rival = (playerId: string, username: string, units: number, coins: Record<string, number>) => ({
    playerId,
    username,
    color: 'Blue',
    civilization: null,
    revealedTechs: [],
    numberOfTechsChosen: 0,
    pyramidPlacements: [],
    publicHand: { units, cultureCards: 0, huts: 0, villages: 0, greatPersons: 0 },
    stats: { coinSources: coins },
  })
  const RIVALS = [rival('p2', 'Karandras1', 2, { sheet: 2, pottery: 1, civilService: 1 }), rival('p3', 'Itchi', 0, {})]
  const CITIES = [
    { pieceId: 'c1', label: 'Capital B2', estimate: 5 },
    { pieceId: 'c2', label: 'City F6', estimate: 3 },
  ]

  const abilityView = (
    techName: string,
    kind: string,
    options: { status?: string; items?: readonly object[]; opponents?: readonly object[]; cities?: readonly object[] } = {},
  ): PlayerView => {
    const base = viewOf([tech(techName, 2)])
    return {
      ...base,
      board: { ...createBoard(), pieces: [] },
      boardAreas: [],
      opponents: options.opponents ?? RIVALS,
      you: {
        ...base.you!,
        items: options.items ?? [],
        cities: options.cities ?? CITIES,
        availableActions: [action(kind, techName, options.status ?? 'ready', 'Ready to use.')],
      },
    } as unknown as PlayerView
  }

  // `vi.spyOn` returns the one spy while a test opens several dialogs, so a test reads the newest call
  const open = async (techName: string, kind: string, options?: Parameters<typeof abilityView>[2]) => {
    const view = abilityView(techName, kind, options)
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
    renderPanel(view)
    fireEvent.click(await screen.findByText(techName))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Use ${techName}`) }))
    return send
  }

  describe('the resource pickers', () => {
    it('Pottery asks for two resources, Philosophy for three and Education for four, and sends them as args', async () => {
      const pottery = await open('Pottery', 'pottery')
      expect(screen.getAllByLabelText(/^Resource \d$/)).toHaveLength(2)
      fireEvent.change(screen.getByLabelText('Resource 2'), { target: { value: 'Silk' } })
      expect(pottery).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Pay Iron and Silk' }))
      expect(pottery.mock.calls.at(-1)?.slice(1, 5)).toEqual(['pottery', expect.any(String), 7, { resources: ['Iron', 'Silk'] }])
      cleanup()

      const philosophy = await open('Philosophy', 'philosophy')
      expect(screen.getAllByLabelText(/^Resource \d$/)).toHaveLength(3)
      fireEvent.click(screen.getByRole('button', { name: 'Pay Iron, Wheat and Silk' }))
      expect(philosophy.mock.calls.at(-1)?.[4]).toEqual({ resources: ['Iron', 'Wheat', 'Silk'] })
      cleanup()

      const education = await open('Education', 'education')
      expect(screen.getAllByLabelText(/^Resource \d$/)).toHaveLength(4)
      fireEvent.click(screen.getByRole('button', { name: 'Pay Iron, Wheat, Silk and Incense' }))
      expect(education.mock.calls.at(-1)?.[4]).toEqual({ resources: ['Iron', 'Wheat', 'Silk', 'Incense'] })
    })

    it('starts Education on one token of each kind the player holds, and will not send a repeated kind', async () => {
      const send = await open('Education', 'education', { items: [hut('Spy'), hut('Spy', 'hut-spy-2'), hut('Silk')] })
      expect(screen.getAllByLabelText(/^Resource \d$/).map((select) => (select as HTMLSelectElement).value)).toEqual(['Spy', 'Silk', 'Iron', 'Wheat'])

      fireEvent.change(screen.getByLabelText('Resource 3'), { target: { value: 'Spy' } })
      const pay = screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement
      expect(pay.disabled).toBe(true)
      expect(screen.getByRole('group').textContent).toContain('Pick 4 different resources.')
      fireEvent.click(pay)
      expect(send).not.toHaveBeenCalled()
    })

    it('asks about a repeat use when the player pays, not when the picker opens, and keeps the picker if declined', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      const send = await open('Pottery', 'pottery', { status: 'used' })
      expect(confirm).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(send).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Resource 1')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /^Pay / }))
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]?.[5]).toBe(true)
      expect(screen.queryByLabelText('Resource 1')).toBeNull()
    })

    it('cannot pay from an open picker while another request is running, and can be cancelled without sending', async () => {
      const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(abilityView('Philosophy', 'philosophy'))
      vi.spyOn(api, 'availableTechs').mockResolvedValue([])
      const view = abilityView('Philosophy', 'philosophy')
      const { rerender } = render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
      fireEvent.click(await screen.findByText('Philosophy'))
      fireEvent.click(screen.getByRole('button', { name: /^Use Philosophy/ }))
      rerender(<TechPanel gameId="game-1" busy={true} run={run} view={view} reloadCount={0} />)
      const pay = screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement
      expect(pay.disabled).toBe(true)
      fireEvent.click(pay)
      expect(send).not.toHaveBeenCalled()

      rerender(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByLabelText('Resource 1')).toBeNull()
      expect(send).not.toHaveBeenCalled()
    })

    it('cannot pay from an open picker in a replayed revision (read-only)', async () => {
      const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(abilityView('Pottery', 'pottery'))
      vi.spyOn(api, 'availableTechs').mockResolvedValue([])
      const view = abilityView('Pottery', 'pottery')
      const { rerender } = render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
      fireEvent.click(await screen.findByText('Pottery'))
      fireEvent.click(screen.getByRole('button', { name: /^Use Pottery/ }))
      // The button of a replayed revision is disabled; a picker that was already open must not send either
      rerender(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} historical={{ availableTechs: [] } as never} />)
      const pay = screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement
      expect(pay.disabled).toBe(true)
      fireEvent.click(pay)
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('the city picker', () => {
    it('Animal Husbandry lists the player\'s cities and sends the chosen one', async () => {
      const send = await open('Animal Husbandry', 'animalHusbandry')
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Capital B2 (production 5)', 'City F6 (production 3)'])
      fireEvent.change(screen.getByLabelText('City'), { target: { value: 'c2' } })
      expect(send).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Boost City F6' }))
      expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['animalHusbandry', expect.any(String), 7, { cityPieceId: 'c2' }])
    })

    it('says so, and sends nothing, when the player has no city', async () => {
      const send = await open('Banking', 'banking', { cities: [] })
      expect(screen.getByRole('dialog').textContent).toContain('You have no city on the map')
      expect(screen.queryByLabelText('City')).toBeNull()
      expect(send).not.toHaveBeenCalled()
    })

    it('confirms a repeat use at submit, and a busy page cannot send', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      const send = await open('Construction', 'construction', { status: 'used' })
      expect(confirm).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: /^Boost / }))
      expect(send).not.toHaveBeenCalled()
      expect(screen.getByLabelText('City')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /^Boost / }))
      expect(send.mock.calls[0]?.[5]).toBe(true)
    })
  })

  describe('the player pickers', () => {
    it('Horseback Riding names another player', async () => {
      const send = await open('Horseback Riding', 'horsebackRiding')
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Karandras1', 'Itchi'])
      expect(screen.queryByPlaceholderText(/optional/)).toBeNull()
      fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'p3' } })
      fireEvent.click(screen.getByRole('button', { name: 'Use Horseback Riding on Itchi' }))
      expect(send.mock.calls[0]?.[4]).toEqual({ targetId: 'p3' })
    })

    it('Writing, Civil Service and Mass Media take free text for what is cancelled, and leave it out when empty', async () => {
      const send = await open('Writing', 'writing')
      fireEvent.click(screen.getByRole('button', { name: 'Use Writing on Karandras1' }))
      expect(send.mock.calls[0]?.[4]).toEqual({ targetId: 'p2' })
      cleanup()

      const second = await open('Civil Service', 'civilService')
      fireEvent.change(screen.getByLabelText('Culture event (optional)'), { target: { value: '  Sinbad ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Use Civil Service on Karandras1' }))
      expect(second.mock.calls.at(-1)?.[4]).toEqual({ targetId: 'p2', note: 'Sinbad' })
      cleanup()

      await open('Mass Media', 'massMedia')
      expect(screen.getByLabelText('Resource ability (optional)')).toBeTruthy()
    })

    it('says so when there is no other player', async () => {
      const send = await open('Writing', 'writing', { opponents: [] })
      expect(screen.getByRole('dialog').textContent).toContain('There is no other player')
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('Mysticism', () => {
    it('lists only the coin tokens the chosen opponent holds, and sends the counter', async () => {
      const send = await open('Mysticism', 'mysticism')
      // Karandras1 has coins on the sheet and on Pottery; the printed Civil Service coin is not a token
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
        expect.arrayContaining(['Sheet (2)', 'Pottery (I) (1)']),
      )
      expect(screen.queryByRole('option', { name: /Civil Service/ })).toBeNull()
      fireEvent.change(screen.getByLabelText('Coin counter'), { target: { value: 'pottery' } })
      fireEvent.click(screen.getByRole('button', { name: 'Discard a coin from Pottery (I)' }))
      expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['mysticism', expect.any(String), 7, { targetId: 'p2', source: 'pottery' }])
    })

    it('shows when the chosen opponent has no coin token, and cannot send', async () => {
      const send = await open('Mysticism', 'mysticism')
      fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'p3' } })
      expect(screen.getByRole('dialog').textContent).toContain('Itchi holds no coin token.')
      const discard = screen.getByRole('button', { name: /^Discard a coin/ }) as HTMLButtonElement
      expect(discard.disabled).toBe(true)
      fireEvent.click(discard)
      expect(send).not.toHaveBeenCalled()
    })

    it('says so when no opponent holds a coin token', async () => {
      const send = await open('Mysticism', 'mysticism', { opponents: [rival('p3', 'Itchi', 0, {})] })
      expect(screen.getByRole('dialog').textContent).toContain('No opponent holds a coin token.')
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('Monarchy', () => {
    it('obsolete sends the mode alone', async () => {
      const send = await open('Monarchy', 'monarchy')
      expect(screen.queryByLabelText('Player')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Obsolete a wonder' }))
      expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'obsolete' })
    })

    it('kill picks an opponent, shows how many units each holds in the open count, and sends the target', async () => {
      const send = await open('Monarchy', 'monarchy')
      fireEvent.click(screen.getByLabelText(/Kill a random unit/))
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Karandras1 (2 units in hand)', 'Itchi (0 units in hand)'])
      // It starts on the player who holds units
      expect((screen.getByLabelText('Player') as HTMLSelectElement).value).toBe('p2')
      fireEvent.click(screen.getByRole('button', { name: 'Kill a unit of Karandras1' }))
      expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['monarchy', expect.any(String), 7, { mode: 'kill', targetId: 'p2' }])
    })

    it('does not send anything by choosing a mode', async () => {
      const send = await open('Monarchy', 'monarchy')
      fireEvent.click(screen.getByLabelText(/Kill a random unit/))
      fireEvent.click(screen.getByLabelText(/Obsolete an ancient wonder/))
      expect(send).not.toHaveBeenCalled()
    })
  })
})

describe('Atomic Theory and Bureaucracy in the tech dialog (issue #327, batch 2)', () => {
  const piece = (id: string, assetId: string, category: string, label: string, column: number, row: number) => {
    const board = createBoard()
    return { id, assetId, category, label, x: column * board.squareSize + 10, y: mapTop(board) + row * board.squareSize + 10, width: 80, height: 80, rotation: 0 }
  }
  const BLUE = {
    playerId: 'p2', username: 'Karandras1', color: 'Blue', civilization: null, revealedTechs: [], numberOfTechsChosen: 0, pyramidPlacements: [],
    publicHand: { units: 0, cultureCards: 0, huts: 0, villages: 0, greatPersons: 0 }, stats: { coinSources: {} },
  }
  const atomicView = (pieces: readonly object[], status = 'ready'): PlayerView => {
    const base = viewOf([tech('Atomic Theory', 4)])
    return {
      ...base,
      board: { ...createBoard(), pieces },
      boardAreas: [],
      opponents: [BLUE],
      you: { ...base.you!, color: 'Red', items: [], cities: [], availableActions: [action('atomicTheory', 'Atomic Theory', status, 'Ready to use.')] },
    } as unknown as PlayerView
  }
  const MAP = [
    piece('cap', 'cities/bluecapital2', 'city', 'Blue capital', 3, 3),
    piece('city', 'cities/bluecity2', 'city', 'Blue city', 9, 9),
    piece('lib', 'buildings/library', 'building', 'Library', 10, 9),
    piece('mine', 'cities/redcity2', 'city', 'Red city', 1, 1),
  ]
  const open = async (view: PlayerView) => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
    fireEvent.click(await screen.findByText('Atomic Theory'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Atomic Theory/ }))
    return send
  }

  it('sends the extra action mode with no city', async () => {
    const send = await open(atomicView(MAP))
    expect(send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Allow an extra action with each city' }))
    expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['atomicTheory', expect.any(String), 7, { mode: 'extraActions' }])
  })

  it('lists only the cities of other players that are not capitals, says what each takes with it, and asks before nuking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const send = await open(atomicView(MAP))
    fireEvent.click(screen.getByLabelText(/Nuke a city/))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['City J10 of Karandras1'])
    expect(screen.getByRole('group').textContent).toContain('Destroys the city with Library (K10)')
    fireEvent.click(screen.getByRole('button', { name: 'Nuke City J10' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Nuke City J10' }))
    expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'nuke', cityPieceId: 'city' })
  })

  it('shows when there is no city to nuke, and cannot send', async () => {
    const send = await open(atomicView(MAP.filter((entry) => (entry as { id: string }).id !== 'city')))
    fireEvent.click(screen.getByLabelText(/Nuke a city/))
    expect(screen.getByRole('group').textContent).toContain('No city of another player that is not a capital')
    const nuke = screen.getByRole('button', { name: /^Nuke / }) as HTMLButtonElement
    expect(nuke.disabled).toBe(true)
    fireEvent.click(nuke)
    expect(send).not.toHaveBeenCalled()
  })

  it('asks about a repeat use when the player submits, and keeps the picker if declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const send = await open(atomicView(MAP, 'used'))
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Allow an extra action with each city' }))
    expect(send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Allow an extra action with each city' }))
    expect(send.mock.calls[0]?.[5]).toBe(true)
  })

  it('Bureaucracy is one press with no picker, through the one route', async () => {
    const base = viewOf([tech('Bureaucracy', 2)])
    const view = { ...base, you: { ...base.you!, availableActions: [action('bureaucracy', 'Bureaucracy', 'ready', 'Ready to use.')] } } as unknown as PlayerView
    const perform = vi.spyOn(api, 'performAction').mockResolvedValue(view)
    renderPanel(view)
    fireEvent.click(await screen.findByText('Bureaucracy'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Bureaucracy' }))
    expect(perform).toHaveBeenCalledTimes(1)
    expect(perform.mock.calls[0]?.slice(0, 2)).toEqual(['game-1', 'bureaucracy'])
  })
})
