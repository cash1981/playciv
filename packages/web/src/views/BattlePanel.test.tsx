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
    zhukovWound: vi.fn(),
    techWound: vi.fn(),
    performAction: vi.fn(),
    actionWithArgs: vi.fn(),
  },
  // The assisted action buttons of the Battle panel read it when a press fails
  ApiError: class ApiError extends Error {
    status = 0
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

  it('lists Gustavus Adolphus before any battle, since he works on the units drawn for it, and no other battle card', () => {
    const gustavus = { ...leonidas, itemId: 'gp-3', name: 'Gustavus Adolphus', discards: true, gustavus: { count: 2, sheets: ['INFANTRY'] } }
    const idle = { ...view, battle: null, you: { ...view.you, stats: { trade: 5 }, playableCards: [gustavus, leonidas] } } as unknown as PlayerView
    const { getByText, container } = render(<BattlePanel gameId="game" busy={false} run={run} view={idle} />)
    fireEvent.click(getByText('Battle'))
    const list = container.querySelector('[aria-label="Battle cards"]')
    expect(list?.textContent).toContain('Gustavus Adolphus')
    expect(list?.textContent).not.toContain('Leonidas')
  })

  it('lists the battle cards once, not again in the arena', () => {
    const { getByText, container } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView(attacking, { playableCards: [leonidas] })} />,
    )
    fireEvent.click(getByText('Battle'))
    expect(container.querySelectorAll('[aria-label="Battle cards"]')).toHaveLength(1)
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

  it('disables the Sun Tzu pass while every General figure is blockaded', () => {
    const { getByText } = render(
      <BattlePanel
        gameId="game"
        busy={false}
        run={run}
        view={battleView(attacking, { items: [sunTzu], stats: { trade: 5 }, blockadedGreatPersonTypes: ['General'] })}
      />,
    )
    fireEvent.click(getByText('Battle'))
    const button = getByText('Pass with Sun Tzu (3 trade)') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toContain('blockaded')
  })

  it('lists a saved unit that another unit replaced on its front', () => {
    const departed = { id: 'a-1', side: 'attacker', position: 0, unit: infantry, attack: 1, health: 0, placedBy: 'me', rotation: 0, killed: true, saved: true, arrival: null }
    const { getByText, container } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={battleView({ ...attacking, arena: [], departedUnits: [departed] }, {})} />,
    )
    fireEvent.click(getByText('Battle'))
    expect(container.querySelector('[aria-label="Saved casualties"]')?.textContent).toContain('SAVED')
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

describe('BattlePanel Zhukov', () => {
  afterEach(() => cleanup())

  const unit = (id: string, side: 'attacker' | 'defender', killed: boolean, position: number) => ({
    id, side, position, unit: { ...infantry, id: `card-${id}` }, attack: 1, health: 3, placedBy: side === 'attacker' ? 'me' : 'other',
    rotation: 0, killed, arrival: null,
  })
  const zhukovView = (zhukov: object[], killedOwn: boolean): PlayerView =>
    ({
      ...view,
      you: { ...view.you, stats: { trade: 5 } },
      battle: {
        ...view.battle,
        arena: [unit('a1', 'attacker', killedOwn, 0), unit('d1', 'defender', false, 1), unit('d2', 'defender', true, 2)],
        zhukov,
      },
    }) as unknown as PlayerView
  const entry = { playerId: 'me', deadIds: [], dealt: 0, actionId: 'x' }

  it('offers a wound on each living enemy unit while one is owed, and sends the chosen unit', () => {
    vi.mocked(api.zhukovWound).mockResolvedValue(view)
    const { getByText, queryAllByText } = render(<BattlePanel gameId="game" busy={false} run={run} view={zhukovView([entry], true)} />)
    fireEvent.click(getByText('Battle'))
    expect(getByText(/Georgy Zhukov: deal 1 wound to an enemy unit/)).toBeTruthy()
    // The killed enemy unit is not offered
    expect(queryAllByText(/^Wound /)).toHaveLength(1)
    fireEvent.click(queryAllByText(/^Wound /)[0] as HTMLElement)
    expect(api.zhukovWound).toHaveBeenCalledWith('game', 'd1', 4)
  })

  it('disables the wounds while every General figure is blockaded', () => {
    const blockaded = { ...zhukovView([entry], true), you: { ...zhukovView([entry], true).you, blockadedGreatPersonTypes: ['General'] } } as unknown as PlayerView
    const { getByText, queryAllByText } = render(<BattlePanel gameId="game" busy={false} run={run} view={blockaded} />)
    fireEvent.click(getByText('Battle'))
    expect((queryAllByText(/^Wound /)[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers nothing when no wound is owed, or he was not played', () => {
    const none = render(<BattlePanel gameId="game" busy={false} run={run} view={zhukovView([entry], false)} />)
    fireEvent.click(none.getByText('Battle'))
    expect(none.queryByText(/Georgy Zhukov: deal/)).toBeNull()
    cleanup()
    const unplayed = render(<BattlePanel gameId="game" busy={false} run={run} view={zhukovView([], true)} />)
    fireEvent.click(unplayed.getByText('Battle'))
    expect(unplayed.queryByText(/Georgy Zhukov: deal/)).toBeNull()
  })
})

describe('BattlePanel Mathematics and Ballistics', () => {
  // The panel remembers whether it was left open, so each test starts closed and the click below opens it
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const unit = (id: string, side: 'attacker' | 'defender', killed: boolean, position: number) => ({
    id, side, position, unit: { ...infantry, id: `card-${id}` }, attack: 1, health: 3, placedBy: side === 'attacker' ? 'me' : 'other',
    rotation: 0, killed, arrival: null,
  })
  const action = (kind: string, label: string, status: string) => ({
    action: kind, label, phase: 'ANY', group: 'Battle', status, reason: `${label} is ${status}`, repeatable: true, techName: label, buttonText: `Use ${label} (Iron)`,
  })
  const techView = (techWounds: object[], availableActions: object[], combatant = true): PlayerView =>
    ({
      ...view,
      you: { ...view.you, playerId: combatant ? 'me' : 'bystander', stats: { trade: 5 }, availableActions },
      battle: {
        ...view.battle,
        arena: [unit('a1', 'attacker', false, 0), unit('d1', 'defender', false, 1), unit('d2', 'defender', true, 2)],
        techWounds,
      },
    }) as unknown as PlayerView

  it('shows the Mathematics button, which pays the Iron through the assisted action', async () => {
    vi.mocked(api.performAction).mockResolvedValue(view)
    const { getByText, getByRole } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={techView([], [action('mathematics', 'Mathematics', 'ready')])} />,
    )
    fireEvent.click(getByText('Battle'))
    expect(getByRole('group', { name: 'Mathematics wounds' })).toBeTruthy()
    fireEvent.click(getByText('Use Mathematics (Iron)'))
    expect(api.performAction).toHaveBeenCalledWith('game', 'mathematics', expect.any(String), 4)
  })

  it('offers a wound on each living enemy unit while wounds are owed, and sends the tech and the unit', () => {
    vi.mocked(api.techWound).mockResolvedValue(view)
    const owed = { playerId: 'me', tech: 'Ballistics', total: 6, dealt: 2, actionId: 'x' }
    const { getByText, queryAllByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={techView([owed], [action('ballistics', 'Ballistics', 'used')])} />,
    )
    fireEvent.click(getByText('Battle'))
    expect(getByText(/Ballistics: deal up to 4 wounds, one to an enemy unit at a time/)).toBeTruthy()
    // The killed enemy unit and own units are not offered
    expect(queryAllByText(/^Wound /)).toHaveLength(1)
    fireEvent.click(queryAllByText(/^Wound /)[0] as HTMLElement)
    expect(api.techWound).toHaveBeenCalledWith('game', 'Ballistics', 'd1', 4)
  })

  it('lists nothing without the tech, for a player outside the battle, or for a spectator', () => {
    const none = render(<BattlePanel gameId="game" busy={false} run={run} view={techView([], [action('mathematics', 'Mathematics', 'not-owned')])} />)
    fireEvent.click(none.getByText('Battle'))
    expect(none.queryByText(/Mathematics/)).toBeNull()
    cleanup()
    const bystander = render(<BattlePanel gameId="game" busy={false} run={run} view={techView([], [action('mathematics', 'Mathematics', 'ready')], false)} />)
    fireEvent.click(bystander.getByText('Battle'))
    expect(bystander.queryByText(/Mathematics/)).toBeNull()
    cleanup()
    const spectator = render(<BattlePanel gameId="game" busy={false} run={run} readOnly view={techView([{ playerId: 'me', tech: 'Mathematics', total: 3, dealt: 0, actionId: 'x' }], [action('mathematics', 'Mathematics', 'used')])} />)
    fireEvent.click(spectator.getByText('Battle'))
    expect((spectator.queryAllByText(/^Wound /)[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('stops offering wounds once all have been dealt', () => {
    const spent = { playerId: 'me', tech: 'Mathematics', total: 3, dealt: 3, actionId: 'x' }
    const { getByText, queryByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={techView([spent], [action('mathematics', 'Mathematics', 'used')])} />,
    )
    fireEvent.click(getByText('Battle'))
    expect(queryByText(/Mathematics: deal up to/)).toBeNull()
  })
})

describe('BattlePanel Metalworking', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const unit = (id: string, side: 'attacker' | 'defender', killed: boolean, position: number, placedBy: string) => ({
    id, side, position, unit: { ...infantry, id: `card-${id}` }, attack: 1, health: 3, placedBy, rotation: 0, killed, arrival: null,
  })
  const action = (status: string) => ({
    action: 'metalworking', label: 'Metalworking', phase: 'ANY', group: 'Battle', status, reason: `Metalworking is ${status}`, repeatable: true, techName: 'Metalworking', buttonText: 'Use Metalworking (Iron: +3 attack)',
  })
  const metalView = (status = 'ready', arena = [unit('a1', 'attacker', false, 0, 'me'), unit('a2', 'attacker', true, 1, 'me'), unit('a3', 'attacker', false, 2, 'me'), unit('d1', 'defender', false, 3, 'other')]): PlayerView =>
    ({ ...view, you: { ...view.you, availableActions: [action(status)] }, battle: { ...view.battle, arena, techWounds: [] } }) as unknown as PlayerView

  it('lists the button next to Mathematics and Ballistics, and asks which of the player\'s own living units gets the attack', () => {
    vi.mocked(api.actionWithArgs).mockResolvedValue(view)
    const { getByText, getByRole, getAllByRole, getByLabelText } = render(<BattlePanel gameId="game" busy={false} run={run} view={metalView()} />)
    fireEvent.click(getByText('Battle'))
    expect(getByRole('group', { name: 'Metalworking' })).toBeTruthy()
    fireEvent.click(getByText('Use Metalworking (Iron: +3 attack)'))
    expect(api.actionWithArgs).not.toHaveBeenCalled()
    // Only the player's own living units: not the killed one, not the enemy
    expect(getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('front 1'),
      expect.stringContaining('front 3'),
    ])
    fireEvent.change(getByLabelText('Unit'), { target: { value: 'a3' } })
    fireEvent.click(getByRole('button', { name: 'OK' }))
    expect(api.actionWithArgs).toHaveBeenCalledWith('game', 'metalworking', expect.any(String), 4, { arenaUnitId: 'a3' }, false)
  })

  it('also offers a unit that fell the moment it was placed, while the round it fought can still be fought again, and no other dead unit', () => {
    const alive = { health: 3, killed: false }
    const fell = (opponentAfter: { health: number; killed: boolean }) => ({
      ...unit('a2', 'attacker', true, 0, 'me'),
      health: 0,
      arrival: { displacedId: null, faceOff: { opponentId: 'd1', opponentBefore: alive, opponentAfter, selfBefore: alive, selfAfter: { health: 0, killed: true } } },
    })
    const enemy = { ...unit('d1', 'defender', false, 0, 'other'), health: 2 }
    const options = (arena: object[]) => {
      const { getByText, queryAllByRole, unmount } = render(<BattlePanel gameId="game" busy={false} run={run} view={metalView('ready', arena as ReturnType<typeof unit>[])} />)
      fireEvent.click(getByText('Battle'))
      fireEvent.click(getByText('Use Metalworking (Iron: +3 attack)'))
      const found = queryAllByRole('option').length
      unmount()
      return found
    }
    // The opponent still has what the round left it with: the fallen unit may take the boost
    expect(options([fell({ health: 2, killed: false }), enemy])).toBe(1)
    // The opponent was wounded since (a hand edit or a Zhukov wound): there is no round to fight again
    expect(options([fell({ health: 1, killed: false }), enemy])).toBe(0)
  })

  it('the unit that was picked is gone: the unit shown is the unit sent', () => {
    vi.mocked(api.actionWithArgs).mockResolvedValue(view)
    const { getByText, getByRole, getByLabelText, rerender } = render(<BattlePanel gameId="game" busy={false} run={run} view={metalView()} />)
    fireEvent.click(getByText('Battle'))
    fireEvent.click(getByText('Use Metalworking (Iron: +3 attack)'))
    fireEvent.change(getByLabelText('Unit'), { target: { value: 'a3' } })
    // The unit a3 is killed; a1 is the only one left and must be what is shown and sent
    rerender(<BattlePanel gameId="game" busy={false} run={run} view={metalView('ready', [unit('a1', 'attacker', false, 0, 'me'), unit('a3', 'attacker', true, 2, 'me'), unit('d1', 'defender', false, 3, 'other')])} />)
    expect((getByLabelText('Unit') as HTMLSelectElement).value).toBe('a1')
    fireEvent.click(getByRole('button', { name: 'OK' }))
    expect(api.actionWithArgs).toHaveBeenCalledWith('game', 'metalworking', expect.any(String), 4, { arenaUnitId: 'a1' }, false)
  })

  it('says so when no unit of the player stands in the arena, and sends nothing', () => {
    const { getByText } = render(<BattlePanel gameId="game" busy={false} run={run} view={metalView('ready', [unit('d1', 'defender', false, 1, 'other')])} />)
    fireEvent.click(getByText('Battle'))
    fireEvent.click(getByText('Use Metalworking (Iron: +3 attack)'))
    expect(getByText('You have no living unit of your own in the arena.')).toBeTruthy()
    expect(api.actionWithArgs).not.toHaveBeenCalled()
  })

  it('asks about a repeat use at submit, and a used or read-only panel cannot send', () => {
    vi.mocked(api.actionWithArgs).mockResolvedValue(view)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const used = render(<BattlePanel gameId="game" busy={false} run={run} view={metalView('used')} />)
    fireEvent.click(used.getByText('Battle'))
    fireEvent.click(used.getByText('Use Metalworking (Iron: +3 attack)'))
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(used.getByRole('button', { name: 'OK' }))
    expect(api.actionWithArgs).not.toHaveBeenCalled()
    fireEvent.click(used.getByRole('button', { name: 'OK' }))
    expect(api.actionWithArgs).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.actionWithArgs).mock.calls[0]?.[5]).toBe(true)
    cleanup()

    const readOnly = render(<BattlePanel gameId="game" busy={false} run={run} readOnly view={metalView()} />)
    fireEvent.click(readOnly.getByText('Battle'))
    expect((readOnly.getByText('Use Metalworking (Iron: +3 attack)') as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists nothing outside a battle the player fights in', () => {
    const none = render(<BattlePanel gameId="game" busy={false} run={run} view={{ ...metalView(), you: { ...metalView().you, playerId: 'bystander' } } as unknown as PlayerView} />)
    fireEvent.click(none.getByText('Battle'))
    expect(none.queryByText(/Metalworking/)).toBeNull()
  })
})
