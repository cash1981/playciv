// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArenaUnit } from '@civ/engine'
import type { PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { ArenaUnitCard, BattlePanel, type Run } from './GameView.js'

vi.mock('../lib/api.js', () => ({
  api: {
    setArenaUnitStat: vi.fn(),
    drawBattlehand: vi.fn(),
  },
}))

const card: ArenaUnit['unit'] = {
  kind: 'infantry', sheetName: 'INFANTRY', id: 'unit-1', itemNumber: 1,
  description: null, used: false, hidden: false, ownerId: 'me',
  attack: 1, health: 3, level: 0, killed: false, inBattle: true,
}

const arenaUnit: ArenaUnit = {
  id: 'arena-1', side: 'attacker', position: 0, unit: card, attack: 1, health: 3,
  placedBy: 'me', rotation: 0, killed: false,
}

const run: Run = async (action) => { await action() }
const noop = () => undefined

function renderCard(): ReturnType<typeof render> {
  return render(
    <ArenaUnitCard
      unit={arenaUnit} gameId="game-1" busy={false} rev={7} run={run}
      canManage={false} canMove={false} onDragStart={noop} onDragEnd={noop}
    />,
  )
}

describe('battle number fields', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(api.setArenaUnitStat).mockResolvedValue({} as PlayerView)
    vi.mocked(api.drawBattlehand).mockResolvedValue({} as PlayerView)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('saves HP 1 when 1 is typed over a 0, and shows 1 not 01', () => {
    const { getByLabelText } = renderCard()
    const hp = getByLabelText('HP') as HTMLInputElement
    fireEvent.change(hp, { target: { value: '0' } })
    fireEvent.change(hp, { target: { value: '01' } })
    expect(hp.value).toBe('1')
    act(() => { vi.advanceTimersByTime(700) })
    expect(api.setArenaUnitStat).toHaveBeenCalledTimes(1)
    expect(api.setArenaUnitStat).toHaveBeenCalledWith('game-1', 'arena-1', 'health', 1, 7)
  })

  it('saves ATK under the attack key and 0 for an emptied field', () => {
    const { getByLabelText } = renderCard()
    fireEvent.change(getByLabelText('ATK'), { target: { value: '' } })
    act(() => { vi.advanceTimersByTime(700) })
    expect(api.setArenaUnitStat).toHaveBeenCalledWith('game-1', 'arena-1', 'attack', 0, 7)
  })

  it('draws at least 1 and at most 20, and shows the value it uses', () => {
    const view = { you: { playerId: 'me', battlehand: [], barbarians: [], items: [] }, opponents: [], battle: null, battleSummary: [], rev: 1 } as unknown as PlayerView
    const { getByText, getAllByRole } = render(<BattlePanel gameId="game" busy={false} run={run} view={view} />)
    fireEvent.click(getByText('Battle'))
    const count = getAllByRole('textbox')[0] as HTMLInputElement

    fireEvent.change(count, { target: { value: '0' } })
    fireEvent.blur(count)
    expect(count.value).toBe('1')
    fireEvent.click(getByText('Draw battlehand'))
    expect(api.drawBattlehand).toHaveBeenLastCalledWith('game', 1)

    fireEvent.change(count, { target: { value: '50' } })
    fireEvent.click(getByText('Draw battlehand'))
    expect(api.drawBattlehand).toHaveBeenLastCalledWith('game', 20)
    fireEvent.blur(count)
    expect(count.value).toBe('20')
  })
})
