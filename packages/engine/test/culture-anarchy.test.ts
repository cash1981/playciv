/**
 * Issue #352, slice 2: The Citizens are Revolting! (I and II). The target's government card is replaced by Anarchy; its
 * social policies stop working, its capital takes no action, and a cancel rewinds all of it.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { performAssistedAction, reverseAssistedAction } from '../src/assisted.js'
import { applyCancellation } from '../src/cancellation.js'
import { SQUARE_SIZE, mapTop, slotOrigin } from '../src/board.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'

import { player, withCardInHand } from './assisted-fixture.js'
import { CASH1981 as A, KARANDRAS1 as B, ITCHI as C, firstCivGame } from './fixture.js'

const AT = '2026-11-25T12:00:00.000Z'

const play = (state: GameState, owner: string, itemId: string, id: string, targets: readonly string[]) =>
  performAssistedAction(state, { playerId: owner, action: 'playCard', requestId: id, payload: { itemId, targets } })

const governmentOf = (state: GameState, playerId: string) => player(state, playerId).government

describe.each(['The Citizens are Revolting!', 'The Citizens are Revolting II!'])('%s', (name) => {
  const scene = () => {
    const given = withCardInHand(firstCivGame(), name, A)
    const joust = withCardInHand(given.state, 'Jousting Tourney', B)
    return { baseline: joust.state, itemId: given.itemId, joustId: joust.itemId }
  }

  it('replaces the target\'s government with Anarchy and logs it', () => {
    const { baseline, itemId } = scene()
    const before = governmentOf(baseline, B)
    const done = unwrap(play(baseline, A, itemId, 'r1', [B]))
    expect(governmentOf(done, B)).toBe('Anarchy')
    expect(governmentOf(done, A)).toBe(governmentOf(baseline, A))
    expect(done.log.at(-1)?.publicLog).toContain(`government changes from ${before} to Anarchy`)
  })

  it('refuses a target already in Anarchy', () => {
    const { baseline, itemId } = scene()
    const anarchic: GameState = {
      ...baseline,
      players: baseline.players.map((p) => (p.playerId === B ? { ...p, government: 'Anarchy' as const } : p)),
    }
    expect(unwrapErr(play(anarchic, A, itemId, 'r1', [B])).kind).toBe('ASSISTED_ACTION_REJECTED')
  })

  it('is taken back by an undo, which restores the government', () => {
    const { baseline, itemId } = scene()
    const done = unwrap(play(baseline, A, itemId, 'r1', [B]))
    const back = unwrap(reverseAssistedAction(done, 'r1', AT))
    expect(governmentOf(back, B)).toBe(governmentOf(baseline, B))
  })

  it('puts the Democracy coin back on an undo', () => {
    const { baseline, itemId } = scene()
    const democratic: GameState = {
      ...baseline,
      players: baseline.players.map((p) =>
        p.playerId === B
          ? { ...p, government: 'Democracy' as const, stats: { ...p.stats, coinSources: { ...p.stats.coinSources, democracyGovernment: 3 } } }
          : p,
      ),
    }
    const done = unwrap(play(democratic, A, itemId, 'r1', [B]))
    expect(player(done, B).stats.coinSources.democracyGovernment).toBe(0)
    const back = unwrap(reverseAssistedAction(done, 'r1', AT))
    expect(governmentOf(back, B)).toBe('Democracy')
    expect(player(back, B).stats.coinSources.democracyGovernment).toBe(3)
  })

  describe('the Organized Religion coin on an undo', () => {
    const policy = {
      id: 'policy-organized-religion',
      itemNumber: 9001,
      kind: 'socialpolicy' as const,
      sheetName: 'SOCIAL_POLICY' as const,
      name: 'Organized Religion',
      type: null,
      flipside: null,
      description: null,
      used: false,
      hidden: false,
      ownerId: B,
    }
    const withReligion = (state: GameState, coin: number): GameState => ({
      ...state,
      players: state.players.map((p) =>
        p.playerId === B
          ? {
              ...p,
              socialPolicies: [...p.socialPolicies, policy],
              stats: { ...p.stats, coinSources: { ...p.stats.coinSources, organizedReligion: coin } },
            }
          : p,
      ),
    })

    it('comes back as it was when the policy is unchanged', () => {
      const { baseline, itemId } = scene()
      const done = unwrap(play(withReligion(baseline, 1), A, itemId, 'r1', [B]))
      expect(player(done, B).stats.coinSources.organizedReligion).toBe(0)
      expect(player(unwrap(reverseAssistedAction(done, 'r1', AT)), B).stats.coinSources.organizedReligion).toBe(1)
    })

    it('is not given back when the policy was removed under Anarchy', () => {
      const { baseline, itemId } = scene()
      const done = unwrap(play(withReligion(baseline, 1), A, itemId, 'r1', [B]))
      const removed: GameState = { ...done, players: done.players.map((p) => (p.playerId === B ? { ...p, socialPolicies: [] } : p)) }
      expect(player(unwrap(reverseAssistedAction(removed, 'r1', AT)), B).stats.coinSources.organizedReligion).toBe(0)
    })

    it('is worked out from the policy when it was revealed under Anarchy', () => {
      const { baseline, itemId } = scene()
      const done = unwrap(play(baseline, A, itemId, 'r1', [B]))
      const revealed = withReligion(done, 0)
      const back = player(unwrap(reverseAssistedAction(revealed, 'r1', AT)), B)
      expect(back.stats.coinSources.organizedReligion).toBeGreaterThan(0)
    })
  })

  it('cannot be undone once the target has left Anarchy', () => {
    const { baseline, itemId } = scene()
    const done = unwrap(play(baseline, A, itemId, 'r1', [B]))
    const left: GameState = { ...done, players: done.players.map((p) => (p.playerId === B ? { ...p, government: 'Despotism' as const } : p)) }
    expect(unwrapErr(reverseAssistedAction(left, 'r1', AT)).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('does not let the target change government in the same Start of Turn, even to one it knows', () => {
    const { baseline, itemId } = scene()
    const done = unwrap(play(baseline, A, itemId, 'r1', [B]))
    const change = performAssistedAction(done, { playerId: B, action: 'switchGovernment', requestId: 'g1', payload: { government: 'Despotism' } })
    expect(unwrapErr(change).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(JSON.stringify(unwrapErr(change))).toContain('Citizens are Revolting')
  })

  it('is cancelled by Jousting Tourney: the whole attack is reverted', () => {
    const { baseline, itemId, joustId } = scene()
    const done = unwrap(play(baseline, A, itemId, 'target', [B]))
    const logId = done.assistedActions.find((candidate) => candidate.id === 'target')?.logId ?? ''
    const cancelled = unwrap(applyCancellation(done, { playerId: B, requestId: 'cancel', command: { logId, itemId: joustId } }, baseline))
    expect(governmentOf(cancelled, B)).toBe(governmentOf(baseline, B))
  })
})

describe('Anarchy from a card: the capital takes no action', () => {
  it('refuses a city action of the capital in City Management', () => {
    let state = firstCivGame()
    state = { ...state, players: state.players.map((p) => ({ ...p, color: p.playerId === A ? 'Red' : p.playerId === B ? 'Blue' : p.playerId === C ? 'Green' : p.color })) }
    const slot = state.board.slots[0]
    if (slot === undefined) throw new Error('no slot')
    const [x, y] = slotOrigin(state.board, slot)
    state = unwrap(placePiece(state, { playerId: B, assetId: 'tiles/america', x, y }))
    state = unwrap(placePiece(state, { playerId: B, assetId: 'cities/bluecapital2', x: SQUARE_SIZE + 4, y: mapTop(state.board) + SQUARE_SIZE + 4 }))
    const cityId = state.board.pieces.at(-1)?.id ?? ''
    const card = withCardInHand(state, 'The Citizens are Revolting!', A)
    const revolted = unwrap(play(card.state, A, card.itemId, 'r1', [B]))
    const inCm = unwrap(markPhasesDone(revolted, { playerId: B, turnNumber: 1, upToPhase: 'TRADE' }))
    const devote = performAssistedAction(inCm, { playerId: B, action: 'devoteToTheArts', requestId: 'd1', payload: { cityPieceId: cityId } })
    expect(unwrapErr(devote).kind).toBe('ASSISTED_ACTION_REJECTED')
    expect(JSON.stringify(unwrapErr(devote))).toContain('Anarchy')
  })

  it('leaves the other cities free to act', () => {
    let state = firstCivGame()
    state = { ...state, players: state.players.map((p) => ({ ...p, color: p.playerId === A ? 'Red' : p.playerId === B ? 'Blue' : p.playerId === C ? 'Green' : p.color })) }
    const slot = state.board.slots[0]
    if (slot === undefined) throw new Error('no slot')
    const [x, y] = slotOrigin(state.board, slot)
    state = unwrap(placePiece(state, { playerId: B, assetId: 'tiles/america', x, y }))
    state = unwrap(placePiece(state, { playerId: B, assetId: 'cities/bluecapital2', x: SQUARE_SIZE + 4, y: mapTop(state.board) + SQUARE_SIZE + 4 }))
    state = unwrap(placePiece(state, { playerId: B, assetId: 'cities/bluecity2', x: 5 * SQUARE_SIZE + 4, y: mapTop(state.board) + 5 * SQUARE_SIZE + 4 }))
    const otherId = state.board.pieces.at(-1)?.id ?? ''
    const card = withCardInHand(state, 'The Citizens are Revolting!', A)
    const revolted = unwrap(play(card.state, A, card.itemId, 'r1', [B]))
    const inCm = unwrap(markPhasesDone(revolted, { playerId: B, turnNumber: 1, upToPhase: 'TRADE' }))
    const devote = performAssistedAction(inCm, { playerId: B, action: 'devoteToTheArts', requestId: 'd1', payload: { cityPieceId: otherId } })
    expect(devote.ok).toBe(true)
  })
})
