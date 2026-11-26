/**
 * Counterfeiters, Depression and Bank Scandal (issue #352): each target discards one coin token chosen by the
 * player of the card, from the counters that hold tokens (the Mysticism counters). Printed coins, Great People,
 * the Panama Canal and invested markers are never touched.
 */

import { describe, expect, it } from 'vitest'

import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { applyCancellation } from '../src/cancellation.js'
import type { CoinSourceKey } from '../src/coins.js'
import { coinSourcesOf, totalCoins } from '../src/coins.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { toPlayerView } from '../src/state.js'

import { placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { playerAreas } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { COIN_MARKER_ASSET_ID } from '../src/coin-marker.js'

import { player, withCardInHand } from './assisted-fixture.js'
import { CASH1981 as A, KARANDRAS1 as B, ITCHI as C, CHUL as D, firstCivGame } from './fixture.js'

type Counters = Partial<Record<CoinSourceKey, number>>

/** Sets counters of one player, leaving the others as they are. */
const withCounters = (state: GameState, playerId: string, counters: Counters): GameState => ({
  ...state,
  players: state.players.map((candidate) =>
    candidate.playerId === playerId
      ? { ...candidate, stats: { ...candidate.stats, coinSources: { ...candidate.stats.coinSources, ...counters } } }
      : candidate,
  ),
})

const play = (
  state: GameState,
  itemId: string,
  options: { targets?: readonly string[]; coinPicks?: readonly { targetId: string; source: string }[]; requestId?: string; playerId?: string } = {},
) =>
  performAssistedAction(state, {
    playerId: options.playerId ?? A,
    action: 'playCard',
    requestId: options.requestId ?? 'req-1',
    at: '2026-11-26T10:00:00.000Z',
    payload: { itemId, targets: options.targets ?? [], ...(options.coinPicks === undefined ? {} : { coinPicks: options.coinPicks }) },
  })

const held = (state: GameState, playerId: string, key: CoinSourceKey): number => player(state, playerId).stats.coinSources[key]
const reason = (result: ReturnType<typeof play>): string => {
  const error = unwrapErr(result)
  return 'reason' in error ? String(error.reason) : JSON.stringify(error)
}
const undoByVote = (state: GameState, requestId = 'req-1'): GameState => {
  const logId = state.assistedActions.find((record) => record.id === requestId)?.logId ?? ''
  let current = unwrap(initiateUndo(state, { logId, playerId: A }))
  for (const voter of state.players.filter((candidate) => candidate.playerId !== A)) {
    current = unwrap(vote(current, { logId, playerId: voter.playerId, vote: true }))
  }
  return current
}

describe('Counterfeiters', () => {
  it('takes one coin from the only counter that holds tokens, without a pick', () => {
    const base = withCounters(firstCivGame(), B, { pottery: 2 })
    const { state, itemId } = withCardInHand(base, 'Counterfeiters')
    const played = unwrap(play(state, itemId, { targets: [B] }))
    expect(held(played, B, 'pottery')).toBe(1)
    expect(played.log.at(-1)?.publicLog).toContain('so Karandras1 discards a coin from Pottery (I) (1 left)')
    expect(played.assistedActions[0]?.effect).toMatchObject({ kind: 'playCard', coinDiscard: [{ targetId: B, source: 'pottery' }] })
  })

  it('takes the counter the player of the card picks when the target holds tokens on several', () => {
    const base = withCounters(firstCivGame(), B, { pottery: 2, sheet: 3, codeOfLaws: 1 })
    const { state, itemId } = withCardInHand(base, 'Counterfeiters')
    const played = unwrap(play(state, itemId, { targets: [B], coinPicks: [{ targetId: B, source: 'codeOfLaws' }] }))
    expect(held(played, B, 'codeOfLaws')).toBe(0)
    expect(held(played, B, 'pottery')).toBe(2)
    expect(held(played, B, 'sheet')).toBe(3)
  })

  it('asks for a pick when the target holds tokens on several counters, and refuses a counter without tokens', () => {
    const base = withCounters(firstCivGame(), B, { pottery: 2, sheet: 3 })
    const { state, itemId } = withCardInHand(base, 'Counterfeiters')
    expect(reason(play(state, itemId, { targets: [B] }))).toContain('Choose which coin token Karandras1 discards')
    expect(reason(play(state, itemId, { targets: [B], coinPicks: [{ targetId: B, source: 'democracy' }] }))).toContain('holds no coin token on')
    expect(reason(play(state, itemId, { targets: [B], coinPicks: [{ targetId: B, source: 'civilService' }] }))).toContain('holds no coin token on')
    expect(reason(play(state, itemId, { targets: [B], coinPicks: [{ targetId: C, source: 'sheet' }] }))).toContain('only for a player')
    expect(reason(play(state, itemId, { targets: [B], coinPicks: [{ targetId: B, source: 'sheet' }, { targetId: B, source: 'pottery' }] }))).toContain('not several')
    // Nothing was taken or played by the refusals
    expect(held(state, B, 'sheet')).toBe(3)
    expect(player(state).items.some((item) => item.id === itemId)).toBe(true)
  })

  it('refuses a coin pick that is not an object instead of throwing', () => {
    const { state, itemId } = withCardInHand(withCounters(firstCivGame(), B, { pottery: 1 }), 'Counterfeiters')
    const result = play(state, itemId, { targets: [B], coinPicks: [null as unknown as { targetId: string; source: string }] })
    expect(reason(result)).toContain('Choose the coin token each player discards')
  })

  it('cannot be played, and is not offered, when the target holds no coin token', () => {
    const { state, itemId } = withCardInHand(withCounters(firstCivGame(), C, { sheet: 2 }), 'Counterfeiters')
    // Only Itchi holds a token: the card is offered, and refuses the others
    expect(playableCardsOf(state, player(state)).find((card) => card.itemId === itemId)?.status).toBe('ready')
    expect(reason(play(state, itemId, { targets: [B] }))).toContain('holds no coin token to discard')
    const none = withCardInHand(firstCivGame(), 'Counterfeiters')
    const card = playableCardsOf(none.state, player(none.state)).find((candidate) => candidate.itemId === none.itemId)
    expect(card).toMatchObject({ status: 'unavailable' })
    expect(card?.reason).toContain('holds a coin token')
    expect(reason(play(none.state, none.itemId, { targets: [B] }))).toContain('holds a coin token')
  })

  it('never takes printed coins, Great People, the Panama Canal or invested markers', () => {
    const base = withCounters(firstCivGame(), B, {
      civilService: 1,
      bureaucracy: 1,
      railroad: 1,
      computers: 1,
      bank: 2,
      adamSmith: 1,
      democracyGovernment: 1,
      greatPeople: 2,
      terrain: 1,
      panamaCanal: 4,
      organizedReligion: 1,
    })
    const { state, itemId } = withCardInHand(base, 'Counterfeiters')
    expect(reason(play(state, itemId, { targets: [B] }))).toContain('holds a coin token')
    const sheet = withCardInHand(withCounters(base, B, { sheet: 1 }), 'Counterfeiters')
    const played = unwrap(play(sheet.state, sheet.itemId, { targets: [B] }))
    for (const key of ['civilService', 'bureaucracy', 'railroad', 'computers', 'bank', 'adamSmith', 'democracyGovernment', 'terrain', 'organizedReligion'] as const) {
      expect(held(played, B, key)).toBe(held(sheet.state, B, key))
    }
    expect(held(played, B, 'panamaCanal')).toBe(4)
    expect(held(played, B, 'sheet')).toBe(0)
  })

  it('leaves the investments of the target alone', () => {
    const base = {
      ...withCounters(firstCivGame(), B, { sheet: 1 }),
    }
    const invested: GameState = {
      ...base,
      players: base.players.map((candidate) =>
        candidate.playerId === B ? { ...candidate, stats: { ...candidate.stats, infra: 2, efta: 1, mic: 3, pe: 1 } } : candidate,
      ),
    }
    const target = player(invested, B)
    const { state, itemId } = withCardInHand(invested, 'Counterfeiters')
    const played = unwrap(play(state, itemId, { targets: [B] }))
    const after = player(played, B)
    expect([after.stats.infra, after.stats.efta, after.stats.mic, after.stats.pe]).toEqual([2, 1, 3, 1])
    expect({ ...after, stats: { ...after.stats, coinSources: target.stats.coinSources } }).toEqual(target)
  })

  it('does not count the Education counter of a player who has not revealed Education', () => {
    const { state, itemId } = withCardInHand(withCounters(firstCivGame(), B, { education: 2 }), 'Counterfeiters')
    expect(coinSourcesOf(state, player(state, B)).education).toBe(0)
    expect(reason(play(state, itemId, { targets: [B] }))).toContain('holds a coin token')
  })

  it('is undone by the vote: the coin goes back to the same counter and the card to the hand', () => {
    const base = withCounters(firstCivGame(), B, { pottery: 2, sheet: 3 })
    const { state, itemId } = withCardInHand(base, 'Counterfeiters')
    const played = unwrap(play(state, itemId, { targets: [B], coinPicks: [{ targetId: B, source: 'pottery' }] }))
    expect(held(played, B, 'pottery')).toBe(1)
    const undone = undoByVote(played)
    expect(player(undone, B).stats.coinSources).toEqual(player(state, B).stats.coinSources)
    expect(player(undone).items.some((item) => item.id === itemId)).toBe(true)
    expect(undone.log.at(-1)?.publicLog).toContain('the discarded coin was given back')
  })

  it('is rewound by a cancel card: the coin comes back', () => {
    const base = withCounters(firstCivGame(), C, { sheet: 1 })
    const twain = withCardInHand(base, 'Jousting Tourney', D)
    const card = withCardInHand(twain.state, 'Counterfeiters')
    const baseline = card.state
    const played = unwrap(play(baseline, card.itemId, { targets: [C], requestId: 'target' }))
    expect(held(played, C, 'sheet')).toBe(0)
    const logId = played.assistedActions.find((record) => record.id === 'target')?.logId ?? ''
    const cancelled = unwrap(applyCancellation(played, { playerId: D, requestId: 'cancel', command: { logId, itemId: twain.itemId } }, baseline))
    expect(held(cancelled, C, 'sheet')).toBe(1)
  })

  it('shows the counters only in the own playable list, and no hand data leaks to others', () => {
    const base = withCounters(firstCivGame(), B, { pottery: 2 })
    const { state } = withCardInHand(base, 'Counterfeiters')
    const own = toPlayerView(state, A).you?.playableCards.find((card) => card.name === 'Counterfeiters')
    expect(own?.coinTargets).toEqual([{ playerId: B, username: 'Karandras1', counters: [{ key: 'pottery', label: 'Pottery (I)', coins: 2 }] }])
    expect(JSON.stringify(toPlayerView(state, B))).not.toContain('Counterfeiters')
    expect(JSON.stringify(toPlayerView(state, C))).not.toContain('Counterfeiters')
  })
})

describe('Depression', () => {
  it('takes a coin from each of the two players, each from the counter picked, and skips a target with no coin token', () => {
    const base = withCounters(withCounters(firstCivGame(), B, { pottery: 1, sheet: 1 }), C, { democracy: 2 })
    const { state, itemId } = withCardInHand(base, 'Depression')
    const played = unwrap(play(state, itemId, { targets: [B, C], coinPicks: [{ targetId: B, source: 'sheet' }] }))
    expect(held(played, B, 'sheet')).toBe(0)
    expect(held(played, B, 'pottery')).toBe(1)
    expect(held(played, C, 'democracy')).toBe(1)

    const skip = unwrap(play(state, itemId, { targets: [C, D] }))
    expect(held(skip, C, 'democracy')).toBe(1)
    expect(skip.log.at(-1)?.publicLog).toContain('Chul holds no coin token')
    expect(player(skip, D).stats.coinSources).toEqual(player(state, D).stats.coinSources)
  })

  it('cannot be played when none of the named players holds a coin token', () => {
    const { state, itemId } = withCardInHand(withCounters(firstCivGame(), B, { sheet: 1 }), 'Depression')
    expect(reason(play(state, itemId, { targets: [C, D] }))).toContain('None of the players Depression names holds a coin token')
  })

  it('is undone: every coin goes back to its counter', () => {
    const base = withCounters(withCounters(firstCivGame(), B, { pottery: 1 }), C, { democracy: 2 })
    const { state, itemId } = withCardInHand(base, 'Depression')
    const played = unwrap(play(state, itemId, { targets: [B, C] }))
    const undone = undoByVote(played)
    expect(player(undone, B).stats.coinSources).toEqual(player(base, B).stats.coinSources)
    expect(player(undone, C).stats.coinSources).toEqual(player(base, C).stats.coinSources)
    expect(totalCoins(coinSourcesOf(undone, player(undone, C)))).toBe(2)
  })
})

describe('Bank Scandal', () => {
  it('takes one coin from every other player who holds one, and skips the rest', () => {
    const base = withCounters(withCounters(withCounters(firstCivGame(), B, { codeOfLaws: 1 }), C, { printingPress: 3 }), A, { sheet: 5 })
    const { state, itemId } = withCardInHand(base, 'Bank Scandal')
    const played = unwrap(play(state, itemId))
    expect(held(played, B, 'codeOfLaws')).toBe(0)
    expect(held(played, C, 'printingPress')).toBe(2)
    // The player of the card is not a target
    expect(held(played, A, 'sheet')).toBe(5)
    expect(played.log.at(-1)?.publicLog).toContain('targeting every other player')
    expect(played.log.at(-1)?.publicLog).toContain('Chul holds no coin token')
  })

  it('needs a pick for a player with several counters, and cannot be played when nobody holds a coin token', () => {
    const base = withCounters(withCounters(firstCivGame(), B, { sheet: 1, pottery: 1 }), C, { sheet: 1 })
    const { state, itemId } = withCardInHand(base, 'Bank Scandal')
    expect(reason(play(state, itemId))).toContain('Choose which coin token Karandras1 discards')
    const done = unwrap(play(state, itemId, { coinPicks: [{ targetId: B, source: 'pottery' }] }))
    expect(held(done, B, 'pottery')).toBe(0)
    expect(held(done, B, 'sheet')).toBe(1)
    expect(held(done, C, 'sheet')).toBe(0)

    const none = withCardInHand(firstCivGame(), 'Bank Scandal')
    const card = playableCardsOf(none.state, player(none.state)).find((candidate) => candidate.itemId === none.itemId)
    expect(card?.status).toBe('unavailable')
    expect(reason(play(none.state, none.itemId))).toContain('holds a coin token')
  })
})

describe('the board is untouched by a coin card', () => {
  it('writes no board history', () => {
    const base = withCounters(firstCivGame(), B, { sheet: 1 })
    const { state, itemId } = withCardInHand(base, 'Counterfeiters')
    const played = unwrap(play(state, itemId, { targets: [B] }))
    expect(played.board).toEqual(state.board)
  })
})

describe('the coin marker in the target area goes with the Sheet coin', () => {
  const coinsOf = (state: GameState, playerId: string): readonly BoardPiece[] => {
    const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === playerId)
    if (area === undefined) throw new Error('no area')
    return state.board.pieces.filter(
      (piece) => piece.assetId === COIN_MARKER_ASSET_ID && piece.x >= area.x && piece.x < area.x + area.width && piece.y >= area.y,
    )
  }
  /** Karandras1 holds a Sheet coin of 1 and a coin marker in the area (which the sync counts: the Sheet is 2). */
  const scene = (extra: Counters = {}) => {
    const base = withCounters(firstCivGame(), B, { sheet: 1, ...extra })
    const area = playerAreas(base.board, base.players).find((candidate) => candidate.playerId === B)
    if (area === undefined) throw new Error('no area')
    return unwrap(placePiece(base, { playerId: B, assetId: COIN_MARKER_ASSET_ID, x: area.x + 40, y: area.y + 90 }))
  }

  it('removes the marker and takes the Sheet coin once, not twice', () => {
    const { state, itemId } = withCardInHand(scene(), 'Counterfeiters')
    expect(held(state, B, 'sheet')).toBe(2)
    expect(coinsOf(state, B)).toHaveLength(1)
    const played = unwrap(play(state, itemId, { targets: [B] }))
    expect(held(played, B, 'sheet')).toBe(1)
    expect(coinsOf(played, B)).toHaveLength(0)
    expect(played.assistedActions[0]?.effect).toMatchObject({ coinDiscard: [{ targetId: B, source: 'sheet', piece: { piece: { assetId: COIN_MARKER_ASSET_ID } } }] })
  })

  it('is undone by the vote: the same marker is back at its old place and the coin comes back once', () => {
    const { state, itemId } = withCardInHand(scene(), 'Counterfeiters')
    const before = coinsOf(state, B)[0]
    const played = unwrap(play(state, itemId, { targets: [B] }))
    // The board Undo cannot take that removal alone
    expect(unwrapErr(undoLastBoardChange(played, A)).kind).toBe('BOARD_UNDO_ASSISTED')
    const undone = undoByVote(played)
    expect(held(undone, B, 'sheet')).toBe(2)
    expect(coinsOf(undone, B)).toEqual(before === undefined ? [] : [before])
    expect(undone.board.pieces.map((piece) => piece.id)).toEqual(state.board.pieces.map((piece) => piece.id))
  })

  it('after the vote put the marker back the board Undo cannot take it off again, so the Sheet cannot drift', () => {
    const { state, itemId } = withCardInHand(scene(), 'Counterfeiters')
    const played = unwrap(play(state, itemId, { targets: [B] }))
    const undone = undoByVote(played)
    expect(held(undone, B, 'sheet')).toBe(2)
    expect(coinsOf(undone, B)).toHaveLength(1)
    // The history ends with the put-back entry, which the floor seals: nothing of it can be undone by the board
    expect(undone.board.undoFloor).toBe(undone.board.history.length)
    expect(undoLastBoardChange(undone, B).ok).toBe(false)
    expect(undoLastBoardChange(undone, A).ok).toBe(false)
    expect(held(undone, B, 'sheet')).toBe(2)
    expect(coinsOf(undone, B)).toHaveLength(1)
  })

  it('leaves the marker when the coin is taken from another counter, and when the target has no marker', () => {
    const { state, itemId } = withCardInHand(scene({ pottery: 1 }), 'Counterfeiters')
    const played = unwrap(play(state, itemId, { targets: [B], coinPicks: [{ targetId: B, source: 'pottery' }] }))
    expect(coinsOf(played, B)).toHaveLength(1)
    expect(held(played, B, 'sheet')).toBe(2)
    const bare = withCardInHand(withCounters(firstCivGame(), B, { sheet: 1 }), 'Counterfeiters')
    const done = unwrap(play(bare.state, bare.itemId, { targets: [B] }))
    expect(held(done, B, 'sheet')).toBe(0)
    expect(done.board.history).toEqual(bare.state.board.history)
  })

  it('takes one marker from each target for Bank Scandal, and a cancel card rewinds them', () => {
    const withC = (state: GameState): GameState => {
      const area = playerAreas(state.board, state.players).find((candidate) => candidate.playerId === C)
      if (area === undefined) throw new Error('no area')
      return unwrap(placePiece(state, { playerId: C, assetId: COIN_MARKER_ASSET_ID, x: area.x + 40, y: area.y + 90 }))
    }
    const joust = withCardInHand(withC(scene()), 'Jousting Tourney', D)
    const card = withCardInHand(joust.state, 'Bank Scandal')
    const baseline = card.state
    const played = unwrap(play(baseline, card.itemId, { requestId: 'target' }))
    expect(coinsOf(played, B)).toHaveLength(0)
    expect(coinsOf(played, C)).toHaveLength(0)
    const logId = played.assistedActions.find((record) => record.id === 'target')?.logId ?? ''
    const cancelled = unwrap(applyCancellation(played, { playerId: D, requestId: 'cancel', command: { logId, itemId: joust.itemId } }, baseline))
    expect(coinsOf(cancelled, B)).toHaveLength(1)
    expect(coinsOf(cancelled, C)).toHaveLength(1)
    expect(held(cancelled, B, 'sheet')).toBe(2)
    expect(held(cancelled, C, 'sheet')).toBe(1)
  })
})
