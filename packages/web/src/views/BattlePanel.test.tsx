// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { BattlePanel, type Run } from './GameView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    drawBarbarians: vi.fn(),
    drawBattlehand: vi.fn(),
    revealBattlehand: vi.fn(),
    endBattle: vi.fn(),
    initiateBattle: vi.fn(),
    placeUnitInArena: vi.fn(),
    moveArenaUnit: vi.fn(),
    setArenaUnitStat: vi.fn(),
    sunTzuPass: vi.fn(),
  },
}))

const infantry = {
  kind: 'infantry', sheetName: 'INFANTRY', id: 'unit-1', itemNumber: 1,
  description: null, used: false, hidden: false, ownerId: 'me',
  attack: 1, health: 3, level: 0, killed: false, inBattle: false,
} as const

const view = {
  you: { playerId: 'me', battlehand: [infantry], barbarians: [], items: [] },
  opponents: [],
  battle: {
    attacker: { playerId: 'me', kind: 'player' },
    defender: { playerId: 'other', kind: 'player' },
    turn: 'attacker', arena: [], departedUnits: [],
  },
  battleSummary: [], rev: 4,
} as unknown as PlayerView

const run: Run = async (action) => { await action() }

describe('BattlePanel summary bar', () => {
  afterEach(() => cleanup())

  it('does not show ATK in the summary', () => {
    const summaryView = {
      ...view,
      battleSummary: [
        { side: 'attacker', kind: 'player', playerId: 'me', label: 'Me', unitCount: 1, totalAttack: 2, totalHealth: 3, combatBonus: 0 },
      ],
    } as unknown as PlayerView
    const { getByText, container } = render(<BattlePanel gameId="game" busy={false} run={run} view={summaryView} />)
    fireEvent.click(getByText('Battle'))

    const bar = container.querySelector('.battle-summary')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain('HP 3')
    expect(bar?.textContent).not.toMatch(/ATK/)
  })

  it('shows what the defended city adds, and that ending the battle removes its fortification', () => {
    const summaryView = {
      ...view,
      battleSummary: [
        {
          side: 'defender', kind: 'player', playerId: 'me', label: 'Me',
          unitCount: 1, totalAttack: 1, totalHealth: 3, combatBonus: 8,
          cityDefence: {
            cityPieceId: 'city', cityLabel: 'City D4', total: 8, fortificationPieceId: 'fort',
            parts: [{ label: 'Defending a city', amount: 6 }, { label: 'Fortification', amount: 2 }],
          },
        },
      ],
    } as unknown as PlayerView
    const { getByText } = render(<BattlePanel gameId="game" busy={false} run={run} view={summaryView} />)
    fireEvent.click(getByText('Battle'))

    expect(getByText('HP 3 (+8)')).toBeTruthy()
    expect(
      getByText('Defending City D4: +8 (Defending a city +6, Fortification +2). Ending the battle removes the fortification.'),
    ).toBeTruthy()
  })

  it('shows a positive combat bonus next to HP, not ATK', () => {
    const summaryView = {
      ...view,
      battleSummary: [
        {
          side: 'attacker', kind: 'player', playerId: 'me', label: 'Me',
          unitCount: 1, totalAttack: 1, totalHealth: 3, combatBonus: 6,
        },
      ],
    } as unknown as PlayerView
    const { getByText } = render(<BattlePanel gameId="game" busy={false} run={run} view={summaryView} />)
    fireEvent.click(getByText('Battle'))

    expect(getByText('HP 3 (+6)')).toBeTruthy()
  })

  // The engine no longer produces a negative bonus (issue #197); this only pins the formatting.
  it('shows a negative combat bonus next to HP, not ATK', () => {
    const summaryView = {
      ...view,
      battleSummary: [
        {
          side: 'attacker', kind: 'player', playerId: 'me', label: 'Me',
          unitCount: 1, totalAttack: 1, totalHealth: 3, combatBonus: -2,
        },
      ],
    } as unknown as PlayerView
    const { getByText } = render(<BattlePanel gameId="game" busy={false} run={run} view={summaryView} />)
    fireEvent.click(getByText('Battle'))

    expect(getByText('HP 3 (-2)')).toBeTruthy()
  })

  it('shows no suffix on HP when the combat bonus is zero', () => {
    const summaryView = {
      ...view,
      battleSummary: [
        {
          side: 'attacker', kind: 'player', playerId: 'me', label: 'Me',
          unitCount: 1, totalAttack: 1, totalHealth: 3, combatBonus: 0,
        },
      ],
    } as unknown as PlayerView
    const { getByText } = render(<BattlePanel gameId="game" busy={false} run={run} view={summaryView} />)
    fireEvent.click(getByText('Battle'))

    expect(getByText('HP 3')).toBeTruthy()
  })
})

