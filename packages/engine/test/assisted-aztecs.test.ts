/**
 * The Aztecs' free units for Great Persons (`src/assisted-aztecs.ts`): two credits for every Great Person
 * gained, one free unit card of an unlocked type per credit. The credits are server-only.
 */

import { describe, expect, it } from 'vitest'

import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, performAssistedAction, reverseAssistedAction } from '../src/assisted.js'
import { AZTEC_ACTIONS } from '../src/assisted-aztecs.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { AssistedActionKind, GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { AT, advanceTurn } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1 } from './fixture.js'
import { armyTakesRelic, keepReward } from './assisted-aztecs-fixture.js'

const me = (state: GameState) => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('fixture player missing')
  return found
}

const act = (state: GameState, action: AssistedActionKind, requestId: string) =>
  performAssistedAction(state, { playerId: CASH1981, action, requestId, at: AT })

const status = (state: GameState, action: AssistedActionKind) => assistedAvailability(state, CASH1981, action)

const credits = (state: GameState): number => state.aztecFreeUnits?.[CASH1981] ?? 0

const units = (state: GameState): number =>
  me(state).items.filter((item) => ['infantry', 'artillery', 'mounted', 'aircraft'].includes(item.kind)).length

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI, CHUL]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

/** An Aztec player one step before a Great Person space, who presses Advance: one Great Person is kept at once. */
const aztecs = (options: { readonly civ?: string; readonly techs?: readonly string[] } = {}): GameState =>
  advanceTurn({ step: 2, civ: options.civ ?? 'Aztecs', ...(options.techs === undefined ? {} : { techs: options.techs }) })

/** A Great Person from the advance and another one from the School of Confucius. */
const stacked = (): GameState => keepReward(armyTakesRelic(gained(aztecs()), 'relics/school_of_confucius'), 'choose')

const gained = (state: GameState, requestId = 'gain'): GameState => unwrap(act(state, 'cultureAdvance', requestId))

