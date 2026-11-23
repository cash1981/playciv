/**
 * A Spanish player revealed before the reveal set Spain's +1 travel speed still has Movement `2` in a saved game.
 * Reading the save gives them `3` once (`migrateGameState`), written as the reveal writes it, so undoing the reveal
 * restores `2` and a second read does nothing. Any other value and any other civilization stay as they are.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { revealItem } from '../src/actions/player.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { migrateGameState } from '../src/migrate.js'
import { travelSpeedOf } from '../src/movement.js'
import { unwrap } from '../src/result.js'
import type { GameLogEntry, GameState, Playerhand } from '../src/state.js'
import { DEFAULT_PLAYER_STATS, findPlayer, withPlayer } from '../src/state.js'

import { CASH1981, KARANDRAS1, firstCivGame } from './fixture.js'

/** Hands a specific civilization to a player and reveals it, which is what a game does today. */
function revealed(civ: string): GameState {
  const base = firstCivGame()
  const card = base.items.find((item) => item.kind === 'civ' && item.name === civ)
  if (card === undefined) throw new Error(`no ${civ} civ in the deck`)
  const handed: GameState = {
    ...base,
    items: base.items.filter((item) => item.id !== card.id),
    players: base.players.map((player) =>
      player.playerId === CASH1981 ? { ...player, items: [...player.items, { ...card, ownerId: CASH1981 }] } : player,
    ),
  }
  return unwrap(revealItem(handed, { playerId: CASH1981, sheetName: 'CIV', itemNumber: card.itemNumber }))
}

const mvmtOf = (state: GameState, playerId = CASH1981): string | undefined => findPlayer(state, playerId)?.stats.mvmt

const revealLine = (state: GameState): GameLogEntry => {
  const entry = state.log.find((candidate) => candidate.logType === 'REVEAL' && candidate.item?.kind === 'civ' && candidate.playerId === CASH1981)
  if (entry === undefined) throw new Error('no civ reveal in the log')
  return entry
}

/** The save of a game whose Spanish player was revealed before the reveal set the speed: Movement `mvmt`, and no `mvmt` in the setup. */
function savedBefore(mvmt: string, civ = 'Spanish'): GameState {
  const state = revealed(civ)
  const holder = findPlayer(state, CASH1981) as Playerhand
  const line = revealLine(state)
  const { mvmt: _mvmt, ...setup } = line.civSetup ?? { unitIds: [], discardedCivIds: [], pieceIds: [], wonders: [] }
  return {
    ...withPlayer(state, { ...holder, stats: { ...holder.stats, mvmt } }),
    log: state.log.map((entry) => (entry.id === line.id ? { ...entry, civSetup: setup } : entry)),
  }
}

function undoReveal(state: GameState): GameState {
  const logId = revealLine(state).id
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const player of state.players) {
    if (player.playerId !== CASH1981) next = unwrap(vote(next, { logId, playerId: player.playerId, vote: true }))
  }
  return next
}