describe('BattlePanel summary follows typed HP', () => {
  afterEach(() => cleanup())
  beforeEach(() => vi.clearAllMocks())

  function unit(id: string, side: 'attacker' | 'defender', position: number, health: number, killed = false) {
    return {
      id, side, position, unit: { ...infantry, inBattle: true },
      attack: 1, health, placedBy: 'me', rotation: 0, killed,
    }
  }

  const twoUnitView = {
    ...view,
    you: { ...view.you, battlehand: [] },
    battle: { ...view.battle, arena: [unit('a1', 'attacker', 0, 3), unit('d1', 'defender', 0, 2)] },
    battleSummary: [
      { side: 'attacker', kind: 'player', playerId: 'me', label: 'Me', unitCount: 1, totalAttack: 1, totalHealth: 3, combatBonus: 4 },
      { side: 'defender', kind: 'player', playerId: 'other', label: 'Other', unitCount: 1, totalAttack: 1, totalHealth: 2, combatBonus: 0 },
    ],
  } as unknown as PlayerView

  it('updates the summary as soon as an HP field is edited, before any save', () => {
    const { container, getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={twoUnitView} />,
    )
    fireEvent.click(getByText('Battle'))
    expect(getByText('HP 3 (+4)')).toBeTruthy()

    const hpInputs = container.querySelectorAll('.arena-unit-card label input')
    // Each card has ATK then HP; the attacker's HP field is the second input.
    fireEvent.change(hpInputs[1] as HTMLElement, { target: { value: '1' } })

    expect(getByText('HP 1 (+4)')).toBeTruthy()
    expect(getByText('HP 2')).toBeTruthy()
    expect(vi.mocked(api.setArenaUnitStat)).not.toHaveBeenCalled()
  })

  it('lets the server value take over when it arrives', () => {
    const { container, getByText, rerender } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={twoUnitView} />,
    )
    fireEvent.click(getByText('Battle'))
    fireEvent.change(container.querySelectorAll('.arena-unit-card label input')[1] as HTMLElement, { target: { value: '1' } })

    // Someone else set the unit to 2 in the meantime; the server value wins.
    const saved = {
      ...twoUnitView,
      battle: { ...twoUnitView.battle, arena: [unit('a1', 'attacker', 0, 2), unit('d1', 'defender', 0, 2)] },
      battleSummary: [
        { ...twoUnitView.battleSummary[0], totalHealth: 2 },
        twoUnitView.battleSummary[1],
      ],
    } as unknown as PlayerView
    rerender(<BattlePanel gameId="game" busy={false} run={run} view={saved} />)

    expect(getByText('HP 2 (+4)')).toBeTruthy()
  })

  it('does not count a killed unit, with or without a typed HP', () => {
    const killedView = {
      ...twoUnitView,
      battle: { ...twoUnitView.battle, arena: [unit('a1', 'attacker', 0, 3, true), unit('a2', 'attacker', 1, 2), unit('d1', 'defender', 0, 2)] },
      battleSummary: [
        { ...twoUnitView.battleSummary[0], unitCount: 1, totalHealth: 2 },
        twoUnitView.battleSummary[1],
      ],
    } as unknown as PlayerView
    const { container, getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={killedView} />,
    )
    fireEvent.click(getByText('Battle'))
    const inputs = container.querySelectorAll('.arena-unit-card label input')
    // Cards: a1 (killed), a2, d1; HP is each card's second input. Type over the killed one, then the living one.
    fireEvent.change(inputs[1] as HTMLElement, { target: { value: '9' } })
    expect(getByText('HP 2 (+4)')).toBeTruthy()
    fireEvent.change(inputs[3] as HTMLElement, { target: { value: '5' } })
    expect(getByText('HP 5 (+4)')).toBeTruthy()
  })
})

