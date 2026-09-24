/**
 * `setTechSlot`, `placeGreatPersonInPyramid` and `setPyramidPlacementSlot`.
 *
 * New in this port, no old-system equivalent — see
 * `docs/agents/tasks/issue-168-tech-revamp-pyramid-reposition.md` and
 * `decisions.md`. Deliberately unenforced (no legality checking of any kind)
 * and unlogged (no public log entry), per the task brief.
 */

import { describe, expect, it } from 'vitest'

import { chooseTech, placeGreatPersonInPyramid, setPyramidPlacementSlot, setTechSlot } from '../src/actions/player.js'
import { draw } from '../src/actions/draw.js'
import type { GreatPersonItem } from '../src/item.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'

import { CASH1981, CHUL, firstCivGame } from './fixture.js'

/** Draws a Great Person into the given player's hand and returns its item id. */
function drawGreatPerson(state: GameState, playerId: string): { readonly state: GameState; readonly itemId: string } {
  const after = unwrap(draw(state, { playerId, sheetName: 'GREAT_PERSON' }))
  const item = after.log.at(-1)?.item
  if (item === null || item === undefined) throw new Error('draw did not log an item')
  return { state: after, itemId: item.id }
}

describe('setTechSlot', () => {
  it('moves a chosen tech to a different pyramid row', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const moved = unwrap(setTechSlot(chosen, { playerId: CASH1981, techName: 'Navy', slot: 4 }))

    const tech = findPlayer(moved, CASH1981)?.techsChosen.find((candidate) => candidate.name === 'Navy')
    expect(tech?.slot).toBe(4)
    // The real level never changes — only the display slot does.
    expect(tech?.level).not.toBe(4)
  })

  it('does not append a log entry — moves are deliberately unlogged', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const logLengthBefore = chosen.log.length
    const moved = unwrap(setTechSlot(chosen, { playerId: CASH1981, techName: 'Navy', slot: 4 }))

    expect(moved.log.length).toBe(logLengthBefore)
  })

  it('an unchosen tech gives ITEM_NOT_FOUND', () => {
    const error = unwrapErr(setTechSlot(firstCivGame(), { playerId: CASH1981, techName: 'Navy', slot: 3 }))
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })

  it('another player cannot move a tech they do not own', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    // CHUL has not chosen Navy at all, so this is also an ownership check —
    // CHUL's own hand simply has no such tech to move.
    const error = unwrapErr(setTechSlot(chosen, { playerId: CHUL, techName: 'Navy', slot: 3 }))
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })

  it('an unknown player is rejected with NO_ACCESS', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const error = unwrapErr(setTechSlot(chosen, { playerId: 'not-a-player', techName: 'Navy', slot: 3 }))
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'not-a-player' })
  })
})

describe('placeGreatPersonInPyramid', () => {
  it('takes the Great Person out of the hand and records a blank pyramid occupant', () => {
    const { state, itemId } = drawGreatPerson(firstCivGame(), CASH1981)
    const before = findPlayer(state, CASH1981)
    const greatPerson = before?.items.find(
      (item): item is GreatPersonItem => item.id === itemId && item.kind === 'greatperson',
    )
    if (greatPerson === undefined) throw new Error('fixture did not draw a Great Person')

    const placed = unwrap(
      placeGreatPersonInPyramid(state, { playerId: CASH1981, itemId, slot: 2 }),
    )
    const after = findPlayer(placed, CASH1981)

    expect(after?.items.some((item) => item.id === itemId)).toBe(false)
    expect(after?.pyramidPlacements).toEqual([{ name: greatPerson.name, slot: 2 }])
  })

  it('does not append a log entry — placements are deliberately unlogged', () => {
    const { state, itemId } = drawGreatPerson(firstCivGame(), CASH1981)
    const logLengthBefore = state.log.length
    const placed = unwrap(placeGreatPersonInPyramid(state, { playerId: CASH1981, itemId, slot: 2 }))

    expect(placed.log.length).toBe(logLengthBefore)
  })

  it('a non-existent item gives ITEM_NOT_FOUND', () => {
    const error = unwrapErr(
      placeGreatPersonInPyramid(firstCivGame(), { playerId: CASH1981, itemId: 'no-such-item', slot: 1 }),
    )
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })

  it('an item that is not a Great Person gives ITEM_NOT_FOUND', () => {
    const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const item = drawn.log.at(-1)?.item
    if (item === null || item === undefined) throw new Error('draw did not log an item')

    const error = unwrapErr(
      placeGreatPersonInPyramid(drawn, { playerId: CASH1981, itemId: item.id, slot: 1 }),
    )
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })

  it('another player cannot place a Great Person from someone else\'s hand', () => {
    const { state, itemId } = drawGreatPerson(firstCivGame(), CASH1981)
    const error = unwrapErr(placeGreatPersonInPyramid(state, { playerId: CHUL, itemId, slot: 1 }))
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })

    // CASH1981's Great Person is untouched.
    expect(findPlayer(state, CASH1981)?.items.some((item) => item.id === itemId)).toBe(true)
  })
})

