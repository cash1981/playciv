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
    const { container, getByText } = render(
      <BattlePanel gameId="game" busy={false} run={run} view={view} />,
    )

    fireEvent.click(getByText('Battle'))
    const card = container.querySelector('li.card')
    expect(card).not.toBeNull()
    fireEvent.click(card as HTMLElement)
    expect(getByText('Selected unit. Tap an empty front to place it.')).toBeTruthy()

    const slot = container.querySelector('.arena-slot-empty')
    expect(slot).not.toBeNull()
    fireEvent.click(slot as HTMLElement)
    expect(vi.mocked(api.placeUnitInArena)).toHaveBeenCalledWith(
      'game', 'unit-1', 'attacker', 0, 1, 3, 4,
    )
  })
})
