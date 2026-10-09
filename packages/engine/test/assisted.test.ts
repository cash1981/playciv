/**
 * Assisted actions (issue #260): the registry, Chivalry, resource spending, and
 * the projection. There is no old-system counterpart; the specification is
 * `docs/agents/tasks/assisted-play-contract.md`.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { chooseTech, purchaseCoin, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import {
  ASSISTED_ACTION_KINDS,
  assistedAvailability,
  availableActionsFor,
  findResourceToken,
  isAssistedActionKind,
  performAssistedAction,
  spendResource,
} from '../src/assisted.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'

import { chivalryTurn, player, withHutInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

/** Nothing from a record's effect, and no hut identity, is allowed in a view. */
function assertNoEffectData(json: string, hutId: string): void {
  expect(json).not.toContain('"effect"')
  expect(json).not.toContain('usageKey')
  expect(json).not.toContain('card:Chivalry')
  expect(json).not.toContain(hutId)
  expect(json).not.toContain('"itemId"')
}

const press = (state: GameState, requestId: string, action: 'chivalry' | 'democracy' | 'printingPress' = 'chivalry') =>
  performAssistedAction(state, { playerId: CASH1981, action, requestId })

describe('the registry', () => {
  it('lists Chivalry, Democracy and Printing Press', () => {
    expect([...ASSISTED_ACTION_KINDS].sort()).toEqual(['chivalry', 'democracy', 'printingPress'])
    expect(isAssistedActionKind('chivalry')).toBe(true)
    expect(isAssistedActionKind('currency')).toBe(false)
    expect(isAssistedActionKind(7)).toBe(false)
  })

  it('a new game and an old save both have an empty list of records', () => {
    expect(firstCivGame().assistedActions).toEqual([])
    const old = { ...firstCivGame() } as Record<string, unknown>
    delete old['assistedActions']
    expect(migrateGameState(old as unknown as GameState).assistedActions).toEqual([])
  })
})

