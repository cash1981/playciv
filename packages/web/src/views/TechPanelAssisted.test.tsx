// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

const tokenChoice = (resource: string) => ({ kind: 'hut' as const, id: `hut-${resource}`, resource })
const namedPayment = (...resources: readonly string[]) => ({ resources, payments: resources.map(tokenChoice) })
const paymentOf = (resources: readonly string[], count: number) => ({
  cost: Array.from({ length: count }, () => null),
  options: resources.map((resource) => ({ choice: tokenChoice(resource), label: resource })),
})
const chooseResource = (index: number, label: string) => {
  const select = screen.getByLabelText(`Resource ${index}`)
  const option = within(select).getByRole('option', { name: label }) as HTMLOptionElement
  fireEvent.change(select, { target: { value: option.value } })
}
const resourceLabels = () => screen.getAllByLabelText(/^Resource \d$/)
  .map((select) => (select as HTMLSelectElement).selectedOptions[0]?.textContent)

// The choice popup is portalled over the tech dialog, so it is always the last dialog on the page
const popup = () => within(screen.getAllByRole('dialog').at(-1) as HTMLElement)
const okButton = () => popup().getByRole('button', { name: 'OK' }) as HTMLButtonElement
const ok = () => fireEvent.click(okButton())
/** What OK will do, in words: the popup names the target it sends. */
const summary = () => popup().getByText((_, element) => element?.classList.contains('choice-summary') === true).textContent

