import { describe, expect, it } from 'vitest'
import { placePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { markPhasesDone, postOrder } from '../src/actions/turn.js'
import { initiateUndo } from '../src/actions/undo.js'
import { cityActionsTakenThisTurn, performAssistedAction, reverseAssistedAction } from '../src/assisted.js'
import { findBoardAsset, mapTop, slotOrigin, SQUARE_SIZE } from '../src/board.js'
import { applyCancellation, cancellationBaselineRevision, cancellationHistory } from '../src/cancellation.js'
import type { CancellationCommand } from '../src/cancellation.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap } from '../src/result.js'
import { toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'
import { publicTurn, publicTurnKey, turnStatus } from '../src/turn.js'
import { player, withCardInHand } from './assisted-fixture.js'
import { CASH1981 as A, KARANDRAS1 as B, ITCHI as C, CHUL as D, firstCivGame } from './fixture.js'

const command = (state: GameState, baseline: GameState | undefined, playerId: string, requestId: string, cmd: CancellationCommand) =>
  applyCancellation(state, { playerId, requestId, command: cmd }, baseline)
const act = (state: GameState, owner: string, itemId: string, id: string, targets: readonly string[] = []) =>
  unwrap(performAssistedAction(state, { playerId: owner, action: 'playCard', requestId: id, payload: { itemId, targets } }))
const logOf = (state: GameState, id: string) => {
  const logId = state.assistedActions.find((r) => r.id === id)?.logId
  if (logId === undefined) throw new Error('missing action')
  return logId
}
/** Cancels the action 'target' at once. */
const cancel = (state: GameState, baseline: GameState | undefined, itemId: string, owner = B, id = 'cancel') =>
  command(state, baseline, owner, id, { logId: logOf(state, 'target'), itemId })
/** Undoes the cancellation made with request `of`; `before` is the state just before that cancellation. */
const counter = (state: GameState, before: GameState | undefined, owner: string, itemId: string, of = 'cancel', id = 'counter') =>
  command(state, before, owner, id, { logId: `cancellation:${of}`, itemId })

function cityScene() {
  let state = firstCivGame()
  state = { ...state, players: state.players.map((p) => ({ ...p, color: p.playerId === A ? 'Red' : p.playerId === B ? 'Blue' : 'Green' })) }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: A, assetId: 'tiles/america', x, y }))
  state = unwrap(placePiece(state, { playerId: A, assetId: 'cities/redcapital2', x: SQUARE_SIZE + 4, y: mapTop(state.board) + SQUARE_SIZE + 4 }))
  const cityId = state.board.pieces.at(-1)?.id ?? ''
  state = unwrap(markPhasesDone(state, { playerId: A, turnNumber: 1, upToPhase: 'TRADE' }))
  const twain = withCardInHand(state, 'Mark Twain', B)
  return { baseline: twain.state, twainId: twain.itemId, cityId }
}
const devote = (state: GameState, cityId: string, id = 'target', repeat = false) =>
  unwrap(performAssistedAction(state, { playerId: A, action: 'devoteToTheArts', requestId: id, confirmedRepeat: repeat, payload: { cityPieceId: cityId } }))

function cultureScene(targets: readonly string[] = [], twainOwner = B) {
  let state = firstCivGame()
  const ids: Record<string, string> = {}
  for (const [key, name, owner] of [
    ['event', targets.length ? 'Counterfeiters' : 'Supply Drop', A],
    ['twain', 'Mark Twain', twainOwner], ['joust', 'Jousting Tourney', B],
    ['tv', 'Primetime TV', A], ['counter', 'Jousting Tourney', C],
    ['bread', 'Bread and Circuses', B],
  ] as const) {
    const given = withCardInHand(state, name, owner)
    state = given.state
    ids[key] = given.itemId
  }
  return { baseline: state, ids, current: act(state, A, ids['event'] ?? '', 'target', targets) }
}


