/** Card-specific eligibility. Reversible settlement is exercised in cancellation.test.ts. */
import { describe, expect, it } from 'vitest'
import { performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { draw } from '../src/actions/draw.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { unwrap } from '../src/result.js'
import { twainTargetsOf } from '../src/twain.js'
import { player, withCardInHand } from './assisted-fixture.js'
import { CASH1981 as A, KARANDRAS1 as B, ITCHI as C, firstCivGame } from './fixture.js'

function scene() {
  const twain = withCardInHand(firstCivGame(), 'Mark Twain', B)
  const event = withCardInHand(twain.state, 'Supply Drop', A)
  const played = unwrap(performAssistedAction(event.state, {
    playerId: A, action: 'playCard', requestId: 'event', payload: { itemId: event.itemId, targets: [] },
  }))
  return { played, twainId: twain.itemId }
}

describe('Mark Twain targets', () => {
  it('lists interleaved actions across completed phases instead of hiding or refusing them', () => {
    const { played } = scene()
    let state = unwrap(markPhasesDone(played, { playerId: A, turnNumber: 1, upToPhase: 'RESEARCH' }))
    state = unwrap(draw(state, { playerId: C, sheetName: 'CULTURE_1', confirmedOutOfTurn: true }))
    const targets = twainTargetsOf(state, player(state, B))
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({ kind: 'culture', blocked: null })
    expect(targets[0]).not.toHaveProperty('rolledBack')
    expect(JSON.stringify(targets)).not.toContain('privateLog')
  })

  it('projects multiple targets without copying growing history into each target', () => {
    const { played } = scene()
    const event = withCardInHand(played, 'Supply Drop', A)
    const state = unwrap(performAssistedAction(event.state, {
      playerId: A, action: 'playCard', requestId: 'second-event', confirmedRepeat: true,
      payload: { itemId: event.itemId, targets: [] },
    }))
    const targets = twainTargetsOf(state, player(state, B))
    expect(targets).toHaveLength(2)
    for (const count of [10, 100]) {
      let growing = state
      for (let i = 0; i < count; i++) {
        growing = unwrap(markPhasesDone(growing, { playerId: C, turnNumber: i + 2, upToPhase: 'RESEARCH' }))
      }
      expect(growing.log.length).toBeGreaterThan(state.log.length)
      const projected = twainTargetsOf(growing, player(growing, B))
      expect(projected).toEqual(targets)
      expect(JSON.stringify(projected)).not.toContain('rolledBack')
      expect(JSON.stringify(projected)).not.toContain('privateLog')
    }
  })

  it('explains the sealed history and own-action restriction', () => {
    const { played } = scene()
    const sealed = { ...played, cancellations: {
      floorTurn: 1, sealedThrough: played.log.length, events: [], requests: [],
    } }
    expect(twainTargetsOf(sealed, player(sealed, B))[0]?.blocked).toContain('earlier cancellation')
    const twain = player(played, B).items.find((i) => i.kind === 'greatperson' && i.name === 'Mark Twain')
    if (twain === undefined) throw new Error('no Twain')
    expect(twainTargetsOf(played, { ...player(played, A), items: [twain] })[0]?.blocked).toContain('Your own action')
  })

  it('offers no targets when Twain is an unchosen reward candidate or absent', () => {
    const { played, twainId } = scene()
    const holder = player(played, B)
    expect(twainTargetsOf(played, { ...holder, pendingRewards: [
      { id: 'reward', kind: 'event', level: 1, step: 1, candidateIds: [twainId], keep: 1 },
    ] })).toEqual([])
    expect(twainTargetsOf(played, { ...holder, items: [] })).toEqual([])
  })

  it('keeps King a passive card that may be made publicly effective', () => {
    const king = withCardInHand(firstCivGame(), 'Dr. Martin Luther King', A)
    expect(playableCardsOf(king.state, player(king.state)).find((i) => i.itemId === king.itemId)).toMatchObject({ passive: true, status: 'ready' })
    const used = unwrap(performAssistedAction(king.state, {
      playerId: A, action: 'playCard', requestId: 'king', payload: { itemId: king.itemId, targets: [] },
    }))
    expect(player(used).items.find((i) => i.id === king.itemId)?.hidden).toBe(false)
    expect(playableCardsOf(used, player(used)).find((i) => i.itemId === king.itemId)?.inEffect).toBe(true)
  })
})
