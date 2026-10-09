/**
 * The two stored flags of the old move to the single chat (issue #215). The
 * admin tool that set them is gone; the flags stay so that old saved games load
 * exactly as before, and a new game still starts with both set.
 */

import { describe, expect, it } from 'vitest'

import { migrateGameState } from '../src/migrate.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'

import { CASH1981, CHUL, KARANDRAS1, firstCivGame } from './fixture.js'

describe('legacyOrdersCopied', () => {
  it('is true in a new game, which writes its orders to the timeline itself, and not in the player view', () => {
    const state = firstCivGame()
    expect(state.legacyOrdersCopied).toBe(true)
    expect(Object.keys(toPlayerView(state, CASH1981))).not.toContain('legacyOrdersCopied')
  })

  it('migrates to false for an old save, and to true for a game already in chat mode', () => {
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['legacyOrdersCopied']
    expect(migrateGameState(old as unknown as GameState).legacyOrdersCopied).toBe(false)

    const inChatMode = { ...old, chatOrders: true }
    expect(migrateGameState(inChatMode as unknown as GameState).legacyOrdersCopied).toBe(true)
    // What is stored wins
    expect(migrateGameState({ ...firstCivGame(), legacyOrdersCopied: true }).legacyOrdersCopied).toBe(true)
    expect(migrateGameState({ ...firstCivGame(), legacyOrdersCopied: false }).legacyOrdersCopied).toBe(false)
  })
})

describe('legacyRevealsCopied', () => {
  it('is true in a new game and not in the player view or in any seat of it', () => {
    const state = firstCivGame()
    expect(state.legacyRevealsCopied).toBe(true)
    for (const playerId of [CASH1981, KARANDRAS1, CHUL]) {
      const view = toPlayerView(state, playerId)
      expect(Object.keys(view)).not.toContain('legacyRevealsCopied')
      expect(JSON.stringify(view)).not.toContain('legacyRevealsCopied')
    }
  })

  it('migrates to false when missing and keeps what is stored, so it survives a load and save', () => {
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['legacyRevealsCopied']
    const loaded = migrateGameState(old as unknown as GameState)
    expect(loaded.legacyRevealsCopied).toBe(false)
    // Saved as true, loaded again: still true
    const saved = JSON.parse(JSON.stringify({ ...loaded, legacyRevealsCopied: true })) as GameState
    expect(migrateGameState(saved).legacyRevealsCopied).toBe(true)
    expect(migrateGameState(migrateGameState(saved)).legacyRevealsCopied).toBe(true)
    // Independent of legacyOrdersCopied
    expect(migrateGameState({ ...firstCivGame(), legacyOrdersCopied: false, legacyRevealsCopied: true }).legacyRevealsCopied).toBe(true)
  })
})