describe('cancellation', () => {
  it.each(['twain', 'joust'])('rejects a new %s cancellation in an inactive game but replays a committed request unchanged', (card) => {
    const { baseline, current, ids } = cultureScene()
    const inactive = { ...current, active: false }
    const before = JSON.stringify(inactive)
    expect(cancel(inactive, baseline, ids[card] ?? '', B, 'new')).toMatchObject({
      ok: false,
      error: { kind: 'ASSISTED_ACTION_REJECTED', reason: 'A cancellation cannot be made in an inactive game.' },
    })
    expect(JSON.stringify(inactive)).toBe(before)
    const committed = { ...unwrap(cancel(current, baseline, ids[card] ?? '', B, 'committed')), active: false }
    expect(unwrap(cancel(committed, undefined, ids[card] ?? '', B, 'committed'))).toBe(committed)
  })

  it('cancels a city action at once: the action is rewound, Twain is spent and the event is logged', () => {
    const { baseline, cityId, twainId } = cityScene()
    const current = devote(baseline, cityId)
    const done = unwrap(cancel(current, baseline, twainId))
    expect(player(done).stats).toEqual(player(baseline).stats)
    expect(done.assistedActions.map((r) => r.status)).toEqual(['cancelled'])
    // The city's action stays spent
    expect(cityActionsTakenThisTurn(done, player(done), cityId)).toHaveLength(1)
    expect(done.discardedItems.filter((i) => i.id === twainId)).toHaveLength(1)
    expect(player(done, B).items.some((i) => i.id === twainId)).toBe(false)
    expect(done.log.at(-1)).toMatchObject({ id: 'cancellation:cancel' })
    expect(done.cancellations?.events).toMatchObject([{ kind: 'cancel', id: 'cancel', playerId: B, priorRevision: current.rev }])
    expect(done.cancellations?.sealedThrough).toBe(done.log.length)
    expect(done.rng).toBe(current.rng)
  })

  it('rewinds cross-phase and interleaved work while preserving notes, order text, versions and superseded history', () => {
    const { baseline, cityId, twainId } = cityScene()
    let current = devote(baseline, cityId)
    current = devote(current, cityId, 'later', true)
    current = unwrap(markPhasesDone(current, { playerId: A, turnNumber: 1, upToPhase: 'RESEARCH' }))
    current = unwrap(draw(current, { playerId: C, sheetName: 'CULTURE_1', confirmedOutOfTurn: true }))
    current = unwrap(postOrder(current, { playerId: C, turnNumber: 1, phase: 'SOT', markdown: 'Keep my draft and versions', at: '2026-11-05' }))
    current = { ...current, itemCounter: current.itemCounter + 10, players: current.players.map((p) => ({ ...p, gamenote: `private-${p.playerId}` })) }
    const done = unwrap(cancel(current, baseline, twainId))
    expect(done.assistedActions.map((r) => r.status)).toEqual(['cancelled', 'superseded'])
    expect(cityActionsTakenThisTurn(done, player(done), cityId)).toHaveLength(1)
    expect(player(done).playerTurns[0]?.done.CM).toBe(false)
    expect(player(done, C).playerTurns[0]).toMatchObject({
      orders: { SOT: 'Keep my draft and versions' }, needsRevision: true,
      history: { SOT: [{ markdown: 'Keep my draft and versions', at: '2026-11-05' }] },
    })
    expect(player(done, C).gamenote).toBe(`private-${C}`)
    expect(done.itemCounter).toBe(current.itemCounter)
    expect(done.log.find((l) => l.id === logOf(current, 'later'))).toMatchObject({ superseded: true })
    expect(done.items.filter((i) => i.sheetName === 'CULTURE_1')).not.toEqual(baseline.items.filter((i) => i.sheetName === 'CULTURE_1'))
    expect(new Set(done.items.map((i) => i.id))).toEqual(new Set(baseline.items.map((i) => i.id)))
    expect(initiateUndo(done, { playerId: A, logId: logOf(current, 'later') }).ok).toBe(false)
  })

  it.each(['before cancellation', 'reverted before cancellation'] as const)(
    'reopens revised baseline-completed orders (%s) but leaves unchanged completed phases done',
    (timing) => {
      const scene = cityScene()
      const original = { markdown: 'Original SOT order', at: '2026-11-05T09:00:00Z' }
      const revised = { markdown: 'Revised SOT order', at: '2026-11-05T10:00:00Z' }
      const reverted = { markdown: original.markdown, at: '2026-11-05T11:00:00Z' }
      let baseline = unwrap(postOrder(scene.baseline, { playerId: C, turnNumber: 1, phase: 'SOT', ...original }))
      baseline = unwrap(postOrder(baseline, {
        playerId: C, turnNumber: 1, phase: 'TRADE', markdown: 'Unchanged trade order', at: original.at,
      }))
      baseline = unwrap(markPhasesDone(baseline, { playerId: C, turnNumber: 1, upToPhase: 'TRADE' }))
      let current = devote(baseline, scene.cityId)
      current = unwrap(postOrder(current, { playerId: C, turnNumber: 1, phase: 'SOT', ...revised }))
      if (timing === 'reverted before cancellation') {
        current = unwrap(postOrder(current, { playerId: C, turnNumber: 1, phase: 'SOT', ...reverted }))
      }
      // Saved baseline and live history must compare by content, not object identity.
      current = JSON.parse(JSON.stringify(current)) as GameState
      const before = JSON.stringify({ baseline, current })
      const done = unwrap(cancel(current, baseline, scene.twainId))
      const restored = player(done, C).playerTurns[0]
      expect(restored).toMatchObject({
        done: { SOT: false, TRADE: true },
        needsRevision: true,
        revisionPhases: ['SOT', 'CM', 'MOVEMENT', 'RESEARCH'],
      })
      expect(restored?.orders).toEqual(player(current, C).playerTurns[0]?.orders)
      expect(restored?.history).toEqual(player(current, C).playerTurns[0]?.history)
      expect(restored?.history.SOT).toEqual(timing === 'reverted before cancellation'
        ? [original, revised, reverted] : [original, revised])
      expect(JSON.stringify({ baseline, current })).toBe(before)
    },
  )

  it('retains edited earlier-turn orders without reopening completed turns behind restored gameplay', () => {
    const scene = cityScene()
    const original = { markdown: 'Turn one research', at: '2026-11-05T09:00:00Z' }
    const revised = { markdown: 'Corrected turn one research', at: '2026-11-05T10:00:00Z' }
    let baseline = unwrap(postOrder(scene.baseline, { playerId: C, turnNumber: 1, phase: 'RESEARCH', ...original }))
    for (const p of baseline.players) {
      baseline = unwrap(markPhasesDone(baseline, { playerId: p.playerId, turnNumber: 1, upToPhase: 'RESEARCH' }))
    }
    baseline = unwrap(markPhasesDone(baseline, { playerId: A, turnNumber: 2, upToPhase: 'TRADE' }))
    expect(turnStatus(baseline).currentTurn).toBe(2)
    let current = devote(baseline, scene.cityId)
    current = unwrap(performAssistedAction(current, {
      playerId: A, action: 'startBuildingProgram', requestId: 'later', confirmedRepeat: true,
      payload: { cityPieceId: scene.cityId },
    }))
    expect(current.board).not.toEqual(baseline.board)
    expect(player(current).stats).not.toEqual(player(baseline).stats)
    current = unwrap(postOrder(current, { playerId: C, turnNumber: 1, phase: 'RESEARCH', ...revised }))
    const before = JSON.stringify({ baseline, current })
    const done = unwrap(cancel(current, baseline, scene.twainId))
    expect(turnStatus(done).currentTurn).toBe(2)
    expect(done.board).toEqual(baseline.board)
    expect(player(done).stats).toEqual(player(baseline).stats)
    for (const p of baseline.players) {
      const older = player(done, p.playerId).playerTurns.find((t) => t.turnNumber === 1)
      const saved = p.playerTurns.find((t) => t.turnNumber === 1)
      expect(older?.done).toEqual(saved?.done)
      expect(older?.needsRevision).toBe(saved?.needsRevision)
      expect(older?.revisionPhases).toEqual(saved?.revisionPhases)
    }
    const older = player(done, C).playerTurns.find((t) => t.turnNumber === 1)
    expect(older?.orders.RESEARCH).toBe(revised.markdown)
    expect(older?.history.RESEARCH).toEqual([original, revised])
    if (older === undefined) throw new Error('missing older turn')
    expect(done.publicTurns[publicTurnKey(older)]).toEqual(publicTurn(older))
    expect(player(done).playerTurns.find((t) => t.turnNumber === 2)).toMatchObject({
      done: { CM: false }, needsRevision: true,
    })
    expect(JSON.stringify({ baseline, current })).toBe(before)
  })

  it('restores earlier action records too when a later undo changed them after the target', () => {
    const scene = cityScene()
    const baseline = devote(scene.baseline, scene.cityId, 'earlier')
    const target = devote(baseline, scene.cityId, 'target', true)
    const current = unwrap(reverseAssistedAction(target, 'earlier'))
    expect(current.assistedActions[0]?.status).toBe('undone')
    const done = unwrap(cancel(current, baseline, scene.twainId))
    expect(done.assistedActions.map((r) => r.status)).toEqual(['applied', 'cancelled'])
    expect(player(done).stats).toEqual(player(baseline).stats)
    expect(done.log.slice(0, baseline.log.length)).toEqual(baseline.log)
  })

  it('counters a culture cancellation and its counter: every card played is spent exactly once', () => {
    const { baseline, current, ids } = cultureScene()
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    expect(first.assistedActions[0]?.status).toBe('cancelled')
    const second = unwrap(counter(first, current, A, ids['tv'] ?? ''))
    expect(second.assistedActions[0]?.status).toBe('applied')
    expect(second.cancellations?.events.map((e) => e.kind)).toEqual(['cancel', 'counter'])
    const third = unwrap(counter(second, first, C, ids['counter'] ?? '', 'counter', 'counter-counter'))
    expect(third.assistedActions[0]?.status).toBe('cancelled')
    for (const key of ['event', 'joust', 'tv', 'counter']) {
      expect(third.discardedItems.filter((i) => i.id === ids[key])).toHaveLength(1)
    }
  })

  it('preserves the original continuation and draws when a culture cancellation is countered', () => {
    const { baseline, current: played, ids } = cultureScene()
    const current = unwrap(draw(played, { playerId: C, sheetName: 'CULTURE_2', confirmedOutOfTurn: true }))
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    const done = unwrap(counter(first, current, A, ids['tv'] ?? ''))
    expect(done.items).toEqual(current.items)
    expect(done.board).toEqual(current.board)
    expect(player(done, C)).toEqual(player(current, C))
    expect(done.assistedActions).toEqual(current.assistedActions)
    expect(done.log.slice(0, current.log.length)).toEqual(current.log)
    expect(done.discardedItems.filter((i) => i.id === ids['event'])).toHaveLength(1)
    for (const key of ['joust', 'tv']) expect(done.discardedItems.filter((i) => i.id === ids[key])).toHaveLength(1)
  })

  it('counters after gameplay went on: the later play is superseded and the saved state comes back', () => {
    const { baseline, current, ids } = cultureScene()
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    const later = unwrap(draw(first, { playerId: C, sheetName: 'CULTURE_2', confirmedOutOfTurn: true }))
    const done = unwrap(counter(later, current, A, ids['tv'] ?? ''))
    expect(done.assistedActions[0]?.status).toBe('applied')
    expect(done.items).toEqual(current.items)
    expect(player(done, C)).toEqual(player(current, C))
    expect(done.log.slice(0, current.log.length)).toEqual(current.log)
    expect(done.log.some((l) => l.id === 'cancellation:cancel')).toBe(true)
    expect(done.log.slice(current.log.length).filter((l) => l.superseded && l.publicLog !== '')).not.toHaveLength(0)
  })

  it('refuses a counter after the roster changed, like a cancellation does', () => {
    const { baseline, current, ids } = cultureScene()
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    const left = { ...first, players: first.players.filter((p) => p.playerId !== D) }
    expect(counter(left, current, A, ids['tv'] ?? '').ok).toBe(false)
    expect(JSON.stringify(counter(left, current, A, ids['tv'] ?? ''))).toContain('Player membership changed')
  })

  it('does not treat Twain as a culture event or infer Bread and Circuses counters', () => {
    const { baseline, current, ids } = cultureScene()
    const byTwain = unwrap(cancel(current, baseline, ids['twain'] ?? ''))
    expect(counter(byTwain, current, A, ids['tv'] ?? '').ok).toBe(false)
    const byJoust = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    expect(counter(byJoust, current, B, ids['bread'] ?? '').ok).toBe(false)
  })

  it.each([C, A])('lets Twain held by %s counter another player’s culture cancellation and preserves the continuation', (twainOwner) => {
    const { baseline, current: played, ids } = cultureScene([], twainOwner)
    const current = unwrap(draw(played, { playerId: D, sheetName: 'CULTURE_2', confirmedOutOfTurn: true }))
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    const offered = toPlayerView(first, twainOwner).cancellations?.responseCards.find((c) => c.itemId === ids['twain'])?.targets
    expect(offered?.map((t) => t.logId)).toContain('cancellation:cancel')
    const done = unwrap(counter(first, current, twainOwner, ids['twain'] ?? ''))
    for (const [owner, key] of [[A, 'tv'], [C, 'counter'], [B, 'bread']] as const) {
      expect(counter(done, first, owner, ids[key] ?? '', 'counter', 'against-twain').ok).toBe(false)
      expect(toPlayerView(done, owner).cancellations?.responseCards.find((c) => c.itemId === ids[key])?.targets
        .some((t) => t.logId === 'cancellation:counter')).toBe(false)
    }
    expect(done.items).toEqual(current.items)
    expect(done.board).toEqual(current.board)
    expect(done.assistedActions).toEqual(current.assistedActions)
    expect(done.log.slice(0, current.log.length)).toEqual(current.log)
    expect(done.players).toEqual(current.players.map((p) => ({
      ...p, items: p.items.filter((i) => i.id !== ids['joust'] && i.id !== ids['twain']),
    })))
    for (const key of ['event', 'joust', 'twain']) {
      expect(done.discardedItems.filter((i) => i.id === ids[key])).toHaveLength(1)
    }
  })

  it('rejects Twain against its owner’s cancellation but permits another player’s Primetime TV', () => {
    const { baseline, current, ids } = cultureScene()
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    expect(counter(first, current, B, ids['twain'] ?? '', 'cancel', 'own-counter').ok).toBe(false)
    expect(toPlayerView(first, B).cancellations?.responseCards.find((c) => c.itemId === ids['twain'])?.targets
      .some((t) => t.logId === 'cancellation:cancel')).toBe(false)
    const second = unwrap(counter(first, current, A, ids['tv'] ?? '', 'cancel', 'tv-counter'))
    expect(counter(second, first, B, ids['twain'] ?? '', 'tv-counter', 'twain-counter').ok).toBe(true)
  })

  it('allows Bread and Circuses only when the original event actually targets its owner', () => {
    const permitted = cultureScene([B])
    expect(cancel(permitted.current, permitted.baseline, permitted.ids['bread'] ?? '').ok).toBe(true)
    const otherTarget = cultureScene([C])
    expect(cancel(otherTarget.current, otherTarget.baseline, otherTarget.ids['bread'] ?? '').ok).toBe(false)
  })

  it('lets King undo a cancellation of his holder’s city action: Twain stays in hand and King is revealed', () => {
    const scene = cityScene()
    const king = withCardInHand(scene.baseline, 'Dr. Martin Luther King', A)
    const baseline = king.state
    const current = unwrap(draw(devote(baseline, scene.cityId), { playerId: C, sheetName: 'CULTURE_1', confirmedOutOfTurn: true }))
    const first = unwrap(cancel(current, baseline, scene.twainId))
    expect(toPlayerView(first, A).cancellations?.responseCards.find((c) => c.itemId === king.itemId)?.targets.map((t) => t.logId))
      .toEqual(['cancellation:cancel'])
    expect(toPlayerView(first, C).cancellations?.responseCards).toEqual([])
    const done = unwrap(counter(first, current, A, king.itemId, 'cancel', 'king'))
    expect(done.cancellations?.events.map((e) => e.kind)).toEqual(['cancel', 'protect'])
    expect(player(done, B).items.some((i) => i.id === scene.twainId)).toBe(true)
    expect(done.discardedItems.some((i) => i.id === scene.twainId)).toBe(false)
    expect(done.items).toEqual(current.items)
    expect(player(done).stats).toEqual(player(current).stats)
    expect(player(done).items.find((i) => i.id === king.itemId)?.hidden).toBe(false)
    expect(done.assistedActions).toEqual(current.assistedActions)
    // King is protection: nobody can answer it
    expect(counter(done, first, B, scene.twainId, 'king', 'again').ok).toBe(false)
  })

  it('offers King only against a cancellation of his holder’s own city action', () => {
    const { baseline: cityBase, cityId, twainId } = cityScene()
    const king = withCardInHand(cityBase, 'Dr. Martin Luther King', C)
    const current = devote(king.state, cityId)
    const first = unwrap(cancel(current, king.state, twainId))
    expect(counter(first, current, C, king.itemId, 'cancel', 'king').ok).toBe(false)
    const culture = cultureScene()
    const kingCulture = withCardInHand(culture.baseline, 'Dr. Martin Luther King', A)
    const played = act(kingCulture.state, A, culture.ids['event'] ?? '', 'target')
    const byJoust = unwrap(cancel(played, kingCulture.state, culture.ids['joust'] ?? ''))
    expect(counter(byJoust, played, A, kingCulture.itemId, 'cancel', 'king').ok).toBe(false)
  })

  it('rejects later-acquired, already-spent and historically unchosen cancellation cards', () => {
    const { baseline, current, ids } = cultureScene()
    const noHistoricalCard = { ...baseline, players: baseline.players.map((p) => p.playerId === B ? { ...p, items: p.items.filter((i) => i.id !== ids['joust']) } : p) }
    expect(cancel(current, noHistoricalCard, ids['joust'] ?? '').ok).toBe(false)
    const candidate = { ...baseline, players: baseline.players.map((p) => p.playerId === B ? { ...p, pendingRewards: [
      { id: 'reward', kind: 'event' as const, level: 1 as const, step: 1, candidateIds: [ids['joust'] ?? ''], keep: 1 as const },
    ] } : p) }
    expect(cancel(current, candidate, ids['joust'] ?? '').ok).toBe(false)
    const spent = { ...current, players: noHistoricalCard.players }
    expect(cancel(spent, baseline, ids['joust'] ?? '').ok).toBe(false)
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    expect(counter(first, current, B, ids['joust'] ?? '', 'cancel', 'again').ok).toBe(false)
  })

  it('checks historical blockade even when the card is no longer blockaded now', () => {
    const scene = cityScene()
    const put = (state: GameState, assetId: string, column: number, row: number) => {
      const asset = findBoardAsset(assetId)
      if (asset === undefined) throw new Error(`no ${assetId}`)
      return unwrap(placePiece(state, { playerId: B, assetId,
        x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
        y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
      }))
    }
    let baseline = put(scene.baseline, 'cities/bluecity2', 5, 5)
    baseline = put(baseline, 'great people/artist', 6, 5)
    baseline = put(baseline, 'figures/redarmy', 6, 5)
    const current = devote(baseline, scene.cityId)
    const unblocked = { ...current, board: { ...current.board, pieces: current.board.pieces.filter((p) => p.assetId !== 'figures/redarmy') } }
    const response = command(unblocked, baseline, B, 'cancel', { itemId: scene.twainId, logId: logOf(current, 'target') })
    expect(response.ok).toBe(false)
    expect(JSON.stringify(response)).toContain('available both before')
  })

  it('stores events without snapshots, reloads them, and drops the fields of the old dispute flow', () => {
    const { baseline, current, ids } = cultureScene()
    const done = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    const reloaded = migrateGameState(JSON.parse(JSON.stringify(done)) as GameState)
    expect(reloaded.cancellations).toEqual(done.cancellations)
    expect(JSON.stringify(reloaded.cancellations?.events)).not.toContain('"players"')
    expect(cancellationBaselineRevision(done, 'cancellation:cancel')).toBe(current.rev)
    expect(cancellationBaselineRevision(done, logOf(done, 'target'))).toBe(baseline.rev)
    const old = { ...done, cancellations: { floorTurn: 3, sealedThrough: 4, cases: [{ outcome: 'pending' }], acknowledgements: {}, requests: [] } }
    expect(migrateGameState(old as unknown as GameState).cancellations).toEqual({ floorTurn: 3, sealedThrough: 4, events: [], requests: [] })
  })

  it('fails missing or incorrect history atomically', () => {
    const { baseline, cityId, twainId } = cityScene()
    const current = devote(baseline, cityId)
    expect(cancel(current, undefined, twainId).ok).toBe(false)
    expect(cancel(current, { ...baseline, rev: baseline.rev + 1 }, twainId).ok).toBe(false)
    expect(cancel(current, current, twainId).ok).toBe(false)
    const first = unwrap(cancel(current, baseline, twainId))
    const original = JSON.stringify(first)
    expect(counter(first, undefined, A, twainId).ok).toBe(false)
    expect(counter(first, baseline, A, twainId).ok).toBe(false)
    expect(JSON.stringify(first)).toBe(original)
  })

  it('makes cancellations idempotent and rejects a request id reused for another meaning', () => {
    const { baseline, current, ids } = cultureScene()
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    expect(unwrap(cancel(first, undefined, ids['joust'] ?? ''))).toBe(first)
    expect(cancel(first, baseline, ids['twain'] ?? '').ok).toBe(false)
    const second = unwrap(counter(first, current, A, ids['tv'] ?? ''))
    expect(unwrap(counter(second, undefined, A, ids['tv'] ?? ''))).toBe(second)
    expect(counter(second, first, A, ids['tv'] ?? '', 'cancel', 'counter').ok).toBe(true)
    expect(command(second, first, C, 'counter', { logId: 'cancellation:cancel', itemId: ids['counter'] ?? '' }).ok).toBe(false)
  })

  it('seals the history: a cancelled action cannot be cancelled again', () => {
    const { baseline, current, ids } = cultureScene()
    const first = unwrap(cancel(current, baseline, ids['joust'] ?? ''))
    expect(first.cancellations?.sealedThrough).toBe(first.log.length)
    expect(cancel(first, baseline, ids['twain'] ?? '', B, 'again').ok).toBe(false)
  })

  it('persists the adoption floor over later turns', () => {
    const { baseline, cityId, twainId } = cityScene()
    const { cancellations: _old, ...legacy } = baseline
    const adopted = migrateGameState(legacy)
    let current = devote(adopted, cityId)
    for (const p of current.players) current = unwrap(markPhasesDone(current, { playerId: p.playerId, turnNumber: 1, upToPhase: 'RESEARCH' }))
    expect(cancellationHistory(migrateGameState(current)).floorTurn).toBe(1)
    expect(cancel(current, adopted, twainId).ok).toBe(true)
    expect(migrateGameState(adopted)).toEqual(adopted)
  })

  it('projects only the viewer’s own cards and public log lines, never snapshots or private inputs', () => {
    const { baseline, current, ids } = cultureScene()
    const withSecrets = { ...current, logSecret: 'secret-log-key', players: current.players.map((p) => ({ ...p, gamenote: 'secret-note' })),
      assistedActions: current.assistedActions.map((r) => ({ ...r, selectedInputs: { secret: 'secret-choice' } })) }
    const done = unwrap(cancel(withSecrets, baseline, ids['joust'] ?? ''))
    for (const viewer of [A, C, 'spectator']) {
      const projected = toPlayerView(done, viewer)
      const view = JSON.stringify(projected.cancellations)
      for (const secret of ['secret-choice', 'secret-log-key', 'secret-note', 'priorRevision', 'beforeRevision', 'fingerprint', 'candidateIds', ids['joust'] ?? '', ids['twain'] ?? '']) expect(view).not.toContain(secret)
      expect(JSON.stringify(projected)).not.toContain('secret-choice')
    }
    expect(toPlayerView(done, 'spectator').cancellations?.responseCards).toEqual([])
  })

  it('retains intentional Garcia and Lovelace exclusions and faceup King protection', () => {
    const { baseline, cityId, twainId } = cityScene()
    const current = devote(baseline, cityId)
    const lovelace = { ...current, assistedActions: current.assistedActions.map((r) => ({ ...r, lovelaceCreditId: 'extra-action' })) }
    expect(command(lovelace, baseline, B, 'cancel', { logId: logOf(current, 'target'), itemId: twainId }).ok).toBe(false)
    const king = withCardInHand(baseline, 'Dr. Martin Luther King', A)
    const faceup = { ...king.state, players: king.state.players.map((p) => ({ ...p, items: p.items.map((i) => i.id === king.itemId ? { ...i, hidden: false } : i) })) }
    const protectedAction = devote(faceup, cityId)
    expect(command(protectedAction, faceup, B, 'cancel', { logId: logOf(protectedAction, 'target'), itemId: twainId }).ok).toBe(false)
    const garcia = withCardInHand(baseline, 'Jerry Garcia', A)
    const garciaAction = act(garcia.state, A, garcia.itemId, 'target')
    expect(command(garciaAction, garcia.state, B, 'cancel', { logId: logOf(garciaAction, 'target'), itemId: twainId }).ok).toBe(false)
  })
})