describe('BattlePanel mobile placement', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.mocked(api.placeUnitInArena).mockResolvedValue(view)
    vi.mocked(api.moveArenaUnit).mockResolvedValue(view)
    Object.assign(HTMLElement.prototype, {
      setPointerCapture: () => undefined,
      releasePointerCapture: () => undefined,
      hasPointerCapture: () => true,
    })
  })

  it('selects a battlehand unit and places it by tapping an arena front', () => {
    const { container, getByText, queryByText, rerender } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={view} />,
    )

    fireEvent.click(getByText('Battle'))
    const card = container.querySelector('li.card')
    expect(card).not.toBeNull()
    fireEvent.click(card as HTMLElement)
    expect(getByText('Selected unit. Tap a destination front to place or move it.')).toBeTruthy()

    rerender(
      <BattlePanel
        gameId="game" busy={false} run={run}
        view={{ ...view, you: { ...view.you, battlehand: [{ ...infantry, inBattle: true }] } } as unknown as PlayerView}
      />,
    )
    expect(queryByText('Selected unit. Tap a destination front to place or move it.')).toBeNull()

    rerender(<BattlePanel gameId="game" busy={false} run={run} view={view} />)
    fireEvent.click(container.querySelector('li.card') as HTMLElement)
    rerender(
      <BattlePanel
        gameId="game" busy={false} run={run}
        view={{
          ...view,
          battle: {
            ...view.battle,
            attacker: { playerId: 'other-a', kind: 'player' },
            defender: { playerId: 'other-b', kind: 'player' },
          },
        } as unknown as PlayerView}
      />,
    )
    expect(queryByText('Selected unit. Tap a destination front to place or move it.')).toBeNull()
    rerender(<BattlePanel gameId="game" busy={false} run={run} view={view} />)
    fireEvent.click(container.querySelector('li.card') as HTMLElement)

    const slot = container.querySelector('.arena-slot-empty')
    expect(slot).not.toBeNull()
    expect((slot as HTMLElement).closest('.arena-slot')?.classList.contains('valid-destination')).toBe(true)
    fireEvent.click(slot as HTMLElement)
    expect(vi.mocked(api.placeUnitInArena)).toHaveBeenCalledWith(
      'game', 'unit-1', 'attacker', 0, 1, 3, 4,
    )
  })

  it('drags a selected arena unit to another front with touch pointers', () => {
    const arenaUnit = {
      id: 'arena-1', side: 'attacker', position: 0, unit: { ...infantry, inBattle: true },
      attack: 1, health: 3, placedBy: 'me', rotation: 0, killed: false,
    }
    const arenaView = {
      ...view,
      you: { ...view.you, battlehand: [] },
      battle: { ...view.battle, arena: [arenaUnit] },
    } as unknown as PlayerView
    const { container, getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={arenaView} />,
    )
    fireEvent.click(getByText('Battle'))
    const card = container.querySelector('li.card') as HTMLElement
    fireEvent.click(card)
    const destination = container.querySelectorAll('.arena-slot')[1] as HTMLElement
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => destination })
    const dispatchPointer = (type: string, pointerId: number, isPrimary: boolean, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, {
        pointerId: { value: pointerId }, isPrimary: { value: isPrimary }, pointerType: { value: 'touch' },
        button: { value: 0 }, clientX: { value: x }, clientY: { value: 10 },
      })
      card.dispatchEvent(event)
    }
    dispatchPointer('pointerdown', 7, true, 10)
    dispatchPointer('pointerdown', 8, false, 10)
    dispatchPointer('pointermove', 8, false, 30)
    dispatchPointer('pointerup', 8, false, 30)
    expect(vi.mocked(api.moveArenaUnit)).not.toHaveBeenCalled()
    dispatchPointer('pointermove', 7, true, 30)
    dispatchPointer('pointerup', 7, true, 30)
    expect(vi.mocked(api.moveArenaUnit)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.moveArenaUnit)).toHaveBeenCalledWith('game', 'arena-1', 1, 4)
  })
})


