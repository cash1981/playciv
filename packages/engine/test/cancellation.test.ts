import { describe, expect, it } from 'vitest'
import { placePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import { markPhasesDone, postOrder } from '../src/actions/turn.js'
import { initiateUndo } from '../src/actions/undo.js'
import { cityActionsTakenThisTurn, performAssistedAction, reverseAssistedAction } from '../src/assisted.js'
import { findBoardAsset, mapTop, slotOrigin, SQUARE_SIZE } from '../src/board.js'
import { applyCancellation, cancellationHistory, openCancellation } from '../src/cancellation.js'
import type { CancellationCommand } from '../src/cancellation.js'
import { migrateGameState } from '../src/migrate.js'
import { unwrap } from '../src/result.js'
import { toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'
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
const open = (state: GameState, baseline: GameState, itemId: string, owner = B) =>
  unwrap(command(state, baseline, owner, 'open', { kind: 'open', logId: logOf(state, 'target'), itemId }))
const respond = (state: GameState, baseline: GameState, owner: string, itemId: string, id: string, targetId: string | null) => {
  const c = openCancellation(state)
  if (c === undefined) throw new Error('no dispute')
  return command(state, baseline, owner, id, { kind: 'respond', caseId: c.id, version: c.version, itemId, targetId })
}
const pass = (state: GameState, baseline: GameState | undefined, owner: string, id = `pass-${owner}`) => {
  const c = openCancellation(state)
  if (c === undefined) throw new Error('no dispute')
  return command(state, baseline, owner, id, { kind: 'pass', caseId: c.id, version: c.version })
}
const settle = (state: GameState, baseline: GameState) =>
  state.players.reduce((next, p) => unwrap(pass(next, baseline, p.playerId)), state)

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

describe('durable cancellation disputes', () => {
  it('opens without changing gameplay, costs, decks or randomness and requires every player to pass', () => {
    const { baseline, cityId, twainId } = cityScene()
    const current = devote(baseline, cityId)
    const original = JSON.stringify(current)
    const pending = open(current, baseline, twainId)
    expect(JSON.stringify(current)).toBe(original)
    expect(pending.players).toEqual(current.players)
    expect(pending.items).toEqual(current.items)
    expect(pending.discardedItems).toEqual(current.discardedItems)
    expect(pending.board).toEqual(current.board)
    expect(pending.rng).toBe(current.rng)
    const two = unwrap(pass(unwrap(pass(pending, baseline, A)), baseline, B))
    expect(openCancellation(two)?.passes).toEqual([A, B])
    expect(player(two).stats).toEqual(player(current).stats)
    const done = unwrap(pass(unwrap(pass(two, baseline, C)), baseline, D))
    expect(player(done).stats).toEqual(player(baseline).stats)
    expect(done.discardedItems.filter((i) => i.id === twainId)).toHaveLength(1)
    expect(cityActionsTakenThisTurn(done, player(done), cityId)).toHaveLength(1)
  })

  it('rewinds cross-phase and interleaved work while preserving notes, order text, versions and superseded history', () => {
    const { baseline, cityId, twainId } = cityScene()
    let current = devote(baseline, cityId)
    current = devote(current, cityId, 'later', true)
    current = unwrap(markPhasesDone(current, { playerId: A, turnNumber: 1, upToPhase: 'RESEARCH' }))
    current = unwrap(draw(current, { playerId: C, sheetName: 'CULTURE_1', confirmedOutOfTurn: true }))
    current = unwrap(postOrder(current, { playerId: C, turnNumber: 1, phase: 'SOT', markdown: 'Keep my draft and versions', at: '2026-11-05' }))
    current = { ...current, itemCounter: current.itemCounter + 10, players: current.players.map((p) => ({ ...p, gamenote: `private-${p.playerId}` })) }
    const done = settle(open(current, baseline, twainId), baseline)
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

  it.each(['before dispute', 'during dispute', 'reverted during dispute'] as const)(
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
      if (timing === 'before dispute') {
        current = unwrap(postOrder(current, { playerId: C, turnNumber: 1, phase: 'SOT', ...revised }))
      }
      let pending = open(current, baseline, scene.twainId)
      if (timing !== 'before dispute') {
        pending = unwrap(postOrder(pending, { playerId: C, turnNumber: 1, phase: 'SOT', ...revised }))
      }
      if (timing === 'reverted during dispute') {
        pending = unwrap(postOrder(pending, { playerId: C, turnNumber: 1, phase: 'SOT', ...reverted }))
      }
      // Saved baseline and live history must compare by content, not object identity.
      pending = JSON.parse(JSON.stringify(pending)) as GameState
      const beforeSettlement = JSON.stringify({ baseline, pending })
      expect(player(baseline, C).playerTurns[0]?.done).toMatchObject({ SOT: true, TRADE: true })
      expect(player(pending, C).playerTurns[0]?.done).toMatchObject({ SOT: true, TRADE: true })
      const done = settle(pending, baseline)
      const restored = player(done, C).playerTurns[0]
      expect(done.cancellations?.cases[0]?.outcome).toBe('cancelled')
      expect(restored).toMatchObject({
        done: { SOT: false, TRADE: true },
        needsRevision: true,
        revisionPhases: ['SOT', 'CM', 'MOVEMENT', 'RESEARCH'],
      })
      expect(restored?.orders).toEqual(player(pending, C).playerTurns[0]?.orders)
      expect(restored?.history).toEqual(player(pending, C).playerTurns[0]?.history)
      expect(restored?.revealed).toEqual(player(pending, C).playerTurns[0]?.revealed)
      expect(restored?.history.SOT).toEqual(timing === 'reverted during dispute'
        ? [original, revised, reverted] : [original, revised])
      expect(JSON.stringify({ baseline, pending })).toBe(beforeSettlement)
    },
  )

  it('resolves a culture counter and counter-counter, charging every committed card exactly once', () => {
    const { baseline, current, ids } = cultureScene()
    let pending = open(current, baseline, ids['joust'] ?? '')
    pending = unwrap(pass(pending, baseline, A, 'old-pass'))
    pending = unwrap(respond(pending, baseline, A, ids['tv'] ?? '', 'counter', 'open'))
    expect(openCancellation(pending)?.passes).toEqual([])
    expect(openCancellation(pending)?.version).toBe(2)
    pending = unwrap(respond(pending, baseline, C, ids['counter'] ?? '', 'counter-counter', 'counter'))
    const done = settle(pending, baseline)
    expect(done.cancellations?.cases[0]?.outcome).toBe('cancelled')
    for (const key of ['event', 'joust', 'tv', 'counter']) {
      expect(done.discardedItems.filter((i) => i.id === ids[key])).toHaveLength(1)
    }
  })

  it('restores earlier action records too when a later undo changed them after the target', () => {
    const scene = cityScene()
    const baseline = devote(scene.baseline, scene.cityId, 'earlier')
    const target = devote(baseline, scene.cityId, 'target', true)
    const current = unwrap(reverseAssistedAction(target, 'earlier'))
    expect(current.assistedActions[0]?.status).toBe('undone')
    const done = settle(open(current, baseline, scene.twainId), baseline)
    expect(done.assistedActions.map((r) => r.status)).toEqual(['applied', 'cancelled'])
    expect(player(done).stats).toEqual(player(baseline).stats)
    expect(done.log.slice(0, baseline.log.length)).toEqual(baseline.log)
  })

  it('preserves the original continuation and draws when a culture cancellation is countered', () => {
    const { baseline, current: played, ids } = cultureScene()
    const current = unwrap(draw(played, { playerId: C, sheetName: 'CULTURE_2', confirmedOutOfTurn: true }))
    const pending = unwrap(respond(open(current, baseline, ids['joust'] ?? ''), baseline, A, ids['tv'] ?? '', 'counter', 'open'))
    const done = settle(pending, baseline)
    expect(done.cancellations?.cases[0]?.outcome).toBe('prevented')
    expect(done.items).toEqual(current.items)
    expect(done.board).toEqual(current.board)
    expect(done.rng).toBe(current.rng)
    expect(player(done, C)).toEqual(player(current, C))
    expect(done.assistedActions).toEqual(current.assistedActions)
    expect(done.discardedItems.filter((i) => i.id === ids['event'])).toHaveLength(1)
  })

  it('does not treat Twain as a culture event or infer Bread and Circuses counters', () => {
    const { baseline, current, ids } = cultureScene()
    const pending = open(current, baseline, ids['twain'] ?? '')
    expect(respond(pending, baseline, A, ids['tv'] ?? '', 'counter', 'open').ok).toBe(false)
    const culturePending = open(current, baseline, ids['joust'] ?? '')
    expect(respond(culturePending, baseline, B, ids['bread'] ?? '', 'bread-counter', 'open').ok).toBe(false)
  })

  it.each([C, A])('lets Twain held by %s counter another player’s culture reaction and preserves the continuation', (twainOwner) => {
    const { baseline, current: played, ids } = cultureScene([], twainOwner)
    const current = unwrap(draw(played, { playerId: D, sheetName: 'CULTURE_2', confirmedOutOfTurn: true }))
    const opening = open(current, baseline, ids['joust'] ?? '')
    expect(toPlayerView(opening, twainOwner).cancellations?.responseCards.find((c) => c.itemId === ids['twain'])?.responses)
      .toContainEqual({ id: 'open', label: 'Jousting Tourney (open)' })
    const pending = unwrap(respond(opening, baseline, twainOwner, ids['twain'] ?? '', 'twain-counter', 'open'))
    for (const [owner, key] of [[A, 'tv'], [C, 'counter'], [B, 'bread']] as const) {
      expect(respond(pending, baseline, owner, ids[key] ?? '', `against-twain-${key}`, 'twain-counter').ok).toBe(false)
      expect(toPlayerView(pending, owner).cancellations?.responseCards.find((c) => c.itemId === ids[key])?.responses
        .some((r) => r.id === 'twain-counter')).toBe(false)
    }
    const done = settle(pending, baseline)
    expect(done.cancellations?.cases[0]?.outcome).toBe('prevented')
    expect(done.items).toEqual(current.items)
    expect(done.board).toEqual(current.board)
    expect(done.rng).toBe(current.rng)
    expect(done.assistedActions).toEqual(current.assistedActions)
    expect(done.log.slice(0, current.log.length)).toEqual(current.log)
    expect(done.players).toEqual(current.players.map((p) => ({
      ...p, items: p.items.filter((i) => i.id !== ids['joust'] && i.id !== ids['twain']),
    })))
    for (const key of ['event', 'joust', 'twain']) {
      expect(done.discardedItems.filter((i) => i.id === ids[key])).toHaveLength(1)
    }
  })

  it('rejects Twain against its owner’s reaction but permits another player’s Primetime TV reaction', () => {
    const { baseline, current, ids } = cultureScene()
    const opening = open(current, baseline, ids['joust'] ?? '')
    expect(respond(opening, baseline, B, ids['twain'] ?? '', 'own-counter', 'open').ok).toBe(false)
    expect(toPlayerView(opening, B).cancellations?.responseCards.find((c) => c.itemId === ids['twain'])?.responses
      .some((r) => r.id === 'open')).toBe(false)
    const pending = unwrap(respond(opening, baseline, A, ids['tv'] ?? '', 'tv-counter', 'open'))
    expect(respond(pending, baseline, B, ids['twain'] ?? '', 'twain-counter', 'tv-counter').ok).toBe(true)
  })

  it('allows Bread and Circuses only when the original event actually targets its owner', () => {
    const permitted = cultureScene([B])
    expect(open(permitted.current, permitted.baseline, permitted.ids['bread'] ?? '').cancellations?.cases).toHaveLength(1)
    const otherTarget = cultureScene([C])
    expect(command(otherTarget.current, otherTarget.baseline, B, 'bread',
      { kind: 'open', logId: logOf(otherTarget.current, 'target'), itemId: otherTarget.ids['bread'] ?? '' }).ok).toBe(false)
  })

  it('reveals King as protection, preserves the continuation, resets passes and keeps Twain in hand', () => {
    const scene = cityScene()
    const king = withCardInHand(scene.baseline, 'Dr. Martin Luther King', A)
    const baseline = king.state
    const current = unwrap(draw(devote(baseline, scene.cityId), { playerId: C, sheetName: 'CULTURE_1', confirmedOutOfTurn: true }))
    let pending = unwrap(pass(open(current, baseline, scene.twainId), baseline, B, 'old-pass'))
    pending = unwrap(respond(pending, baseline, A, king.itemId, 'king', null))
    expect(openCancellation(pending)?.passes).toEqual([])
    expect(player(pending).items.find((i) => i.id === king.itemId)?.hidden).toBe(false)
    const done = settle(pending, baseline)
    expect(done.cancellations?.cases[0]?.outcome).toBe('prevented')
    expect(player(done, B).items.some((i) => i.id === scene.twainId)).toBe(true)
    expect(done.discardedItems.some((i) => i.id === scene.twainId)).toBe(false)
    expect(done.items).toEqual(current.items)
    expect(done.rng).toEqual(current.rng)
    expect(player(done).stats).toEqual(player(current).stats)
    expect(player(done).items.find((i) => i.id === king.itemId)?.hidden).toBe(false)
  })

  it('rejects later-acquired, already-spent and historically unchosen reaction cards', () => {
    const { baseline, current, ids } = cultureScene()
    const noHistoricalCard = { ...baseline, players: baseline.players.map((p) => p.playerId === B ? { ...p, items: p.items.filter((i) => i.id !== ids['joust']) } : p) }
    const opening = { kind: 'open', logId: logOf(current, 'target'), itemId: ids['joust'] ?? '' } as const
    expect(command(current, noHistoricalCard, B, 'open', opening).ok).toBe(false)
    const candidate = { ...baseline, players: baseline.players.map((p) => p.playerId === B ? { ...p, pendingRewards: [
      { id: 'reward', kind: 'event' as const, level: 1 as const, step: 1, candidateIds: [ids['joust'] ?? ''], keep: 1 as const },
    ] } : p) }
    expect(command(current, candidate, B, 'open', opening).ok).toBe(false)
    const spent = { ...current, players: noHistoricalCard.players }
    expect(command(spent, baseline, B, 'open', opening).ok).toBe(false)
    const pending = open(current, baseline, ids['joust'] ?? '')
    expect(respond(pending, baseline, B, ids['joust'] ?? '', 'again', null).ok).toBe(false)
  })

  it('rejects a later-acquired King instead of invalidating the rollback that supplied it', () => {
    const { baseline, twainId, cityId } = cityScene()
    const king = withCardInHand(devote(baseline, cityId), 'Dr. Martin Luther King', A)
    const pending = open(king.state, baseline, twainId)
    expect(respond(pending, baseline, A, king.itemId, 'king', null).ok).toBe(false)
    const laterFaceup = { ...king.state, players: king.state.players.map((p) => ({
      ...p, items: p.items.map((i) => i.id === king.itemId ? { ...i, hidden: false } : i),
    })) }
    expect(open(laterFaceup, baseline, twainId).cancellations?.cases).toHaveLength(1)
  })

  it('checks historical blockade even when the reaction card is no longer blockaded now', () => {
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
    const response = command(unblocked, baseline, B, 'open', { kind: 'open', itemId: scene.twainId, logId: logOf(current, 'target') })
    expect(response.ok).toBe(false)
    expect(JSON.stringify(response)).toContain('available both before')
  })

  it('reloads a serialized pending case without embedding historical snapshots', () => {
    const { baseline, current, ids } = cultureScene()
    const pending = open(current, baseline, ids['joust'] ?? '')
    const reloaded = migrateGameState(JSON.parse(JSON.stringify(pending)) as GameState)
    expect(reloaded.cancellations).toEqual(pending.cancellations)
    const storedCase = reloaded.cancellations?.cases[0]
    expect(storedCase).toMatchObject({ beforeRevision: baseline.rev, continuationRevision: current.rev })
    expect(JSON.stringify(storedCase)).not.toContain('"players"')
    expect(settle(reloaded, baseline).cancellations?.cases[0]?.outcome).toBe('cancelled')
  })

  it('fails missing or incorrect history atomically, including the final pass', () => {
    const { baseline, cityId, twainId } = cityScene()
    const current = devote(baseline, cityId)
    const cmd = { kind: 'open', itemId: twainId, logId: logOf(current, 'target') } as const
    expect(command(current, undefined, B, 'open', cmd).ok).toBe(false)
    expect(command(current, { ...baseline, rev: baseline.rev + 1 }, B, 'open', cmd).ok).toBe(false)
    expect(command(current, current, B, 'open', cmd).ok).toBe(false)
    const pending = unwrap(pass(unwrap(pass(unwrap(pass(open(current, baseline, twainId), baseline, A)), baseline, B)), baseline, C))
    const original = JSON.stringify(pending)
    expect(pass(pending, undefined, D).ok).toBe(false)
    expect(JSON.stringify(pending)).toBe(original)
  })

  it('makes opening, responses and final passing idempotent while rejecting changed request meanings and stale passes', () => {
    const { baseline, current, ids } = cultureScene()
    const cmd = { kind: 'open', itemId: ids['joust'] ?? '', logId: logOf(current, 'target') } as const
    const pending = unwrap(command(current, baseline, B, 'open', cmd))
    expect(unwrap(command(pending, undefined, B, 'open', cmd))).toBe(pending)
    const reply = { kind: 'respond', caseId: 'open', version: 1, itemId: ids['tv'] ?? '', targetId: 'open' } as const
    const countered = unwrap(command(pending, baseline, A, 'counter', reply))
    expect(unwrap(command(countered, undefined, A, 'counter', reply))).toBe(countered)
    expect(command(countered, baseline, C, 'stale', { kind: 'pass', caseId: 'open', version: 1 }).ok).toBe(false)
    expect(command(countered, baseline, A, 'counter', { ...reply, targetId: null }).ok).toBe(false)
    const done = settle(countered, baseline)
    expect(unwrap(command(done, undefined, D, `pass-${D}`, { kind: 'pass', caseId: 'open', version: 2 }))).toBe(done)
    expect(unwrap(command(done, undefined, B, 'open', cmd))).toBe(done)
  })

  it('uses the minimum explicit acknowledgement, never phase completion or an implicit future cutoff', () => {
    const { baseline, cityId, twainId } = cityScene()
    let current = devote(baseline, cityId)
    const cutoff = current.log.length
    current = unwrap(command(current, undefined, A, 'ack-a', { kind: 'confirm', through: cutoff }))
    current = devote(current, cityId, 'later', true)
    current = unwrap(command(current, undefined, B, 'ack-b', { kind: 'confirm', through: current.log.length }))
    current = unwrap(command(current, undefined, C, 'ack-c', { kind: 'confirm', through: current.log.length }))
    current = unwrap(command(current, undefined, D, 'ack-d', { kind: 'confirm', through: current.log.length }))
    expect(current.cancellations?.sealedThrough).toBe(cutoff)
    expect(command(current, baseline, B, 'open', { kind: 'open', logId: logOf(current, 'target'), itemId: twainId }).ok).toBe(false)
    expect(toPlayerView(current, B).cancellations?.responseCards.find((c) => c.itemId === twainId)?.targets.map((t) => t.logId)).toContain(logOf(current, 'later'))
  })

  it('seals resolved disputes against a later rewind and forbids confirmation during a dispute', () => {
    const { baseline, current, ids } = cultureScene()
    const pending = open(current, baseline, ids['joust'] ?? '')
    expect(command(pending, undefined, A, 'ack', { kind: 'confirm', through: pending.log.length }).ok).toBe(false)
    const countered = unwrap(respond(pending, baseline, A, ids['tv'] ?? '', 'counter', 'open'))
    const done = settle(countered, baseline)
    expect(done.cancellations?.sealedThrough).toBe(done.log.length)
    expect(command(done, baseline, B, 'again', { kind: 'open', logId: logOf(done, 'target'), itemId: ids['twain'] ?? '' }).ok).toBe(false)
  })

  it('persists the adoption floor over later turns and does not seal unconfirmed earlier turns', () => {
    const { baseline, cityId, twainId } = cityScene()
    const { cancellations: _old, ...legacy } = baseline
    const adopted = migrateGameState(legacy)
    let current = devote(adopted, cityId)
    for (const p of current.players) current = unwrap(markPhasesDone(current, { playerId: p.playerId, turnNumber: 1, upToPhase: 'RESEARCH' }))
    expect(cancellationHistory(migrateGameState(current)).floorTurn).toBe(1)
    expect(open(current, adopted, twainId).cancellations?.cases).toHaveLength(1)
    expect(migrateGameState(adopted)).toEqual(adopted)
  })

  it('projects only public case labels and the viewer’s own choices, never snapshots or private inputs', () => {
    const { baseline, current, ids } = cultureScene()
    const withSecrets = { ...current, logSecret: 'secret-log-key', players: current.players.map((p) => ({ ...p, gamenote: 'secret-note' })),
      assistedActions: current.assistedActions.map((r) => ({ ...r, selectedInputs: { secret: 'secret-choice' } })) }
    const pending = open(withSecrets, baseline, ids['joust'] ?? '')
    for (const viewer of [A, C, 'spectator']) {
      const projected = toPlayerView(pending, viewer)
      const cases = JSON.stringify(projected.cancellations)
      for (const secret of ['secret-choice', 'secret-log-key', 'secret-note', 'beforeRevision', 'continuationRevision', 'fingerprint', 'candidateIds', ids['joust'] ?? '', ids['twain'] ?? '']) expect(cases).not.toContain(secret)
      expect(JSON.stringify(projected)).not.toContain('secret-choice')
      expect(projected.cancellations?.cases[0]?.participants).toEqual(pending.players.map((p) => p.playerId))
    }
    expect(toPlayerView(pending, 'spectator').cancellations?.responseCards).toEqual([])
    expect(toPlayerView(pending, B).cancellations?.responseCards.some((c) => c.itemId === ids['twain'])).toBe(true)
  })

  it('retains intentional Garcia and Lovelace exclusions and faceup King protection', () => {
    const { baseline, cityId, twainId } = cityScene()
    const current = devote(baseline, cityId)
    const lovelace = { ...current, assistedActions: current.assistedActions.map((r) => ({ ...r, lovelaceCreditId: 'extra-action' })) }
    expect(command(lovelace, baseline, B, 'open', { kind: 'open', logId: logOf(current, 'target'), itemId: twainId }).ok).toBe(false)
    const king = withCardInHand(baseline, 'Dr. Martin Luther King', A)
    const faceup = { ...king.state, players: king.state.players.map((p) => ({ ...p, items: p.items.map((i) => i.id === king.itemId ? { ...i, hidden: false } : i) })) }
    const protectedAction = devote(faceup, cityId)
    expect(command(protectedAction, faceup, B, 'open', { kind: 'open', logId: logOf(protectedAction, 'target'), itemId: twainId }).ok).toBe(false)
    const garcia = withCardInHand(baseline, 'Jerry Garcia', A)
    const garciaAction = act(garcia.state, A, garcia.itemId, 'target')
    expect(command(garciaAction, garcia.state, B, 'open', { kind: 'open', logId: logOf(garciaAction, 'target'), itemId: twainId }).ok).toBe(false)
  })
})