describe('migrating the travel speed of a Spanish player', () => {
  it('gives Movement 3 to a Spanish player who still has the default, and records it on the reveal line', () => {
    const saved = savedBefore(DEFAULT_PLAYER_STATS.mvmt)
    expect(mvmtOf(saved)).toBe('2')
    expect(revealLine(saved).civSetup?.mvmt).toBeUndefined()
    const migrated = migrateGameState(saved)
    expect(mvmtOf(migrated)).toBe('3')
    expect(revealLine(migrated).civSetup?.mvmt).toEqual({ before: '2', set: '3' })
    // The rest of the setup is what it was, and nobody else's speed changed
    expect(revealLine(migrated).civSetup).toMatchObject({ ...revealLine(saved).civSetup })
    expect(mvmtOf(migrated, KARANDRAS1)).toBe('2')
  })

  it('is restored to 2 by the undo of the reveal, and the next reveal sets 3 again', () => {
    const undone = undoReveal(migrateGameState(savedBefore('2')))
    expect(mvmtOf(undone)).toBe('2')
    expect(undone.log.at(-1)?.publicLog).toContain('movement went back to 2')
    const card = findPlayer(undone, CASH1981)?.items.find((item) => item.kind === 'civ' && item.hidden)
    if (card === undefined) throw new Error('the civ card is not back in the hand')
    expect(mvmtOf(unwrap(revealItem(undone, { playerId: CASH1981, sheetName: 'CIV', itemNumber: card.itemNumber })))).toBe('3')
  })

  it('changes nothing a second time: reading the migrated save again gives the same game', () => {
    const once = migrateGameState(savedBefore('2'))
    expect(migrateGameState(once)).toEqual(once)
    // Typed back to 2 on purpose after the migration: the entry on the reveal line keeps the migration from running again
    const holder = findPlayer(once, CASH1981) as Playerhand
    const typed = withPlayer(once, { ...holder, stats: { ...holder.stats, mvmt: '2' } })
    expect(mvmtOf(migrateGameState(typed))).toBe('2')
  })

  it.each(['3', '3+1', '4'])('never touches another value (%s)', (value) => {
    const saved = savedBefore(value)
    const migrated = migrateGameState(saved)
    expect(mvmtOf(migrated)).toBe(value)
    expect(revealLine(migrated).civSetup).toEqual(revealLine(saved).civSetup)
  })

  /** A save from when the reveal wrote Spain's +1 as `2+1`: the stat and the setup both hold it. */
  function savedWithOldBonus(mvmt: string): GameState {
    const saved = savedBefore(mvmt)
    const line = revealLine(saved)
    return {
      ...saved,
      log: saved.log.map((entry) =>
        entry.id === line.id && entry.civSetup !== undefined ? { ...entry, civSetup: { ...entry.civSetup, mvmt: { before: '2', set: mvmt } } } : entry,
      ),
    }
  }

  it('turns an old `2+1` into `3`, and the undo of the reveal still restores 2', () => {
    const migrated = migrateGameState(savedWithOldBonus('2+1'))
    expect(mvmtOf(migrated)).toBe('3')
    expect(revealLine(migrated).civSetup?.mvmt).toEqual({ before: '2', set: '3' })
    expect(mvmtOf(undoReveal(migrated))).toBe('2')
    expect(migrateGameState(migrated)).toEqual(migrated)
  })

  it('turns an old `2+2` (a typed Natural Religion on top of Spain) into `3+1`, keeping the speed with a tech', () => {
    const migrated = migrateGameState(savedWithOldBonus('2+2'))
    expect(mvmtOf(migrated)).toBe('3+1')
    expect(revealLine(migrated).civSetup?.mvmt).toEqual({ before: '2', set: '3+1' })
  })

  it('never touches another civilization, whatever its Movement', () => {
    for (const civ of ['Romans', 'Arabs', 'Chinese']) {
      const migrated = migrateGameState(savedBefore('2', civ))
      expect(mvmtOf(migrated)).toBe('2')
      expect(revealLine(migrated).civSetup?.mvmt).toBeUndefined()
    }
  })

  it('sets only the stat when the reveal line has no civSetup', () => {
    const saved = savedBefore('2')
    const line = revealLine(saved)
    const { civSetup: _setup, ...bare } = line
    const old: GameState = { ...saved, log: saved.log.map((entry) => (entry.id === line.id ? bare : entry)) }
    const migrated = migrateGameState(old)
    expect(mvmtOf(migrated)).toBe('3')
    expect(revealLine(migrated).civSetup).toBeUndefined()
    expect(migrateGameState(migrated)).toEqual(migrated)
  })

  it('gives a withdrawn Spanish player the speed too', () => {
    const saved = savedBefore('2')
    const holder = findPlayer(saved, CASH1981) as Playerhand
    const withdrawn: GameState = {
      ...saved,
      players: saved.players.filter((player) => player.playerId !== CASH1981),
      withdrawnPlayers: [holder],
    }
    expect(migrateGameState(withdrawn).withdrawnPlayers[0]?.stats.mvmt).toBe('3')
  })

  it('makes the travel speed of the Spanish army 3, and of the scout 3', () => {
    const place = (state: GameState, assetId: string) => {
      const next = unwrap(placePiece(state, { playerId: CASH1981, assetId, x: 200, y: 300 }))
      const piece = next.board.pieces.find((candidate) => candidate.assetId === assetId)
      if (piece === undefined) throw new Error('no piece')
      return { next, piece }
    }
    const saved = savedBefore('2')
    const migrated = migrateGameState(saved)
    const { next: before, piece: armyBefore } = place(saved, 'figures/redarmy')
    expect(travelSpeedOf(findPlayer(before, CASH1981) as Playerhand, armyBefore, 1)).toBe(2)
    const { next: after, piece: armyAfter } = place(migrated, 'figures/redarmy')
    expect(travelSpeedOf(findPlayer(after, CASH1981) as Playerhand, armyAfter, 1)).toBe(3)
    const { next: scouted, piece: scout } = place(migrated, 'figures/redscout')
    expect(travelSpeedOf(findPlayer(scouted, CASH1981) as Playerhand, scout, 1)).toBe(3)
  })
})