describe('BattlePanel independent barbarian draw', () => {
  afterEach(() => cleanup())
  beforeEach(() => vi.clearAllMocks())

  const idleView = { ...view, battle: null } as PlayerView

  it('draws its own barbarians with the current game revision before a battle exists', () => {
    const { getByText } = render(<BattlePanel gameId="game" busy={false} run={run} view={idleView} />)
    fireEvent.click(getByText('Battle'))
    fireEvent.click(getByText('Draw barbarians'))
    expect(api.drawBarbarians).toHaveBeenCalledWith('game', 4)
  })

  it.each([
    ['busy or read-only', idleView, true],
    ['spectator', { ...idleView, you: null }, false],
    ['existing barbarian hand', { ...idleView, you: { ...idleView.you, barbarians: [infantry] } }, false],
    ['barbarians placed in an arena', { ...idleView, you: { ...idleView.you, barbarians: [{ ...infantry, inBattle: true }] } }, false],
    ['active battle', view, false],
  ] as const)('disables drawing for %s', (_reason, disabledView, busy) => {
    const { getByText } = render(<BattlePanel gameId="game" busy={busy} run={run} view={disabledView as PlayerView} />)
    fireEvent.click(getByText('Battle'))
    const button = getByText('Draw barbarians') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(api.drawBarbarians).not.toHaveBeenCalled()
  })
})


describe('BattlePanel read-only', () => {
  afterEach(() => cleanup())
  beforeEach(() => vi.clearAllMocks())

  const idleView = { ...view, battle: null } as PlayerView

  it('disables the battle controls for a spectator', () => {
    const { container, getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={{ ...idleView, you: null } as PlayerView} />,
    )
    fireEvent.click(getByText('Battle'))

    expect((getByText('Draw battlehand') as HTMLButtonElement).disabled).toBe(true)
    expect((getByText('Draw barbarians') as HTMLButtonElement).disabled).toBe(true)
    expect((getByText('Start battle') as HTMLButtonElement).disabled).toBe(true)
    expect((container.querySelector('select') as HTMLSelectElement).disabled).toBe(true)
    expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(getByText('Draw battlehand'))
    fireEvent.click(getByText('Start battle'))
    expect(api.drawBattlehand).not.toHaveBeenCalled()
    expect(api.initiateBattle).not.toHaveBeenCalled()
  })

  it('disables every mutation for a read-only view of a player', () => {
    const { container, getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={idleView} readOnly />,
    )
    fireEvent.click(getByText('Battle'))

    for (const name of ['Draw battlehand', 'Reveal', 'Draw barbarians', 'Discard', 'Start battle']) {
      expect((getByText(name) as HTMLButtonElement).disabled).toBe(true)
    }
    expect((container.querySelector('select') as HTMLSelectElement).disabled).toBe(true)
  })

  it('disables the arena rotate button and the ATK/HP fields in a read-only view', () => {
    const arenaUnit = {
      id: 'arena-1',
      side: 'defender',
      position: 0,
      unit: { ...infantry, inBattle: true },
      attack: 1,
      health: 3,
      placedBy: 'other',
      rotation: 0,
      killed: false,
    }
    const arenaView = {
      ...view,
      you: { ...view.you, battlehand: [] },
      battle: { ...view.battle, arena: [arenaUnit] },
    } as unknown as PlayerView
    const { container, getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={arenaView} readOnly />,
    )
    fireEvent.click(getByText('Battle'))

    expect((getByText('⟲ Rotate') as HTMLButtonElement).disabled).toBe(true)
    const fields = container.querySelectorAll<HTMLInputElement>('.arena-unit-card input')
    expect(fields).toHaveLength(2)
    for (const field of fields) expect(field.disabled).toBe(true)
  })
})