const action = (kind: string, label: string, status: string, reason: string) => ({
  action: kind,
  label,
  status,
  reason,
  ...(['gunpowder', 'pottery', 'philosophy'].includes(kind)
    ? { payment: paymentOf(['Iron', 'Wheat', 'Silk', 'Incense'], kind === 'philosophy' ? 3 : 2) }
    : {}),
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
  // Gunpowder now obsoletes a wonder or destroys a building, so its picker needs one on the board: a Library on a map square
  const LIBRARY = { id: 'lib1', assetId: 'buildings/library', category: 'building', label: 'Library', x: 4 * createBoard().squareSize + 10, y: mapTop(createBoard()) + 4 * createBoard().squareSize + 10, width: 50, height: 50, rotation: 0 }
  const unitView = (techName: string, kind: string, status: string, reason: string, buttonText?: string, items: readonly object[] = []): PlayerView => {
    const base = viewOf([tech(techName, 3)])
    return {
      ...base,
      board: { ...createBoard(), pieces: techName === 'Gunpowder' ? [LIBRARY] : [] },
      boardAreas: [],
      you: {
        ...base.you!,
        items,
        availableActions: [{
          ...action(kind, techName, status, reason),
          ...(techName === 'Gunpowder' && items.length > 0
            ? { payment: paymentOf(items.flatMap((item) => 'name' in item && typeof item.name === 'string' ? [item.name] : []), 2) }
            : {}),
          ...(buttonText === undefined ? {} : { buttonText }),
        }],
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
    chooseResource(1, 'Silk')
    chooseResource(2, 'Incense')
    expect(summary()).toBe('Destroy Library on E5 (pay Silk and Incense)')
    ok()

    expect(send).toHaveBeenCalledTimes(1)
    const [gameId, kind, , rev, args] = send.mock.calls[0] ?? []
    expect([gameId, kind, rev, args]).toEqual(['game-1', 'gunpowder', 7, { ...namedPayment('Silk', 'Incense'), mode: 'destroy', buildingPieceId: 'lib1' }])
  })

  it('starts the Gunpowder picker on the resources the player holds as tokens, so the default does not need a card', async () => {
    renderPanel(unitView('Gunpowder', 'gunpowder', 'ready', 'Ready to use.', undefined, [hut('Silk'), hut('Incense')]))
    fireEvent.click(await screen.findByText('Gunpowder'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Gunpowder' }))
    expect(resourceLabels()).toEqual(['Silk', 'Incense'])
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

    ok()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    // Declining keeps the picker open
    expect(screen.getByLabelText('Resource 1')).toBeTruthy()

    ok()
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
    expect(okButton().disabled).toBe(false)

    rerender(<TechPanel gameId="game-1" busy={true} run={run} view={view} reloadCount={0} />)
    const pay = okButton()
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

    const entries = screen.getAllByRole('radio')
    // The army on an empty square is not offered
    expect(entries.map((entry) => entry.closest('label')?.textContent)).toEqual([
      expect.stringContaining('Granary'),
      expect.stringContaining('Market'),
    ])
    // The first army is chosen when the popup opens, and nothing is sent by choosing
    expect((entries[0] as HTMLInputElement).checked).toBe(true)
    fireEvent.click(entries[1] as HTMLElement)
    expect(send).not.toHaveBeenCalled()
    ok()
    expect(send).toHaveBeenCalledTimes(1)
    const [gameId, kind, , rev, args] = send.mock.calls[0] ?? []
    expect([gameId, kind, rev, args]).toEqual(['game-1', 'combustion', 7, { pieceId: 'a2' }])
  })

  it('names what the army stands on now: a refresh that moves an offered army onto another building changes the button', async () => {
    const before = [
      piece('a1', 'figures/redarmy', 'figure', 'Red Army', 3, 3),
      piece('b1', 'buildings/granary', 'building', 'Granary', 3, 3),
      piece('b2', 'buildings/market', 'building', 'Market', 6, 6),
    ]
    const moved = [piece('a1', 'figures/redarmy', 'figure', 'Red Army', 6, 6), before[1]!, before[2]!]
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(combustionView(before))
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const { rerender } = render(<TechPanel gameId="game-1" busy={false} run={run} view={combustionView(before)} reloadCount={0} />)
    fireEvent.click(await screen.findByText('Combustion'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Combustion/ }))
    expect(screen.getByLabelText(/^Army on D4/).closest('label')?.textContent).toContain('Granary')

    rerender(<TechPanel gameId="game-1" busy={false} run={run} view={combustionView(moved)} reloadCount={0} />)
    expect(screen.getByLabelText(/^Army on G7/).closest('label')?.textContent).toContain('Market')
    expect(screen.queryByLabelText(/^Army on D4/)).toBeNull()
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ pieceId: 'a1' })
  })

  it('shows the reason, and nothing to press, when a refresh leaves no army on a target', async () => {
    const before = [piece('a1', 'figures/redarmy', 'figure', 'Red Army', 3, 3), piece('b1', 'buildings/granary', 'building', 'Granary', 3, 3)]
    const away = [piece('a1', 'figures/redarmy', 'figure', 'Red Army', 9, 2), before[1]!]
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(combustionView(before))
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const { rerender } = render(<TechPanel gameId="game-1" busy={false} run={run} view={combustionView(before)} reloadCount={0} />)
    fireEvent.click(await screen.findByText('Combustion'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Combustion/ }))
    rerender(<TechPanel gameId="game-1" busy={false} run={run} view={combustionView(away)} reloadCount={0} />)
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Army that uses Combustion' }).textContent).toContain('None of your armies stands on')
    expect(okButton().disabled).toBe(true)
    expect(send).not.toHaveBeenCalled()
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

    ok()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    // Declining keeps the picker open
    expect(screen.getAllByRole('radio')).toHaveLength(2)

    ok()
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
    const entry = okButton()
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
    options: { status?: string; items?: readonly object[]; opponents?: readonly object[]; cities?: readonly object[]; pieces?: readonly object[] } = {},
  ): PlayerView => {
    const base = viewOf([tech(techName, 2)])
    return {
      ...base,
      board: { ...createBoard(), pieces: options.pieces ?? [] },
      boardAreas: [],
      opponents: options.opponents ?? RIVALS,
      you: {
        ...base.you!,
        items: options.items ?? [],
        cities: options.cities ?? CITIES,
        availableActions: [{
          ...action(kind, techName, options.status ?? 'ready', 'Ready to use.'),
          ...(['pottery', 'philosophy'].includes(kind) && options.items !== undefined
            ? { payment: paymentOf(options.items.flatMap((item) => 'name' in item && typeof item.name === 'string' ? [item.name] : []), kind === 'philosophy' ? 3 : 2) }
            : {}),
        }],
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
    it('Pottery asks for two resources and Philosophy for three, and sends them as args', async () => {
      const pottery = await open('Pottery', 'pottery')
      expect(screen.getAllByLabelText(/^Resource \d$/)).toHaveLength(2)
      chooseResource(2, 'Silk')
      expect(pottery).not.toHaveBeenCalled()
      expect(summary()).toBe('Pay Iron and Silk.')
      ok()
      expect(pottery.mock.calls.at(-1)?.slice(1, 5)).toEqual(['pottery', expect.any(String), 7, namedPayment('Iron', 'Silk')])
      cleanup()

      const philosophy = await open('Philosophy', 'philosophy')
      expect(screen.getAllByLabelText(/^Resource \d$/)).toHaveLength(3)
      expect(summary()).toBe('Pay Iron, Wheat and Silk.')
      ok()
      expect(philosophy.mock.calls.at(-1)?.[4]).toEqual(namedPayment('Iron', 'Wheat', 'Silk'))
    })

    it('does not invent a third payment when the player holds only two tokens', async () => {
      await open('Philosophy', 'philosophy', { items: [hut('Spy'), hut('Silk')] })
      expect(resourceLabels()).toEqual(['No available payment', 'No available payment', 'No available payment'])
      expect(okButton().disabled).toBe(true)
      expect(screen.queryByRole('option', { name: 'Iron' })).toBeNull()
    })

    it('Education has no picker: it pays Incense, Iron, Silk and Wheat directly, naming every card that would be played', async () => {
      const base = abilityView('Education', 'education')
      const view = {
        ...base,
        you: { ...base.you!, availableActions: [{ ...action('education', 'Education', 'ready', 'Ready to use.'), warning: 'Not enough resource tokens: A Gift from Afar and A Generous Gift in your hand would be played as a resource and discarded.' }] },
      } as unknown as PlayerView
      const perform = vi.spyOn(api, 'performAction').mockResolvedValue(view)
      const withArgs = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
      renderPanel(view)
      fireEvent.click(await screen.findByText('Education'))
      expect(screen.getByRole('dialog').textContent).toContain('A Gift from Afar and A Generous Gift')
      fireEvent.click(screen.getByRole('button', { name: 'Use Education' }))
      expect(screen.queryByLabelText('Resource 1')).toBeNull()
      expect(withArgs).not.toHaveBeenCalled()
      expect(perform).toHaveBeenCalledTimes(1)
      expect(perform.mock.calls[0]?.slice(0, 2)).toEqual(['game-1', 'education'])
    })

    it('Education asks before a repeat use and sends confirmedRepeat after a yes', async () => {
      const base = abilityView('Education', 'education', { status: 'used' })
      const perform = vi.spyOn(api, 'performAction').mockResolvedValue(base)
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      renderPanel(base)
      fireEvent.click(await screen.findByText('Education'))
      fireEvent.click(screen.getByRole('button', { name: 'Use Education' }))
      expect(perform).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Use Education' }))
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(perform).toHaveBeenCalledWith('game-1', 'education', expect.any(String), 7, true)
    })

    it('asks about a repeat use when the player pays, not when the picker opens, and keeps the picker if declined', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      const send = await open('Pottery', 'pottery', { status: 'used' })
      expect(confirm).not.toHaveBeenCalled()
      ok()
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(send).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Resource 1')).toBeTruthy()
      ok()
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
      const pay = okButton()
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
      const pay = okButton()
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
      expect(summary()).toBe('Boost City F6')
      ok()
      expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['animalHusbandry', expect.any(String), 7, { cityPieceId: 'c2' }])
    })

    it('says so, and sends nothing, when the player has no city', async () => {
      const send = await open('Banking', 'banking', { cities: [] })
      expect(screen.getByRole('dialog').textContent).toContain('You have no city on the map')
      expect(screen.queryByLabelText('City')).toBeNull()
      expect(send).not.toHaveBeenCalled()
    })

    it('confirms a repeat use at submit and keeps the picker if declined', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      const send = await open('Construction', 'construction', { status: 'used' })
      expect(confirm).not.toHaveBeenCalled()
      ok()
      expect(send).not.toHaveBeenCalled()
      expect(screen.getByLabelText('City')).toBeTruthy()
      ok()
      expect(send.mock.calls[0]?.[5]).toBe(true)
    })
  })

  describe('a picker follows the view when what was picked is gone', () => {
    const rerenderable = async (techName: string, kind: string, before: Parameters<typeof abilityView>[2]) => {
      const view = abilityView(techName, kind, before)
      const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
      vi.spyOn(api, 'availableTechs').mockResolvedValue([])
      const utils = render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
      fireEvent.click(await screen.findByText(techName))
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Use ${techName}`) }))
      const show = (after: Parameters<typeof abilityView>[2]) =>
        utils.rerender(<TechPanel gameId="game-1" busy={false} run={run} view={abilityView(techName, kind, after)} reloadCount={0} />)
      return { send, show }
    }

    it('the city that was picked is gone: the city shown is the city sent, also when it is the only one', async () => {
      const { send, show } = await rerenderable('Animal Husbandry', 'animalHusbandry', {})
      fireEvent.change(screen.getByLabelText('City'), { target: { value: 'c2' } })
      show({ cities: [CITIES[0]!] })
      expect((screen.getByLabelText('City') as HTMLSelectElement).value).toBe('c1')
      expect(summary()).toBe('Boost Capital B2')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ cityPieceId: 'c1' })
    })

    it('the only city left is sendable though the picker opened on another', async () => {
      const { send, show } = await rerenderable('Banking', 'banking', {})
      show({ cities: [CITIES[1]!] })
      expect(summary()).toBe('Boost City F6')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ cityPieceId: 'c2' })
    })

    it('the coin counter that was picked is gone: the counter shown is the one sent', async () => {
      const { send, show } = await rerenderable('Mysticism', 'mysticism', {})
      fireEvent.change(screen.getByLabelText('Coin counter'), { target: { value: 'pottery' } })
      show({ opponents: [rival('p2', 'Karandras1', 2, { sheet: 2 }), RIVALS[1]!] })
      expect((screen.getByLabelText('Coin counter') as HTMLSelectElement).value).toBe('sheet')
      expect(summary()).toBe('Discard a coin from Sheet')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ targetId: 'p2', source: 'sheet' })
    })

    it('the player that was picked has left: the player shown is the player sent', async () => {
      const { send, show } = await rerenderable('Horseback Riding', 'horsebackRiding', {})
      fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'p3' } })
      show({ opponents: [RIVALS[0]!] })
      expect(summary()).toBe('Use Horseback Riding on Karandras1')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ targetId: 'p2' })
    })
  })

  describe('the player pickers', () => {
    it('Horseback Riding names another player', async () => {
      const send = await open('Horseback Riding', 'horsebackRiding')
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Karandras1', 'Itchi'])
      expect(screen.queryByPlaceholderText(/optional/)).toBeNull()
      fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'p3' } })
      expect(summary()).toBe('Use Horseback Riding on Itchi')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ targetId: 'p3' })
    })

    it('Writing, Civil Service and Mass Media take free text for what is cancelled, and leave it out when empty', async () => {
      const send = await open('Writing', 'writing')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ targetId: 'p2' })
      cleanup()

      const second = await open('Civil Service', 'civilService')
      fireEvent.change(screen.getByLabelText('Culture event (optional)'), { target: { value: '  Sinbad ' } })
      ok()
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
      expect(summary()).toBe('Discard a coin from Pottery (I)')
      ok()
      expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['mysticism', expect.any(String), 7, { targetId: 'p2', source: 'pottery' }])
    })

    it('shows when the chosen opponent has no coin token, and cannot send', async () => {
      const send = await open('Mysticism', 'mysticism')
      fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'p3' } })
      expect(popup().getByRole('status').textContent).toContain('Itchi holds no coin token.')
      const discard = okButton()
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
    const wonder = (id: string, assetId: string, label: string, ownerId: string | null, disabled = false) => ({
      id, assetId, category: 'wonder', label, ownerId, ...(disabled ? { disabled: true } : {}), x: 10, y: 10, width: 80, height: 80, rotation: 0,
    })
    const WONDERS = [
      wonder('w1', 'wonders/pyramids', 'The Pyramids', 'p2'),
      wonder('w2', 'wonders/stonehenge', 'Stonehenge', 'me'),
      wonder('w3', 'wonders/bigben', 'Big Ben', 'p2'),
      wonder('w4', 'wonders/colossus', 'The Colossus', null),
      wonder('w5', 'wonders/oracle', 'The Oracle', 'p2', true),
    ]

    it('offers both choices when both can be done: obsolete lists the ancient wonders a player owns, not modern, unowned or disabled ones', async () => {
      const send = await open('Monarchy', 'monarchy', { pieces: WONDERS })
      expect(screen.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent?.trim())).toEqual(['Obsolete an ancient wonder', 'Kill a random unit'])
      expect((screen.getByLabelText(/Obsolete an ancient wonder/) as HTMLInputElement).checked).toBe(true)
      expect(screen.queryByLabelText('Player')).toBeNull()
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['The Pyramids (Karandras1)', 'Stonehenge (cash1981)'])
      fireEvent.change(screen.getByLabelText('Wonder'), { target: { value: 'w2' } })
      expect(send).not.toHaveBeenCalled()
      expect(summary()).toBe('Obsolete Stonehenge')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'obsolete', wonderPieceId: 'w2' })
    })

    it('does not offer to obsolete a wonder when no ancient wonder is owned: only the kill choice is shown', async () => {
      const send = await open('Monarchy', 'monarchy', { pieces: [WONDERS[2]!, WONDERS[3]!] })
      expect(screen.queryByRole('radio')).toBeNull()
      expect(screen.queryByLabelText('Wonder')).toBeNull()
      expect(popup().queryByText(/Obsolete/)).toBeNull()
      // Itchi holds no unit card, so there is nothing to kill there: only Karandras1 is offered
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Karandras1 (2 units in hand)'])
      expect(okButton().disabled).toBe(false)
      expect(summary()).toBe('Kill a unit of Karandras1')
      ok()
      expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['monarchy', expect.any(String), 7, { mode: 'kill', targetId: 'p2' }])
    })

    it('opens nothing, and says why, when there is no wonder to obsolete and no unit to kill', async () => {
      const send = await open('Monarchy', 'monarchy', { pieces: [WONDERS[2]!, WONDERS[3]!], opponents: [rival('p3', 'Itchi', 0, {})] })
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(screen.getByRole('dialog').textContent).toContain('Monarchy has nothing to act on')
      expect(send).not.toHaveBeenCalled()
    })

    it('the wonder that was picked is gone: the wonder shown is the wonder sent', async () => {
      const first = abilityView('Monarchy', 'monarchy', { pieces: WONDERS })
      const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(first)
      vi.spyOn(api, 'availableTechs').mockResolvedValue([])
      const { rerender } = render(<TechPanel gameId="game-1" busy={false} run={run} view={first} reloadCount={0} />)
      fireEvent.click(await screen.findByText('Monarchy'))
      fireEvent.click(screen.getByRole('button', { name: /^Use Monarchy/ }))
      fireEvent.change(screen.getByLabelText('Wonder'), { target: { value: 'w2' } })
      rerender(<TechPanel gameId="game-1" busy={false} run={run} view={abilityView('Monarchy', 'monarchy', { pieces: [WONDERS[0]!] })} reloadCount={0} />)
      expect((screen.getByLabelText('Wonder') as HTMLSelectElement).value).toBe('w1')
      expect(summary()).toBe('Obsolete The Pyramids')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'obsolete', wonderPieceId: 'w1' })
    })

    it('kill picks an opponent who holds units, shows how many each holds in the open count, and sends the target', async () => {
      const send = await open('Monarchy', 'monarchy')
      // No wonder on the map: kill is the only choice
      expect(screen.queryByRole('radio')).toBeNull()
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Karandras1 (2 units in hand)'])
      expect((screen.getByLabelText('Player') as HTMLSelectElement).value).toBe('p2')
      expect(summary()).toBe('Kill a unit of Karandras1')
      ok()
      expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['monarchy', expect.any(String), 7, { mode: 'kill', targetId: 'p2' }])
    })

    it('does not offer to kill while a battle is on: only obsolete is shown', async () => {
      const view = { ...abilityView('Monarchy', 'monarchy', { pieces: WONDERS }), battle: { arena: [] } } as unknown as PlayerView
      const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
      vi.spyOn(api, 'availableTechs').mockResolvedValue([])
      render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
      fireEvent.click(await screen.findByText('Monarchy'))
      fireEvent.click(screen.getByRole('button', { name: /^Use Monarchy/ }))
      expect(screen.queryByRole('radio')).toBeNull()
      expect(popup().queryByText(/Kill/)).toBeNull()
      expect(summary()).toBe('Obsolete The Pyramids')
      ok()
      expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'obsolete', wonderPieceId: 'w1' })
    })

    it('does not send anything by choosing a mode, and Cancel closes the popup without sending', async () => {
      const send = await open('Monarchy', 'monarchy', { pieces: WONDERS })
      fireEvent.click(screen.getByLabelText(/Kill a random unit/))
      expect(popup().getByLabelText('Player')).toBeTruthy()
      expect(summary()).toBe('Kill a unit of Karandras1')
      fireEvent.click(screen.getByLabelText(/Obsolete an ancient wonder/))
      expect(send).not.toHaveBeenCalled()
      fireEvent.click(popup().getByRole('button', { name: 'Cancel' }))
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(send).not.toHaveBeenCalled()
    })

    it('a click on the backdrop cancels the popup and leaves the tech dialog open', async () => {
      const send = await open('Monarchy', 'monarchy', { pieces: WONDERS })
      const backdrop = screen.getAllByRole('dialog').at(-1)!.parentElement as HTMLElement
      fireEvent.click(backdrop)
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(send).not.toHaveBeenCalled()
    })

    it('Shift+Tab from the checked radio wraps inside the popup and never reaches the tech dialog underneath', async () => {
      await open('Monarchy', 'monarchy', { pieces: WONDERS })
      const kill = screen.getByLabelText(/Kill a random unit/) as HTMLInputElement
      fireEvent.click(kill)
      kill.focus()
      // A radio group is one tab stop, at the checked radio: that is the first stop of the popup, not the first radio in the markup
      fireEvent.keyDown(kill, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(popup().getByRole('button', { name: 'OK' }))
    })

    it('Escape cancels the popup and leaves the tech dialog open', async () => {
      const send = await open('Monarchy', 'monarchy', { pieces: WONDERS })
      expect(screen.getAllByRole('dialog')).toHaveLength(2)
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
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
    expect(summary()).toBe('Allow an extra action with each city')
    ok()
    expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['atomicTheory', expect.any(String), 7, { mode: 'extraActions' }])
  })

  it('lists every city that is not a capital, the player\'s own included, says what each takes with it, and asks before nuking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const send = await open(atomicView(MAP))
    fireEvent.click(screen.getByLabelText(/Nuke a city/))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['City J10 of Karandras1', 'City B2 of cash1981 (yours)'])
    // The default is another player's city, never the player's own
    expect((screen.getByLabelText('City to nuke') as HTMLSelectElement).value).toBe('city')
    expect(popup().getByText(/Destroys the city/).textContent).toContain('Destroys the city with Library (K10)')
    expect(summary()).toBe('Nuke City J10')
    ok()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'nuke', cityPieceId: 'city' })
  })

  it('offers the player\'s own city only when it is picked, says it is their own when asking, and sends it', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const send = await open(atomicView(MAP))
    fireEvent.click(screen.getByLabelText(/Nuke a city/))
    expect((screen.getByLabelText('City to nuke') as HTMLSelectElement).value).toBe('city')
    fireEvent.change(screen.getByLabelText('City to nuke'), { target: { value: 'mine' } })
    expect(summary()).toBe('Nuke City B2')
    ok()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('(your own city)'))
    expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'nuke', cityPieceId: 'mine' })
  })

  it('with only the player\'s own cities nothing is preselected and the button waits until one is picked', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const send = await open(atomicView(MAP.filter((entry) => (entry as { id: string }).id !== 'city')))
    fireEvent.click(screen.getByLabelText(/Nuke a city/))
    expect((screen.getByLabelText('City to nuke') as HTMLSelectElement).value).toBe('')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a city', 'City B2 of cash1981 (yours)'])
    const nuke = okButton()
    expect(nuke.disabled).toBe(true)
    fireEvent.click(nuke)
    expect(send).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('City to nuke'), { target: { value: 'mine' } })
    expect(summary()).toBe('Nuke City B2')
    ok()
    // A confirm still guards it
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'nuke', cityPieceId: 'mine' })
  })

  it('does not offer a nuke when there is no city to nuke: only the extra action is shown', async () => {
    const send = await open(atomicView(MAP.filter((entry) => !['city', 'mine'].includes((entry as { id: string }).id))))
    expect(screen.queryByLabelText(/Nuke a city/)).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByLabelText('City to nuke')).toBeNull()
    expect(summary()).toBe('Allow an extra action with each city')
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'extraActions' })
  })

  it('asks about a repeat use when the player submits, and keeps the picker if declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const send = await open(atomicView(MAP, 'used'))
    expect(confirm).not.toHaveBeenCalled()
    ok()
    expect(send).not.toHaveBeenCalled()
    ok()
    expect(send.mock.calls[0]?.[5]).toBe(true)
  })

  it('opens on the mode of the phase the player has open: Movement is a nuke, City Management an extra action', async () => {
    const inPhase = (phase: string): PlayerView => ({ ...atomicView(MAP), active: true, activeTurn: { turnNumber: 1, waitingFor: [{ username: 'cash1981', phase }] } }) as unknown as PlayerView
    await open(inPhase('MOVEMENT'))
    expect((screen.getByLabelText(/Nuke a city/) as HTMLInputElement).checked).toBe(true)
    cleanup()
    await open(inPhase('CM'))
    expect((screen.getByLabelText(/An extra action with each city/) as HTMLInputElement).checked).toBe(true)
  })

  it('the city to nuke that was picked is gone: the city shown is the city sent', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const twoCities = [...MAP, piece('city2', 'cities/bluecity2', 'city', 'Blue city 2', 12, 12)]
    const first = atomicView(twoCities)
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(first)
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const { rerender } = render(<TechPanel gameId="game-1" busy={false} run={run} view={first} reloadCount={0} />)
    fireEvent.click(await screen.findByText('Atomic Theory'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Atomic Theory/ }))
    fireEvent.click(screen.getByLabelText(/Nuke a city/))
    fireEvent.change(screen.getByLabelText('City to nuke'), { target: { value: 'city2' } })
    rerender(<TechPanel gameId="game-1" busy={false} run={run} view={atomicView(MAP.filter((entry) => (entry as { id: string }).id !== 'mine'))} reloadCount={0} />)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['City J10 of Karandras1'])
    expect(summary()).toBe('Nuke City J10')
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ mode: 'nuke', cityPieceId: 'city' })
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

describe('Gunpowder obsolete or destroy in the tech dialog (issue #327)', () => {
  const board = createBoard()
  const at = (column: number, row: number) => ({ x: column * board.squareSize + 10, y: mapTop(board) + row * board.squareSize + 10, width: 60, height: 60, rotation: 0 })
  const building = (id: string, assetId: string, label: string, column: number, row: number) => ({ id, assetId, category: 'building', label, ...at(column, row) })
  const wonder = (id: string, assetId: string, label: string, ownerId: string | null, disabled = false) => ({
    id, assetId, category: 'wonder', label, ownerId, ...(disabled ? { disabled: true } : {}), ...at(14, 2),
  })
  const BLUE = {
    playerId: 'p2', username: 'Karandras1', color: 'Blue', civilization: null, revealedTechs: [], numberOfTechsChosen: 0, pyramidPlacements: [],
    publicHand: { units: 0, cultureCards: 0, huts: 0, villages: 0, greatPersons: 0 }, stats: { coinSources: {} },
  }
  const PIECES = [
    { id: 'c1', assetId: 'cities/bluecity2', category: 'city', label: 'Blue city', ...at(9, 9) },
    building('b1', 'buildings/library', 'Library', 10, 9),
    building('b2', 'buildings/market', 'Market', 4, 4),
    wonder('w1', 'wonders/pyramids', 'The Pyramids', 'p2'),
    wonder('w2', 'wonders/machupichu', 'Machu Pichu', 'me'),
    wonder('w3', 'wonders/bigben', 'Big Ben', 'p2'),
    wonder('w4', 'wonders/colossus', 'The Colossus', null),
    wonder('w5', 'wonders/oracle', 'The Oracle', 'p2', true),
  ]
  const viewWith = (pieces: readonly object[], status = 'ready'): PlayerView => {
    const base = viewOf([tech('Gunpowder', 3)])
    return {
      ...base,
      board: { ...board, pieces },
      boardAreas: [],
      opponents: [BLUE],
      you: { ...base.you!, color: 'Red', items: [], availableActions: [action('gunpowder', 'Gunpowder', status, 'Ready to use.')] },
    } as unknown as PlayerView
  }
  const open = async (view: PlayerView) => {
    const send = vi.spyOn(api, 'actionWithArgs').mockResolvedValue(view)
    vi.spyOn(api, 'availableTechs').mockResolvedValue([])
    const utils = render(<TechPanel gameId="game-1" busy={false} run={run} view={view} reloadCount={0} />)
    fireEvent.click(await screen.findByText('Gunpowder'))
    fireEvent.click(screen.getByRole('button', { name: /^Use Gunpowder/ }))
    return { send, ...utils }
  }

  it('opens on obsolete when a wonder can be chosen, lists ancient and medieval wonders a player owns, and sends the piece with the two resources', async () => {
    const { send } = await open(viewWith(PIECES))
    expect((screen.getByLabelText(/Obsolete an ancient or medieval wonder/) as HTMLInputElement).checked).toBe(true)
    // Not the modern Big Ben, the unowned Colossus or the disabled Oracle
    expect(screen.getAllByRole('option').filter((option) => option.closest('select')?.getAttribute('aria-label') === 'Wonder').map((option) => option.textContent)).toEqual([
      'The Pyramids (Karandras1)',
      'Machu Pichu (cash1981)',
    ])
    fireEvent.change(screen.getByLabelText('Wonder'), { target: { value: 'w2' } })
    expect(send).not.toHaveBeenCalled()
    ok()
    expect(send.mock.calls[0]?.slice(1, 5)).toEqual(['gunpowder', expect.any(String), 7, { ...namedPayment('Iron', 'Wheat'), mode: 'obsolete', wonderPieceId: 'w2' }])
  })

  it('the destroy mode lists every building on a map square with its square and whose outskirts, and sends the piece', async () => {
    const { send } = await open(viewWith(PIECES))
    fireEvent.click(screen.getByLabelText(/Destroy a building/))
    expect(screen.getAllByRole('option').filter((option) => option.closest('select')?.getAttribute('aria-label') === 'Building').map((option) => option.textContent)).toEqual([
      "Library on K10 (Karandras1's outskirts)",
      'Market on E5 (no single owner)',
    ])
    fireEvent.change(screen.getByLabelText('Building'), { target: { value: 'b2' } })
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ ...namedPayment('Iron', 'Wheat'), mode: 'destroy', buildingPieceId: 'b2' })
  })

  it('does not offer to obsolete a wonder when no ancient or medieval wonder is owned: only destroy is shown', async () => {
    const { send } = await open(viewWith(PIECES.filter((entry) => (entry as { category: string }).category !== 'wonder')))
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByLabelText('Wonder')).toBeNull()
    expect(popup().queryByText(/Obsolete/)).toBeNull()
    expect(okButton().disabled).toBe(false)
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ ...namedPayment('Iron', 'Wheat'), mode: 'destroy', buildingPieceId: 'b1' })
  })

  it('does not offer to destroy a building when none stands on the map: only obsolete is shown', async () => {
    const { send } = await open(viewWith(PIECES.filter((entry) => (entry as { category: string }).category !== 'building')))
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByLabelText('Building')).toBeNull()
    expect(popup().queryByText(/Destroy/)).toBeNull()
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ ...namedPayment('Iron', 'Wheat'), mode: 'obsolete', wonderPieceId: 'w1' })
  })

  it('opens nothing, and says why, when there is neither a wonder to obsolete nor a building to destroy', async () => {
    const { send } = await open(viewWith([]))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog').textContent).toContain('Gunpowder has nothing to act on')
    expect(send).not.toHaveBeenCalled()
  })

  it('the wonder or building that was picked is gone: the one shown is the one sent', async () => {
    const { send, rerender } = await open(viewWith(PIECES))
    fireEvent.change(screen.getByLabelText('Wonder'), { target: { value: 'w2' } })
    rerender(<TechPanel gameId="game-1" busy={false} run={run} view={viewWith(PIECES.filter((entry) => (entry as { id: string }).id !== 'w2'))} reloadCount={0} />)
    expect((screen.getByLabelText('Wonder') as HTMLSelectElement).value).toBe('w1')
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ ...namedPayment('Iron', 'Wheat'), mode: 'obsolete', wonderPieceId: 'w1' })
  })

  it('the button names the target it sends: after a refresh removes the picked building the new target is named and sent', async () => {
    const { send, rerender } = await open(viewWith(PIECES))
    fireEvent.click(screen.getByLabelText(/Destroy a building/))
    fireEvent.change(screen.getByLabelText('Building'), { target: { value: 'b2' } })
    expect(summary()).toBe('Destroy Market on E5 (pay Iron and Wheat)')
    rerender(<TechPanel gameId="game-1" busy={false} run={run} view={viewWith(PIECES.filter((entry) => (entry as { id: string }).id !== 'b2'))} reloadCount={0} />)
    expect((screen.getByLabelText('Building') as HTMLSelectElement).value).toBe('b1')
    expect(summary()).toBe('Destroy Library on K10 (pay Iron and Wheat)')
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ ...namedPayment('Iron', 'Wheat'), mode: 'destroy', buildingPieceId: 'b1' })
  })

  it('a chosen mode that disappears is not swapped for another: nothing is chosen and OK waits', async () => {
    const { send, rerender } = await open(viewWith(PIECES))
    fireEvent.click(screen.getByLabelText(/Destroy a building/))
    rerender(<TechPanel gameId="game-1" busy={false} run={run} view={viewWith(PIECES.filter((entry) => (entry as { category: string }).category !== 'building'))} reloadCount={0} />)
    expect(okButton().disabled).toBe(true)
    expect(popup().getByRole('status').textContent).toContain('no longer possible')
    expect((screen.getByLabelText(/Obsolete an ancient or medieval wonder/) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(okButton())
    expect(send).not.toHaveBeenCalled()
    // Choosing again works
    fireEvent.click(screen.getByLabelText(/Obsolete an ancient or medieval wonder/))
    expect(okButton().disabled).toBe(false)
  })

  it('names the wonder it will obsolete, and the group says what it holds', async () => {
    const { send } = await open(viewWith(PIECES))
    expect(screen.getByRole('dialog', { name: 'Gunpowder' })).toBeTruthy()
    expect(summary()).toBe('Obsolete The Pyramids (pay Iron and Wheat)')
    ok()
    expect(send.mock.calls[0]?.[4]).toEqual({ ...namedPayment('Iron', 'Wheat'), mode: 'obsolete', wonderPieceId: 'w1' })
  })

  it('asks about a repeat use when the player pays, keeps the picker if declined, and a busy page cannot send', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const used = viewWith(PIECES, 'used')
    const { send, rerender } = await open(used)
    expect(confirm).not.toHaveBeenCalled()
    ok()
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Wonder')).toBeTruthy()
    rerender(<TechPanel gameId="game-1" busy={true} run={run} view={used} reloadCount={0} />)
    expect(okButton().disabled).toBe(true)
    rerender(<TechPanel gameId="game-1" busy={false} run={run} view={used} reloadCount={0} />)
    ok()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[5]).toBe(true)
  })
})
