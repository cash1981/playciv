/**
 * Chat orders (issue #215): copying the classic turn orders into the timeline
 * the first time it is switched on. The engine only decides when (once) and what
 * (the public history); the server writes the rows.
 */

import { describe, expect, it } from 'vitest'

import { revealTurnOrder, setChatOrders, updateTurn } from '../src/actions/turn.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'
import type { TurnPhase } from '../src/turn.js'
import { publicOrderVersions } from '../src/turn.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

const write = (
  state: GameState,
  playerId: string,
  turnNumber: number,
  phase: TurnPhase,
  order: string,
  at?: string,
): GameState => {
  const written = unwrap(updateTurn(state, { playerId, turnNumber, phase, order }))
  return at === undefined
    ? written
    : unwrap(revealTurnOrder(written, { playerId, turnNumber, phase, at }))
}

describe('legacyOrdersCopied', () => {
  it('is false in a new game and not in the player view', () => {
    const state = firstCivGame()
    expect(state.legacyOrdersCopied).toBe(false)
    expect(Object.keys(toPlayerView(state, CASH1981))).not.toContain('legacyOrdersCopied')
  })

  it('is set by the first switch-on and by nothing before it', () => {
    const off = firstCivGame()
    expect(unwrap(setChatOrders(off, false)).legacyOrdersCopied).toBe(false)

    const on = unwrap(setChatOrders(off, true, 't0'))
    expect(on.legacyOrdersCopied).toBe(true)
  })

  it('stays set when chat orders is switched off and on again', () => {
    let state = unwrap(setChatOrders(firstCivGame(), true, 't0'))
    state = unwrap(setChatOrders(state, false, 't1'))
    expect(state.legacyOrdersCopied).toBe(true)
    state = unwrap(setChatOrders(state, true, 't2'))
    expect(state.legacyOrdersCopied).toBe(true)
    // Switching on while it is on changes nothing
    expect(unwrap(setChatOrders(state, true))).toBe(state)
  })

  it('migrates to false for an old save, and to true for a game already in chat mode', () => {
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['legacyOrdersCopied']
    expect(migrateGameState(old as unknown as GameState).legacyOrdersCopied).toBe(false)

    const inChatMode = { ...old, chatOrders: true }
    expect(migrateGameState(inChatMode as unknown as GameState).legacyOrdersCopied).toBe(true)
    // What is stored wins
    expect(migrateGameState({ ...firstCivGame(), legacyOrdersCopied: true }).legacyOrdersCopied).toBe(true)
  })
})

describe('publicOrderVersions', () => {
  it('returns every revealed version, oldest first, with its owner, turn and phase', () => {
    let state = firstCivGame()
    state = write(state, KARANDRAS1, 1, 'TRADE', 'karandras trade', '2026-01-01T10:00:00.000Z')
    state = write(state, CASH1981, 1, 'SOT', 'cash first', '2026-01-01T09:00:00.000Z')
    // Edited and revealed again: both versions are public history
    state = write(state, CASH1981, 1, 'SOT', 'cash second', '2026-01-01T11:00:00.000Z')
    state = write(state, CASH1981, 2, 'CM', 'cash turn two', '2026-01-02T09:00:00.000Z')

    expect(publicOrderVersions(state).map((v) => [v.username, v.turnNumber, v.phase, v.markdown, v.index])).toEqual([
      ['cash1981', 1, 'SOT', 'cash first', 0],
      ['Karandras1', 1, 'TRADE', 'karandras trade', 0],
      ['cash1981', 1, 'SOT', 'cash second', 1],
      ['cash1981', 2, 'CM', 'cash turn two', 0],
    ])
  })

  it('never returns a draft that was not revealed, or a private note', () => {
    let state = firstCivGame()
    state = write(state, CASH1981, 1, 'SOT', 'public order', '2026-01-01T09:00:00.000Z')
    state = write(state, CASH1981, 1, 'TRADE', 'SECRET-DRAFT')
    // Edited after the reveal: the new text is private until it is revealed again
    state = write(state, CASH1981, 1, 'SOT', 'SECRET-EDIT')
    state = {
      ...state,
      players: state.players.map((player) =>
        player.playerId === CASH1981 ? { ...player, gamenote: 'SECRET-NOTE' } : player,
      ),
    }

    const versions = publicOrderVersions(state)

    expect(versions.map((v) => v.markdown)).toEqual(['public order'])
    expect(JSON.stringify(versions)).not.toContain('SECRET')
  })

  it('leaves out a version with no usable time instead of inventing one', () => {
    let state = write(firstCivGame(), CASH1981, 1, 'SOT', 'good', '2026-01-01T09:00:00.000Z')
    const key = '1cash1981'
    const turn = state.publicTurns[key]
    if (turn === undefined) throw new Error('no public turn')
    state = {
      ...state,
      publicTurns: {
        ...state.publicTurns,
        [key]: {
          ...turn,
          history: {
            ...turn.history,
            SOT: [
              { markdown: 'no time', at: '' },
              { markdown: 'garbage time', at: 'yesterday' },
              ...turn.history.SOT,
            ],
          },
        },
      },
    }

    const versions = publicOrderVersions(state)

    expect(versions.map((v) => v.markdown)).toEqual(['good'])
    // The index is the place in the history, so it stays stable when others are skipped
    expect(versions[0]?.index).toBe(2)
  })

  it('has nothing for an order revealed before versions were kept', () => {
    const state = write(firstCivGame(), CASH1981, 1, 'SOT', 'old order', '2026-01-01T09:00:00.000Z')
    const key = '1cash1981'
    const turn = state.publicTurns[key]
    if (turn === undefined) throw new Error('no public turn')
    const legacy = { ...state, publicTurns: { ...state.publicTurns, [key]: { ...turn, history: { ...turn.history, SOT: [] } } } }
    expect(publicOrderVersions(legacy)).toEqual([])
  })
})