describe('BattlePanel battle cards', () => {
  afterEach(() => cleanup())

  const sunTzu = { kind: 'greatperson', name: 'Sun Tzu', id: 'gp-1', hidden: true, ownerId: 'me', type: 'General' }
  const leonidas = {
    itemId: 'gp-2', name: 'Leonidas', kind: 'greatPerson', description: 'Battle: ...', inEffect: false,
    timings: ['BATTLE'], targets: { kind: 'none' }, prompt: '', resources: [], automatic: 'adds 8 to your combat bonus',
    passive: false, discards: false, coinSources: [], substituteResources: [], status: 'ready', reason: 'Ready',
  }
  const battleView = (battle: object, you: object): PlayerView =>
    ({ ...view, battle, you: { ...view.you, stats: { trade: 5 }, ...you } }) as unknown as PlayerView
  const attacking = { ...view.battle, turn: 'attacker' }

  it('lists a ready battle card with its Play button to a combatant', () => {
    const { getByText, container } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView(attacking, { playableCards: [leonidas] })} />,
    )
    fireEvent.click(getByText('Battle'))
    const list = container.querySelector('[aria-label="Battle cards"]')
    expect(list?.textContent).toContain('Leonidas')
    // Leonidas is kept faceup, so his button says Use
    expect(list?.querySelector('button')?.textContent).toMatch(/Use|Play/)
  })

  it('lists Florence Nightingale right after End battle, when no battle is on, and no other battle card', () => {
    const florence = { ...leonidas, itemId: 'gp-4', name: 'Florence Nightingale', discards: true }
    const afterwards = { ...view, battle: null, you: { ...view.you, stats: { trade: 5 }, playableCards: [florence, leonidas] } } as unknown as PlayerView
    const { getByText, container } = render(<BattlePanel gameId="game" busy={false} run={run} view={afterwards} />)
    fireEvent.click(getByText('Battle'))
    const list = container.querySelector('[aria-label="Battle cards"]')
    expect(list?.textContent).toContain('Florence Nightingale')
    expect(list?.textContent).not.toContain('Leonidas')
  })

  it('lists no battle card to someone outside the battle', () => {
    const outsider = { ...attacking, attacker: { playerId: 'x', kind: 'player' }, defender: { playerId: 'y', kind: 'player' } }
    const { getByText, queryByText, container } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView(outsider, { playableCards: [leonidas], items: [sunTzu] })} />,
    )
    fireEvent.click(getByText('Battle'))
    expect(container.querySelector('[aria-label="Battle cards"]')).toBeNull()
    expect(queryByText(/Pass with Sun Tzu/)).toBeNull()
  })

  it('passes the turn with Sun Tzu for 3 trade, once per battle', () => {
    vi.mocked(api.sunTzuPass).mockResolvedValue(view)
    const { getByText, queryByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView(attacking, { items: [sunTzu] })} />,
    )
    fireEvent.click(getByText('Battle'))
    fireEvent.click(getByText('Pass with Sun Tzu (3 trade)'))
    expect(api.sunTzuPass).toHaveBeenCalledWith('game', 4)
    cleanup()
    const used = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView({ ...attacking, sunTzu: ['me'] }, { items: [sunTzu] })} />,
    )
    fireEvent.click(used.getByText('Battle'))
    expect(queryByText('Pass with Sun Tzu (3 trade)')).toBeNull()
  })

  it('disables the Sun Tzu pass on the other side\'s battle turn', () => {
    const { getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView({ ...attacking, turn: 'defender' }, { items: [sunTzu] })} />,
    )
    fireEvent.click(getByText('Battle'))
    expect((getByText('Pass with Sun Tzu (3 trade)') as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables the Sun Tzu pass without 3 trade', () => {
    const { getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView(attacking, { items: [sunTzu], stats: { trade: 2 } })} />,
    )
    fireEvent.click(getByText('Battle'))
    expect((getByText('Pass with Sun Tzu (3 trade)') as HTMLButtonElement).disabled).toBe(true)
  })

  it('marks a saved unit', () => {
    const killedSaved = {
      id: 'a1', side: 'attacker', position: 0, unit: infantry, attack: 1, health: 3, placedBy: 'me',
      rotation: 0, killed: true, saved: true, arrival: null,
    }
    const { getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView({ ...attacking, arena: [killedSaved] }, {})} />,
    )
    fireEvent.click(getByText('Battle'))
    expect(getByText('SAVED')).toBeTruthy()
  })
})