describe('setPyramidPlacementSlot', () => {
  it('moves an already-placed Great Person to a different row', () => {
    const { state, itemId } = drawGreatPerson(firstCivGame(), CASH1981)
    const placed = unwrap(placeGreatPersonInPyramid(state, { playerId: CASH1981, itemId, slot: 2 }))
    const name = findPlayer(placed, CASH1981)?.pyramidPlacements[0]?.name
    if (name === undefined) throw new Error('fixture did not place a Great Person')

    const moved = unwrap(setPyramidPlacementSlot(placed, { playerId: CASH1981, name, slot: 5 }))
    expect(findPlayer(moved, CASH1981)?.pyramidPlacements).toEqual([{ name, slot: 5 }])
  })

  it('does not append a log entry — moves are deliberately unlogged', () => {
    const { state, itemId } = drawGreatPerson(firstCivGame(), CASH1981)
    const placed = unwrap(placeGreatPersonInPyramid(state, { playerId: CASH1981, itemId, slot: 2 }))
    const name = findPlayer(placed, CASH1981)?.pyramidPlacements[0]?.name
    if (name === undefined) throw new Error('fixture did not place a Great Person')
    const logLengthBefore = placed.log.length

    const moved = unwrap(setPyramidPlacementSlot(placed, { playerId: CASH1981, name, slot: 5 }))
    expect(moved.log.length).toBe(logLengthBefore)
  })

  it('a name with no placement gives ITEM_NOT_FOUND', () => {
    const error = unwrapErr(
      setPyramidPlacementSlot(firstCivGame(), { playerId: CASH1981, name: 'Sir Isaac Newton', slot: 1 }),
    )
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })

  it('another player cannot move a placement they do not own', () => {
    const { state, itemId } = drawGreatPerson(firstCivGame(), CASH1981)
    const placed = unwrap(placeGreatPersonInPyramid(state, { playerId: CASH1981, itemId, slot: 2 }))
    const name = findPlayer(placed, CASH1981)?.pyramidPlacements[0]?.name
    if (name === undefined) throw new Error('fixture did not place a Great Person')

    const error = unwrapErr(setPyramidPlacementSlot(placed, { playerId: CHUL, name, slot: 5 }))
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
    // CASH1981's placement is untouched.
    expect(findPlayer(placed, CASH1981)?.pyramidPlacements).toEqual([{ name, slot: 2 }])
  })
})

describe('migration', () => {
  it('defaults pyramidPlacements to [] for a game saved before this feature existed', () => {
    const original = firstCivGame()
    const older = {
      ...original,
      players: original.players.map(({ pyramidPlacements: _pyramidPlacements, ...player }) => player),
    } as unknown as GameState

    const migrated = migrateGameState(older)
    expect(findPlayer(migrated, CASH1981)?.pyramidPlacements).toEqual([])
  })
})

describe('projection', () => {
  it('a moved tech slot is visible on the owner\'s own projected hand', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(setTechSlot(state, { playerId: CASH1981, techName: 'Navy', slot: 4 }))

    const ownView = toPlayerView(state, CASH1981)
    expect(ownView.you?.techsChosen.find((tech) => tech.name === 'Navy')?.slot).toBe(4)
  })

  it('pyramidPlacements is public: it appears on an opponent\'s projection unfiltered', () => {
    const { state, itemId } = drawGreatPerson(firstCivGame(), CASH1981)
    const placed = unwrap(placeGreatPersonInPyramid(state, { playerId: CASH1981, itemId, slot: 3 }))

    const opponentView = toPlayerView(placed, CHUL)
    const opponent = opponentView.opponents.find((candidate) => candidate.playerId === CASH1981)
    expect(opponent?.pyramidPlacements).toEqual(findPlayer(placed, CASH1981)?.pyramidPlacements)
    // Considered, not omitted: `pyramidPlacements` carries no hidden data by
    // design (see the task brief's acceptance criteria), so there is nothing
    // to leak-test here the way `revealedTechs` needs one.
  })
})