describe('the credits for a Great Person', () => {
  it('gives the Aztecs 2 for a Great Person kept at once, and says so in the lines', () => {
    const done = gained(aztecs())
    expect(credits(done)).toBe(2)
    const line = done.log.find((entry) => entry.assistedActionId === 'gain')
    expect(line?.publicLog).toMatch(/great person marker into reserve \(item number #\d+\) and, as the Aztecs, may build 2 free units$/)
    // The private line has the new total in parentheses
    expect(done.log.some((entry) => entry.privateLog.includes('gains 2 (2) free units as the Aztecs'))).toBe(true)
  })

  it('gives nothing to any other civilization', () => {
    const done = gained(aztecs({ civ: 'Japanese' }))
    expect(credits(done)).toBe(0)
    expect(done.aztecFreeUnits).toBeUndefined()
    expect(JSON.stringify(done.log)).not.toContain('Aztecs')
  })

  it('counts a Great Person that is kept after a choice, not the ones drawn', () => {
    const taken = armyTakesRelic(aztecs({ civ: 'Aztecs' }), 'relics/school_of_confucius')
    expect(me(taken).pendingRewards).toHaveLength(1)
    expect(credits(taken)).toBe(0)
    const kept = keepReward(taken, 'choose')
    expect(credits(kept)).toBe(2)
    expect(kept.log.some((entry) => entry.publicLog.includes('great person marker into reserve') && entry.publicLog.endsWith('may build 2 free units'))).toBe(true)
  })

  it('stacks: a second Great Person gives 2 more', () => {
    expect(credits(stacked())).toBe(4)
  })
})

describe('the free unit buttons', () => {
  it('has one button per unit type, in no phase in particular', () => {
    expect(AZTEC_ACTIONS.map((definition) => definition.kind)).toEqual([
      'aztecs:infantry',
      'aztecs:artillery',
      'aztecs:mounted',
      'aztecs:aircraft',
    ])
    expect(AZTEC_ACTIONS.every((definition) => definition.phase === 'ANY')).toBe(true)
  })

  it('are blocked until a Great Person has been gained, and ready after, with the count', () => {
    const before = aztecs()
    expect(status(before, 'aztecs:infantry').status).toBe('unavailable')
    const after = gained(before)
    expect(status(after, 'aztecs:infantry')).toMatchObject({ status: 'ready', reason: expect.stringContaining('(2 of 2 left)') })
    expect(status(after, 'aztecs:mounted').status).toBe('ready')
  })

  it('are not for another civilization', () => {
    expect(status(gained(aztecs({ civ: 'Japanese' })), 'aztecs:infantry').status).toBe('not-owned')
  })

  it('offer aircraft only with Flight', () => {
    const without = gained(aztecs())
    expect(status(without, 'aztecs:aircraft').status).toBe('not-owned')
    const withFlight = gained(aztecs({ techs: ['Flight'] }))
    expect(status(withFlight, 'aztecs:aircraft').status).toBe('ready')
  })

  it('offer no type that has no card left', () => {
    const done = gained(aztecs())
    const empty: GameState = {
      ...done,
      items: done.items.filter((item) => item.sheetName !== 'INFANTRY'),
      discardedItems: done.discardedItems.filter((item) => item.sheetName !== 'INFANTRY'),
    }
    expect(status(empty, 'aztecs:infantry')).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('No infantry unit cards') })
    expect(status(empty, 'aztecs:artillery').status).toBe('ready')
    expect(unwrapErr(act(empty, 'aztecs:infantry', 'use')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })
})

describe('using a credit', () => {
  it('draws one unit card of the type, uses one credit, and can be done twice but not a third time', () => {
    const base = gained(aztecs())
    const first = unwrap(act(base, 'aztecs:infantry', 'use-1'))
    expect(units(first)).toBe(units(base) + 1)
    expect(credits(first)).toBe(1)
    expect(status(first, 'aztecs:mounted')).toMatchObject({ status: 'ready', reason: expect.stringContaining('(1 of 2 left)') })
    const second = unwrap(act(first, 'aztecs:mounted', 'use-2'))
    expect(credits(second)).toBe(0)
    expect(status(second, 'aztecs:infantry').status).toBe('unavailable')
    expect(unwrapErr(act(second, 'aztecs:infantry', 'use-3')).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('names the type in the public line and the card only in the private one', () => {
    const used = unwrap(act(gained(aztecs()), 'aztecs:infantry', 'use'))
    const card = me(used).items.at(-1)
    if (card === undefined) throw new Error('no card')
    const publicLine = used.log.find((entry) => entry.assistedActionId === 'use')?.publicLog ?? ''
    expect(publicLine).toContain('a free infantry unit as the Aztecs')
    expect(publicLine).not.toContain(itemName(card))
    expect(used.log.some((entry) => entry.privateLog.includes(`drew ${itemName(card)}`) || entry.privateLog.includes('as the Aztecs, 1 free units left'))).toBe(true)
  })

  it('goes back on undo: the card in its deck and the credit returned', () => {
    const base = gained(aztecs())
    const used = unwrap(act(base, 'aztecs:infantry', 'use'))
    const undone = undoByVote(used, 'use')
    expect(units(undone)).toBe(units(base))
    expect(credits(undone)).toBe(2)
    expect(undone.items.length).toBe(base.items.length)
    expect(status(undone, 'aztecs:infantry').status).toBe('ready')
  })

  it('refuses the undo when the card has left the hand', () => {
    const used = unwrap(act(gained(aztecs()), 'aztecs:infantry', 'use'))
    const card = me(used).items.at(-1)
    const gone: GameState = {
      ...used,
      players: used.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => item.id !== card?.id) } : p)),
    }
    expect(unwrapErr(reverseAssistedAction(gone, 'use', AT)).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })
})

describe('undoing the Great Person', () => {
  it('takes both credits back when none is used, and says so without numbers in the public line', () => {
    const base = aztecs()
    const undone = undoByVote(gained(base), 'gain')
    expect(credits(undone)).toBe(0)
    expect(status(undone, 'aztecs:infantry').status).toBe('unavailable')
    const system = undone.log.filter((entry) => entry.publicLog.startsWith('System:')).at(-1)?.publicLog ?? ''
    expect(system).toContain('the free units it gave the Aztecs were taken back as far as they were unused')
    expect(system).not.toContain('2 free')
    expect(undone.log.some((entry) => entry.privateLog.includes('loses 2 (0) free Aztec units'))).toBe(true)
  })

  it('takes back only what is unused when one credit is spent: the unit stays, nothing goes below 0', () => {
    const used = unwrap(act(gained(aztecs()), 'aztecs:infantry', 'use'))
    const undone = undoByVote(used, 'gain')
    expect(credits(undone)).toBe(0)
    expect(units(undone)).toBe(units(used))
    expect(undone.log.some((entry) => entry.privateLog.includes('loses 1 (0) of the 2 free Aztec units'))).toBe(true)
  })

  it('takes back nothing more when both are spent', () => {
    const used = unwrap(act(unwrap(act(gained(aztecs()), 'aztecs:infantry', 'use-1')), 'aztecs:mounted', 'use-2'))
    const undone = undoByVote(used, 'gain')
    expect(credits(undone)).toBe(0)
    expect(units(undone)).toBe(units(used))
  })

  it('cannot be turned into a free credit by undoing the spent unit afterwards', () => {
    const used = unwrap(act(gained(aztecs()), 'aztecs:infantry', 'use'))
    const undone = undoByVote(used, 'gain')
    expect(unwrapErr(reverseAssistedAction(undone, 'use', AT)).kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(credits(undone)).toBe(0)
    expect(units(undone)).toBe(units(used))
  })

  it('leaves the credits of another Great Person alone', () => {
    const undone = undoByVote(stacked(), 'gain')
    expect(credits(undone)).toBe(2)
  })

  it('undoing the unit first and the gain afterwards leaves 0 and a clean hand', () => {
    const base = aztecs()
    const used = unwrap(act(gained(base), 'aztecs:infantry', 'use'))
    const back = undoByVote(undoByVote(used, 'use'), 'gain')
    expect(credits(back)).toBe(0)
    expect(units(back)).toBe(units(base))
  })
})

describe('what is projected', () => {
  it('has no credit count or record in any view, and the card is not in the public line', () => {
    const used = unwrap(act(gained(aztecs()), 'aztecs:infantry', 'use'))
    for (const viewer of [CASH1981, KARANDRAS1]) {
      const text = JSON.stringify(toPlayerView(used, viewer))
      expect(text).not.toContain('aztecFreeUnits')
      expect(text).not.toContain('aztecCredits')
    }
    const other = toPlayerView(used, KARANDRAS1)
    expect(other.you?.availableActions.find((a) => a.action === 'aztecs:infantry')?.status).toBe('not-owned')
    expect(JSON.stringify(other.log)).not.toContain('free units left')
    expect(JSON.stringify(other.log)).not.toContain('gains 2 (')
  })
})
