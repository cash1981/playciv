// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { BattlePanel, type Run } from './GameView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    placeUnitInArena: vi.fn(),
    moveArenaUnit: vi.fn(),
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

describe('BattlePanel mobile placement', () => {
  beforeEach(() => {
    vi.mocked(api.placeUnitInArena).mockResolvedValue(view)
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
})
