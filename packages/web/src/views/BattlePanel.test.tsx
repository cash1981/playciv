// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { BattlePanel, type Run } from './GameView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    placeUnitInArena: vi.fn(),
    moveArenaUnit: vi.fn(),
    setArenaUnitStat: vi.fn(),
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
