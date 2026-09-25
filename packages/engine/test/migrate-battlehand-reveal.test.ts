/**
 * Found from a live game report: `revealAndDiscardBattlehand` used to only
 * build the public log message, never actually revealing the units it named
 * (see decisions.md, and the fix itself in `actions/draw.ts`). A game saved
 * before that fix still has those specific units stuck `hidden: true`, even
 * though the log already publicly named them, so they never showed in the
 * Revealed/Discarded panel.
 */

import { describe, expect, it } from 'vitest'

import {
  draw,
  drawUnitsForBattle,
  formatBattlehandRevealPublicLog,
  revealAndDiscardBattlehand,
} from '../src/actions/draw.js'
import { revealAll } from '../src/item.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap } from '../src/result.js'
import type { GameState, Playerhand } from '../src/state.js'
import { findPlayer, withPlayer } from '../src/state.js'

import { CASH1981, firstCivGame } from './fixture.js'

/** Re-hides items by id, simulating a save from before the fix existed. */
function reHide(state: GameState, playerId: string, itemIds: ReadonlySet<string>): GameState {
  const player = findPlayer(state, playerId)
  if (player === undefined) throw new Error('missing player')
  return withPlayer(state, {
    ...player,
    items: player.items.map((item) => (itemIds.has(item.id) ? { ...item, hidden: true } : item)),
  })
}

function handOf(state: GameState, playerId: string): Playerhand {
  const player = findPlayer(state, playerId)
  if (player === undefined) throw new Error('missing player')
  return player
}

describe('migrating a pre-fix battlehand reveal', () => {
  it('reveals the exact units an old save\'s log line already named', () => {
    let state = firstCivGame()
    for (const sheetName of ['INFANTRY', 'ARTILLERY', 'MOUNTED'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }
    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 3 }))
    const revealedIds = new Set(handOf(state, CASH1981).battlehand.map((u) => u.id))
    state = unwrap(revealAndDiscardBattlehand(state, CASH1981))

    // Simulate an old save: the log already says these are public, but the
    // (pre-fix) action never actually flipped `hidden`.
    const broken = reHide(state, CASH1981, revealedIds)
    expect(
      handOf(broken, CASH1981).items.filter((item) => revealedIds.has(item.id) && item.hidden),
    ).toHaveLength(3)

    const migrated = migrateGameState(broken)
    const stillNamed = handOf(migrated, CASH1981).items.filter((item) => revealedIds.has(item.id))
    expect(stillNamed).toHaveLength(3)
    expect(stillNamed.every((item) => !item.hidden)).toBe(true)
  })

  it('never reveals a unit the log did not name', () => {
    let state = firstCivGame()
    for (const sheetName of ['INFANTRY', 'ARTILLERY', 'MOUNTED', 'MOUNTED'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }
    state = unwrap(drawUnitsForBattle(state, { playerId: CASH1981, numberOfDraws: 2 }))
    const revealedIds = new Set(handOf(state, CASH1981).battlehand.map((u) => u.id))
    state = unwrap(revealAndDiscardBattlehand(state, CASH1981))
    const broken = reHide(state, CASH1981, revealedIds)

    const migrated = migrateGameState(broken)
    const untouched = handOf(migrated, CASH1981).items.filter(
      (item) => !revealedIds.has(item.id) && item.sheetName !== 'INFANTRY' && item.hidden,
    )
    // At least one of the four drawn units was never in the battlehand and
    // must stay exactly as hidden as it started.
    expect(untouched.length).toBeGreaterThan(0)
  })

  it('leaves both units hidden when a display name is ambiguous (the accepted residual risk)', () => {
    // Two hidden units that report the identical revealAll() display name
    // (same kind/attack/health/level, different card), but the old log line
    // names that label only once. Migration must not guess which one it was.
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'MOUNTED' }))
    const player = handOf(state, CASH1981)
    const original = player.items.find((item) => item.sheetName === 'MOUNTED')
    if (original === undefined) throw new Error('missing drawn mounted unit')
    expect(original.hidden).toBe(true)

    const duplicate = { ...original, id: 'duplicate-mounted', itemNumber: original.itemNumber + 1000 }
    expect(revealAll(duplicate)).toBe(revealAll(original))

    // No battlehand draw needed: build the log line directly, exactly as
    // `revealAndDiscardBattlehand` would have (one name, naming only
    // `original`, `duplicate` never mentioned).
    state = withPlayer(state, { ...player, items: [...player.items, duplicate] })
    state = {
      ...state,
      log: [
        ...state.log,
        {
          id: 'log-battlehand-reveal',
          username: 'cash1981',
          logType: null,
          privateLog: '',
          publicLog: formatBattlehandRevealPublicLog('cash1981', revealAll(original)),
          item: null,
          playerId: CASH1981,
          undo: null,
          createdAt: null,
        },
      ],
    }

    const migrated = migrateGameState(state)
    const originalStill = handOf(migrated, CASH1981).items.find((item) => item.id === original.id)
    const duplicateStill = handOf(migrated, CASH1981).items.find((item) => item.id === duplicate.id)
    expect(originalStill?.hidden).toBe(true)
    expect(duplicateStill?.hidden).toBe(true)
  })

  it('reveals both when the log names a duplicate label exactly as many times as it appears', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'MOUNTED' }))
    const player = handOf(state, CASH1981)
    const original = player.items.find((item) => item.sheetName === 'MOUNTED')
    if (original === undefined) throw new Error('missing drawn mounted unit')

    const duplicate = { ...original, id: 'duplicate-mounted-2', itemNumber: original.itemNumber + 2000 }
    state = withPlayer(state, { ...player, items: [...player.items, duplicate] })
    state = {
      ...state,
      log: [
        ...state.log,
        {
          id: 'log-battlehand-reveal-2',
          username: 'cash1981',
          logType: null,
          privateLog: '',
          publicLog: formatBattlehandRevealPublicLog(
            'cash1981',
            `${revealAll(original)}, ${revealAll(duplicate)}`,
          ),
          item: null,
          playerId: CASH1981,
          undo: null,
          createdAt: null,
        },
      ],
    }

    const migrated = migrateGameState(state)
    const originalStill = handOf(migrated, CASH1981).items.find((item) => item.id === original.id)
    const duplicateStill = handOf(migrated, CASH1981).items.find((item) => item.id === duplicate.id)
    expect(originalStill?.hidden).toBe(false)
    expect(duplicateStill?.hidden).toBe(false)
  })
})