describe('Chivalry', () => {
  it('spends the incense piece in the own area, gains 5 culture, logs once and records once', () => {
    const { state: ready, piece } = withPieceInArea(chivalryTurn(), 'resources/incense')
    const before = player(ready)
    expect(assistedAvailability(ready, CASH1981, 'chivalry').status).toBe('ready')

    const done = unwrap(press(ready, 'req-1'))

    expect(player(done).stats.culture).toBe(before.stats.culture + 5)
    expect(done.board.pieces.some((candidate) => candidate.id === piece.id)).toBe(false)
    // Through the board history, like any other removal
    expect(done.board.history.at(-1)?.change).toMatchObject({ kind: 'remove', piece: { id: piece.id } })
    expect(done.assistedActions).toHaveLength(1)
    const record = done.assistedActions[0]
    expect(record).toMatchObject({
      id: 'req-1',
      kind: 'chivalry',
      playerId: CASH1981,
      turnNumber: 1,
      phase: 'CM',
      usageKey: 'card:Chivalry',
      status: 'applied',
      effect: { kind: 'chivalry', culture: 5, spent: { kind: 'piece', resource: 'Incense', piece: { id: piece.id } } },
    })
    const lines = done.log.filter((entry) => entry.assistedActionId === 'req-1')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.id).toBe(record?.logId)
    expect(lines[0]?.publicLog).toBe('cash1981 used Chivalry: spent 1 Incense and gained 5 culture')
    expect(player(done).playerTurns[0]?.usedActions).toContain('card:Chivalry')
  })

  it('uses an Incense hut in the hand first, matching the name in any case, and leaves the piece', () => {
    const withPiece = withPieceInArea(chivalryTurn(), 'resources/incense')
    const withHut = withHutInHand(withPiece.state, 'Incense')
    const shouting = {
      ...withHut.state,
      players: withHut.state.players.map((candidate) => ({
        ...candidate,
        items: candidate.items.map((item) =>
          item.id === withHut.hutId && item.kind === 'hut' ? { ...item, name: 'INCENSE' } : item,
        ),
      })),
    }

    const done = unwrap(press(shouting, 'req-hut'))

    expect(done.board.pieces.some((candidate) => candidate.id === withPiece.piece.id)).toBe(true)
    expect(player(done).items.some((item) => item.id === withHut.hutId)).toBe(false)
    expect(done.discardedItems.find((item) => item.id === withHut.hutId)?.hidden).toBe(true)
    expect(done.assistedActions[0]?.effect).toMatchObject({
      spent: { kind: 'hut', resource: 'Incense', itemId: withHut.hutId },
    })
    expect(player(done).stats.culture).toBe(5)
    // Nothing was removed from the board, so no board history entry for the spend
    expect(done.board.history).toHaveLength(withPiece.state.board.history.length)
  })

  it('with neither a hut nor a piece it needs a resource and changes nothing', () => {
    const ready = chivalryTurn()
    const snapshot = JSON.stringify(ready)

    expect(assistedAvailability(ready, CASH1981, 'chivalry')).toMatchObject({ status: 'needs-resource' })
    const error = unwrapErr(press(ready, 'req-none'))

    expect(error).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'needs-resource' })
    expect(JSON.stringify(ready)).toBe(snapshot)
  })

  it('ignores a piece in another player\'s area, a piece outside every area, and the wrong resource', () => {
    let state = chivalryTurn()
    state = withPieceInArea(state, 'resources/incense', KARANDRAS1).state
    state = withPieceInArea(state, 'resources/iron').state
    const loose = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'resources/incense', x: 10, y: 10 }))
    const withHut = withHutInHand(loose, 'Iron').state

    expect(findResourceToken(withHut, CASH1981, 'Incense')).toBeUndefined()
    expect(assistedAvailability(withHut, CASH1981, 'chivalry').status).toBe('needs-resource')
  })

  it('a second press with the same requestId is a no-op, even when another token is left', () => {
    let state = withPieceInArea(chivalryTurn(), 'resources/incense').state
    state = withPieceInArea(state, 'resources/incense').state

    const once = unwrap(press(state, 'req-same'))
    const twice = unwrap(press(once, 'req-same'))

    expect(twice).toBe(once)
    expect(player(twice).stats.culture).toBe(5)
    expect(twice.assistedActions).toHaveLength(1)
    expect(twice.board.pieces.filter((piece) => piece.assetId === 'resources/incense')).toHaveLength(1)
  })

  it('every card is once per turn: a new requestId is refused and spends nothing', () => {
    let state = withPieceInArea(chivalryTurn(), 'resources/incense').state
    state = withPieceInArea(state, 'resources/incense').state
    const once = unwrap(press(state, 'req-a'))

    expect(assistedAvailability(once, CASH1981, 'chivalry').status).toBe('used')
    const error = unwrapErr(press(once, 'req-b'))

    expect(error).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'used' })
    expect(once.board.pieces.filter((piece) => piece.assetId === 'resources/incense')).toHaveLength(1)
    expect(player(once).stats.culture).toBe(5)
  })

  it('another player cannot reuse a requestId that is already recorded', () => {
    const { state } = withPieceInArea(chivalryTurn(), 'resources/incense')
    const once = unwrap(press(state, 'req-shared'))
    const error = unwrapErr(
      performAssistedAction(once, { playerId: KARANDRAS1, action: 'chivalry', requestId: 'req-shared' }),
    )
    expect(error).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED' })
  })

  it('refuses a blank requestId and a player who is not in the game', () => {
    const { state } = withPieceInArea(chivalryTurn(), 'resources/incense')
    expect(unwrapErr(press(state, '  '))).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED' })
    expect(
      unwrapErr(performAssistedAction(state, { playerId: 'nobody', action: 'chivalry', requestId: 'x' })),
    ).toMatchObject({ kind: 'NO_ACCESS' })
  })

  describe('when it cannot be used', () => {
    const withToken = (state: GameState): GameState => withPieceInArea(state, 'resources/incense').state

    it('Start of Turn and Trade still open is the wrong phase', () => {
      let state = firstCivGame()
      state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Chivalry' }))
      state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Chivalry' }))
      state = withToken(unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'SOT' })))

      expect(assistedAvailability(state, CASH1981, 'chivalry').status).toBe('wrong-phase')
      expect(unwrapErr(press(state, 'r'))).toMatchObject({ status: 'wrong-phase' })
    })

    it('City Management already done, or Movement started, is the wrong phase', () => {
      const closed = withToken(unwrap(markPhasesDone(chivalryTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' })))
      expect(assistedAvailability(closed, CASH1981, 'chivalry').status).toBe('wrong-phase')
      const moving = withToken(unwrap(markPhasesDone(chivalryTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'MOVEMENT' })))
      expect(unwrapErr(press(moving, 'r'))).toMatchObject({ status: 'wrong-phase' })
    })

    it('a Chivalry that is chosen but not revealed is unavailable, with a reason', () => {
      let state = firstCivGame()
      state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Chivalry' }))
      state = withToken(unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' })))

      const availability = assistedAvailability(state, CASH1981, 'chivalry')
      expect(availability.status).toBe('unavailable')
      expect(availability.reason).toContain('Reveal Chivalry')
      expect(unwrapErr(press(state, 'r')).kind).toBe('ASSISTED_ACTION_REJECTED')
    })

    it('a player without the tech, with a token and an open phase, does not own it', () => {
      const state = withToken(unwrap(markPhasesDone(firstCivGame(), { playerId: KARANDRAS1, turnNumber: 1, upToPhase: 'TRADE' })))
      const other = withPieceInArea(state, 'resources/incense', KARANDRAS1).state
      expect(assistedAvailability(other, KARANDRAS1, 'chivalry').status).toBe('not-owned')
      // Another player's revealed Chivalry does not help
      expect(
        unwrapErr(performAssistedAction(chivalryTurn(), { playerId: KARANDRAS1, action: 'chivalry', requestId: 'r' })),
      ).toMatchObject({ status: 'not-owned' })
    })

    it('leaves the state exactly as it was, with no partial change', () => {
      const closed = withToken(unwrap(markPhasesDone(chivalryTurn(), { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' })))
      const snapshot = JSON.stringify(closed)
      unwrapErr(press(closed, 'r'))
      expect(JSON.stringify(closed)).toBe(snapshot)
    })
  })
})

describe('spendResource', () => {
  it.each([
    ['Incense', 'resources/incense'],
    ['Iron', 'resources/iron'],
    ['Silk', 'resources/silk'],
    ['Wheat', 'resources/wheat'],
  ] as const)('takes a %s piece from the own area off the board', (name, assetId) => {
    const { state, piece } = withPieceInArea(firstCivGame(), assetId)
    const spent = unwrap(spendResource(state, CASH1981, name))
    expect(spent.spent).toMatchObject({ kind: 'piece', resource: name, piece: { id: piece.id } })
    expect(spent.state.board.pieces.some((candidate) => candidate.id === piece.id)).toBe(false)
  })

  it('takes a hut of any resource name from the hand into the discard pile', () => {
    for (const name of ['Silk', 'Uranium', 'Wheat', 'Iron']) {
      const { state, hutId } = withHutInHand(firstCivGame(), name)
      const spent = unwrap(spendResource(state, CASH1981, name))
      expect(spent.spent).toEqual({ kind: 'hut', resource: name, itemId: hutId })
      expect(spent.state.discardedItems.find((item) => item.id === hutId)?.hidden).toBe(true)
    }
  })

  it('does not take a hut that is already spent', () => {
    const { state, hutId } = withHutInHand(firstCivGame(), 'Wheat')
    const usedUp = {
      ...state,
      players: state.players.map((candidate) => ({
        ...candidate,
        items: candidate.items.map((item) => (item.id === hutId ? { ...item, used: true } : item)),
      })),
    }
    expect(spendResource(usedUp, CASH1981, 'Wheat').ok).toBe(false)
  })

  it('does not change the input state', () => {
    const { state } = withPieceInArea(firstCivGame(), 'resources/incense')
    const snapshot = JSON.stringify(state)
    unwrap(spendResource(state, CASH1981, 'Incense'))
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})

describe('Democracy and Printing Press on the same contract', () => {
  function purchaseReady(techName: 'Democracy' | 'Printing Press'): GameState {
    const state = chivalryTurn(techName)
    return {
      ...state,
      players: state.players.map((candidate) =>
        candidate.playerId === CASH1981
          ? { ...candidate, stats: { ...candidate.stats, trade: 6, culture: 5 } }
          : candidate,
      ),
    }
  }

  it.each([
    ['democracy', 'Democracy', 6, 'coin-purchase:democracy'],
    ['printingPress', 'Printing Press', 5, 'coin-purchase:printingPress'],
  ] as const)('%s pays like purchaseCoin and keeps its usage key', (action, techName, cost, usageKey) => {
    const ready = purchaseReady(techName)
    const viaRegistry = unwrap(press(ready, `req-${action}`, action))
    const viaRoute = unwrap(purchaseCoin(ready, { playerId: CASH1981, source: action }))

    // The registry only adds the record and the link on the line
    expect(player(viaRegistry).stats).toEqual(player(viaRoute).stats)
    expect(player(viaRegistry).playerTurns).toEqual(player(viaRoute).playerTurns)
    // The fixture holds 6 trade and 5 culture; Democracy costs 6 trade, Printing Press 5 culture
    expect(player(viaRegistry).stats.trade).toBe(action === 'democracy' ? 0 : 6)
    expect(player(viaRegistry).stats.culture).toBe(action === 'democracy' ? 5 : 0)
    expect(player(viaRegistry).playerTurns[0]?.usedActions).toContain(usageKey)
    expect(viaRegistry.log.at(-1)?.publicLog).toBe(viaRoute.log.at(-1)?.publicLog)
    expect(viaRegistry.log.at(-1)?.assistedActionId).toBe(`req-${action}`)
    expect(viaRoute.log.at(-1)?.assistedActionId).toBeUndefined()
    expect(viaRoute.assistedActions).toEqual([])
    expect(viaRegistry.assistedActions[0]).toMatchObject({ kind: action, usageKey, effect: { kind: 'coinPurchase', cost } })
  })

  it('the old route and the registry share one use per turn', () => {
    const ready = purchaseReady('Democracy')
    const viaRoute = unwrap(purchaseCoin(ready, { playerId: CASH1981, source: 'democracy' }))
    expect(assistedAvailability(viaRoute, CASH1981, 'democracy').status).toBe('used')
    expect(unwrapErr(press(viaRoute, 'late', 'democracy'))).toMatchObject({ status: 'used' })

    const viaRegistry = unwrap(press(ready, 'first', 'democracy'))
    expect(unwrapErr(purchaseCoin(viaRegistry, { playerId: CASH1981, source: 'democracy' }))).toMatchObject({
      kind: 'COIN_PURCHASE_REJECTED',
      reason: 'ALREADY_USED',
    })
  })

  it('maps the purchase rejections onto statuses', () => {
    const ready = purchaseReady('Democracy')
    const poor = {
      ...ready,
      players: ready.players.map((candidate) =>
        candidate.playerId === CASH1981 ? { ...candidate, stats: { ...candidate.stats, trade: 5 } } : candidate,
      ),
    }
    expect(assistedAvailability(poor, CASH1981, 'democracy').status).toBe('needs-resource')
    expect(assistedAvailability(ready, CASH1981, 'printingPress').status).toBe('not-owned')
    const closed = unwrap(markPhasesDone(ready, { playerId: CASH1981, turnNumber: 1, upToPhase: 'CM' }))
    expect(assistedAvailability(closed, CASH1981, 'democracy').status).toBe('wrong-phase')
  })
})

describe('the projection', () => {
  const readyForChivalry = (): { state: GameState; hutId: string } => {
    const { state: withPiece } = withPieceInArea(chivalryTurn(), 'resources/incense')
    return withHutInHand(withPiece, 'Incense')
  }

  it('gives the viewer their own available actions, with a reason', () => {
    const { state } = readyForChivalry()
    const view = toPlayerView(state, CASH1981)
    expect(view.you?.availableActions.map((entry) => entry.action)).toEqual(ASSISTED_ACTION_KINDS)
    const chivalry = view.you?.availableActions.find((entry) => entry.action === 'chivalry')
    expect(chivalry).toMatchObject({ status: 'ready', label: 'Chivalry' })
    expect(chivalry?.reason).not.toBe('')
    expect(availableActionsFor(state, CASH1981)).toEqual(view.you?.availableActions)
    expect(availableActionsFor(state, 'nobody')).toEqual([])
  })

  it('another player gets only their own available actions, a spectator none, and nobody the effect', () => {
    const { state, hutId } = readyForChivalry()
    const done = unwrap(press(state, 'req-leak'))

    for (const viewerId of [KARANDRAS1, ITCHI, CHUL]) {
      const view = toPlayerView(done, viewerId)
      // Their own state, not the actor's: they hold none of these techs
      expect(view.you?.availableActions).toEqual(availableActionsFor(done, viewerId))
      expect(view.you?.availableActions.every((entry) => entry.status === 'not-owned')).toBe(true)
      // The actor appears as an opponent: counts and public numbers, no button state
      const actor = view.opponents.find((entry) => entry.playerId === CASH1981)
      expect(actor).not.toHaveProperty('availableActions')
      expect(JSON.stringify(view.opponents)).not.toContain('availableActions')
      assertNoEffectData(JSON.stringify(view), hutId)
    }

    const spectator = toPlayerView(done, '')
    expect(spectator.you).toBeNull()
    expect(JSON.stringify(spectator)).not.toContain('availableActions')
    assertNoEffectData(JSON.stringify(spectator), hutId)
  })

  it('the actor is told what they hold, and others are not told that', () => {
    const { state } = readyForChivalry()
    expect(toPlayerView(state, CASH1981).you?.availableActions[0]?.status).toBe('ready')
    expect(toPlayerView(state, KARANDRAS1).you?.availableActions[0]?.status).toBe('not-owned')
    expect(JSON.stringify(toPlayerView(state, KARANDRAS1))).not.toContain('Incense token')
  })

  it('shows the public summary of every action to everybody, without the effect', () => {
    const { state, hutId } = readyForChivalry()
    const done = unwrap(press(state, 'req-public'))
    const logId = done.assistedActions[0]?.logId

    for (const viewerId of [CASH1981, KARANDRAS1, '']) {
      expect(toPlayerView(done, viewerId).assistedActions).toEqual([
        {
          id: 'req-public',
          kind: 'chivalry',
          label: 'Chivalry',
          playerId: CASH1981,
          username: 'cash1981',
          turnNumber: 1,
          phase: 'CM',
          status: 'applied',
          text: 'cash1981 used Chivalry: spent 1 Incense and gained 5 culture',
          logId,
        },
      ])
    }
    expect(JSON.stringify(toPlayerView(done, KARANDRAS1).assistedActions)).not.toContain(hutId)
    expect(JSON.stringify(toPlayerView(done, KARANDRAS1).log)).not.toContain(hutId)
  })

  it('carries the action id on the public line, so anyone can ask to undo it', () => {
    const { state } = readyForChivalry()
    const done = unwrap(press(state, 'req-line'))
    const line = toPlayerView(done, KARANDRAS1).log.find((entry) => 'assistedActionId' in entry)
    expect(line).toMatchObject({ assistedActionId: 'req-line', username: 'cash1981' })
    expect(Object.keys(line ?? {}).sort()).toEqual(['assistedActionId', 'id', 'logType', 'publicLog', 'username'])
  })

  it('an ordinary public log line keeps its old shape', () => {
    const view = toPlayerView(unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' })), KARANDRAS1)
    expect(Object.keys(view.log.at(-1) ?? {}).sort()).toEqual(['id', 'logType', 'publicLog', 'username'])
  })
})
