/**
 * Edge cases of the cancellations found in review of #336: a counter that crosses turns, King's protection when he
 * leaves after the action, Ada Lovelace's immunity (and not Supply Drop's), the owners Bread and Circuses reads, and
 * a retained resource cost the board Undo must not refund.
 * Specification: `docs/agents/decisions.md` ("Cancellation", "Resource abilities").
 */

import { describe, expect, it } from 'vitest'

import { placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone, postOrder } from '../src/actions/turn.js'
import { performAssistedAction, reverseAssistedAction } from '../src/assisted.js'
import { findBoardAsset, mapTop, slotOrigin, SQUARE_SIZE } from '../src/board.js'
import { applyCancellation } from '../src/cancellation.js'
import type { CancellationCommand } from '../src/cancellation.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'
import { turnStatus } from '../src/turn.js'

import { player, withCardInHand, withPieceInArea } from './assisted-fixture.js'
import { CASH1981 as A, CHUL as D, KARANDRAS1 as B, ITCHI as C, firstCivGame } from './fixture.js'

const command = (state: GameState, baseline: GameState | undefined, playerId: string, requestId: string, cmd: CancellationCommand) =>
  applyCancellation(state, { playerId, requestId, command: cmd }, baseline)
const logOf = (state: GameState, id: string): string => {
  const logId = state.assistedActions.find((r) => r.id === id)?.logId
  if (logId === undefined) throw new Error('missing action')
  return logId
}

function put(state: GameState, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(placePiece(state, {
    playerId: A,
    assetId,
    x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
    y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
  }))
}

/** A has a red capital on B2 and a red city on E2, City Management open; B is Blue, C Green, D Yellow. */
function scene(): { readonly state: GameState; readonly capital: string; readonly city: string } {
  const colours: Record<string, string> = { [A]: 'Red', [B]: 'Blue', [C]: 'Green', [D]: 'Yellow' }
  const base = firstCivGame()
  let state: GameState = { ...base, players: base.players.map((p) => ({ ...p, color: colours[p.playerId] ?? p.color })) }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: A, assetId: 'tiles/america', x, y }))
  state = put(state, 'cities/redcapital2', 1, 1)
  const capital = state.board.pieces.at(-1)?.id ?? ''
  state = put(state, 'cities/redcity2', 4, 1)
  const city = state.board.pieces.at(-1)?.id ?? ''
  return { state: unwrap(markPhasesDone(state, { playerId: A, turnNumber: 1, upToPhase: 'TRADE' })), capital, city }
}
const devote = (state: GameState, cityPieceId: string, requestId: string, repeat = false) =>
  unwrap(performAssistedAction(state, { playerId: A, action: 'devoteToTheArts', requestId, confirmedRepeat: repeat, payload: { cityPieceId } }))
const program = (state: GameState, cityPieceId: string, requestId: string) =>
  performAssistedAction(state, { playerId: A, action: 'startBuildingProgram', requestId, payload: { cityPieceId } })
const play = (state: GameState, itemId: string, requestId: string) =>
  unwrap(performAssistedAction(state, { playerId: A, action: 'playCard', requestId, payload: { itemId, targets: [] } }))
const faceup = (state: GameState, owner: string, itemId: string): GameState => ({
  ...state,
  players: state.players.map((p) => p.playerId === owner ? { ...p, items: p.items.map((i) => i.id === itemId ? { ...i, hidden: false } : i) } : p),
})

describe('a counter across turns', () => {
  it('keeps what was written about earlier turns and reopens nothing, as the game it returns to is the later turn', () => {
    let state = firstCivGame()
    const ids: Record<string, string> = {}
    for (const [key, name, owner] of [['event', 'Supply Drop', A], ['joust', 'Jousting Tourney', B], ['tv', 'Primetime TV', A]] as const) {
      const given = withCardInHand(state, name, owner)
      state = given.state
      ids[key] = given.itemId
    }
    // Cancellation has been in force since turn 1
    const start: GameState = { ...state, cancellations: { floorTurn: 1, sealedThrough: 0, events: [], requests: [] } }
    const played = unwrap(performAssistedAction(start, { playerId: A, action: 'playCard', requestId: 'target', payload: { itemId: ids['event'] ?? '', targets: [] } }))
    // Turn 1 is complete for everybody, so the game stands in turn 2, with turn 1's research order posted
    let later = unwrap(postOrder(played, { playerId: C, turnNumber: 1, phase: 'RESEARCH', markdown: 'Turn one research', at: '2026-11-05T09:00:00Z' }))
    for (const p of later.players) later = unwrap(markPhasesDone(later, { playerId: p.playerId, turnNumber: 1, upToPhase: 'RESEARCH' }))
    expect(turnStatus(later).currentTurn).toBe(2)

    // B cancels the turn 1 culture event: the game is back in turn 1
    const cancelled = unwrap(command(later, start, B, 'cancel', { logId: logOf(later, 'target'), itemId: ids['joust'] ?? '' }))
    expect(turnStatus(cancelled).currentTurn).toBe(1)
    // While it is, C corrects turn 1's research order
    const edited = unwrap(postOrder(cancelled, { playerId: C, turnNumber: 1, phase: 'RESEARCH', markdown: 'Corrected research', at: '2026-11-05T10:00:00Z' }))
    // A counters with Primetime TV: the game returns to turn 2 as it was
    const back = unwrap(command(edited, later, A, 'counter', { logId: 'cancellation:cancel', itemId: ids['tv'] ?? '' }))
    expect(turnStatus(back).currentTurn).toBe(2)
    const older = (state: GameState) => player(state, C).playerTurns.find((t) => t.turnNumber === 1)
    expect(older(back)?.orders.RESEARCH).toBe('Corrected research')
    // Turn 1 stays complete: nothing of a turn behind the game is reopened
    expect(older(back)?.done).toEqual(older(later)?.done)
    expect(older(back)?.needsRevision).toBe(older(later)?.needsRevision)
    expect(older(back)?.revisionPhases).toEqual(older(later)?.revisionPhases)
  })
})

describe('Dr. Martin Luther King protects an action taken while he was faceup', () => {
  it('even when he has left the hand since', () => {
    const { state, capital } = scene()
    const king = withCardInHand(state, 'Dr. Martin Luther King', A)
    const twain = withCardInHand(faceup(king.state, A, king.itemId), 'Mark Twain', B)
    const current = devote(twain.state, capital, 'target')
    const kingLeft: GameState = {
      ...current,
      players: current.players.map((p) => p.playerId === A ? { ...p, items: p.items.filter((i) => i.id !== king.itemId) } : p),
      discardedItems: [...current.discardedItems, ...king.state.players.find((p) => p.playerId === A)?.items.filter((i) => i.id === king.itemId) ?? []],
    }
    expect(player(kingLeft, A).items.some((i) => i.id === king.itemId)).toBe(false)
    const result = command(kingLeft, twain.state, B, 'cancel', { logId: logOf(current, 'target'), itemId: twain.itemId })
    expect(JSON.stringify(unwrapErr(result))).toContain('Dr. Martin Luther King is faceup')
    // The view offers no Cancel for it either
    const targets = toPlayerView(kingLeft, B).cancellations?.responseCards.find((c) => c.itemId === twain.itemId)?.targets
    expect(targets?.find((t) => t.logId === logOf(current, 'target'))?.blocked).toContain('Dr. Martin Luther King is faceup')
  })

  it('but a King who was hidden when the city acted protects nothing that he did not see', () => {
    const { state, capital } = scene()
    const king = withCardInHand(state, 'Dr. Martin Luther King', A)
    const twain = withCardInHand(king.state, 'Mark Twain', B)
    const current = devote(twain.state, capital, 'target')
    expect(current.assistedActions[0]?.kingFaceupAtAction).toBe(false)
    expect(command(current, twain.state, B, 'cancel', { logId: logOf(current, 'target'), itemId: twain.itemId }).ok).toBe(true)
  })
})

describe('Ada Lovelace and Supply Drop extra actions', () => {
  it("only Ada Lovelace's is immune: a Supply Drop action is cancelled, and it still used the Supply Drop", () => {
    const { state, city } = scene()
    const drop = withCardInHand(state, 'Supply Drop', A)
    const twain = withCardInHand(drop.state, 'Mark Twain', B)
    const first = devote(twain.state, city, 's1')
    const played = play(first, drop.itemId, 's2')
    const extra = unwrap(program(played, city, 's3'))
    expect(extra.assistedActions.find((r) => r.id === 's3')?.lovelaceCreditId).toBe('s2')
    const done = unwrap(command(extra, played, B, 'cancel', { logId: logOf(extra, 's3'), itemId: twain.itemId }))
    expect(done.assistedActions.find((r) => r.id === 's3')?.status).toBe('cancelled')
    // The cancelled action took the extra action: the city has no other, and the card play cannot be undone
    expect(program(done, city, 's4').ok).toBe(false)
    expect(reverseAssistedAction(done, 's2').ok).toBe(false)
  })

  it("Ada Lovelace's extra action cannot be cancelled", () => {
    const { state, capital } = scene()
    const ada = withCardInHand(state, 'Ada Lovelace', A)
    const twain = withCardInHand(ada.state, 'Mark Twain', B)
    const first = devote(twain.state, capital, 's1')
    const played = play(first, ada.itemId, 's2')
    const extra = unwrap(program(played, capital, 's3'))
    expect(extra.assistedActions.find((r) => r.id === 's3')?.lovelaceCreditId).toBe('s2')
    const result = command(extra, played, B, 'cancel', { logId: logOf(extra, 's3'), itemId: twain.itemId })
    expect(JSON.stringify(unwrapErr(result))).toContain('Ada Lovelace')
  })
})

describe('Bread and Circuses reads the owners as the card moved them', () => {
  it('still has its target when the moved figure has left the board since', () => {
    let state = firstCivGame()
    state = { ...state, players: state.players.map((p) => ({ ...p, color: p.playerId === A ? 'Red' : p.playerId === B ? 'Blue' : p.color })) }
    const bread = withCardInHand(state, 'Bread and Circuses', B)
    const event = withCardInHand(bread.state, 'Supply Drop', A)
    const played = play(event.state, event.itemId, 'target')
    const withMove = (owners: readonly string[] | undefined): GameState => ({
      ...played,
      assistedActions: played.assistedActions.map((r) => r.effect.kind !== 'playCard' ? r : { ...r, effect: { ...r.effect,
        cardMove: { card: 'Lost', kind: 'group', ...(owners === undefined ? {} : { owners }),
          from: { column: 0, row: 0 }, to: { column: 1, row: 0 },
          moves: [{ pieceId: 'removed-piece', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, movement: null, historyId: 'h' }] } } }),
    })
    const targetsOf = (game: GameState) => toPlayerView(game, B).cancellations?.responseCards.find((c) => c.itemId === bread.itemId)?.targets ?? []
    // Blue's figure moved and is gone from the board: the owners say whose it was
    expect(targetsOf(withMove(['blue'])).some((t) => t.blocked === null)).toBe(true)
    expect(targetsOf(withMove(['green'])).some((t) => t.blocked === null)).toBe(false)
    // A record without them can only look at the board, where the piece is not
    expect(targetsOf(withMove(undefined)).some((t) => t.blocked === null)).toBe(false)
    const done = command(withMove(['blue']), event.state, B, 'cancel', { logId: logOf(played, 'target'), itemId: bread.itemId })
    expect(done.ok).toBe(true)
  })
})

describe('a retained resource cost is not refunded by the board Undo', () => {
  it('a Silk piece the cancelled ability paid stays off the map', () => {
    const tech = unwrap(revealTech(unwrap(chooseTech(firstCivGame(), { playerId: A, techName: 'Horseback Riding' })), { playerId: A, techName: 'Horseback Riding' }))
    const silk = withPieceInArea(tech, 'resources/silk', A)
    const twain = withCardInHand(unwrap(markPhasesDone(silk.state, { playerId: A, turnNumber: 1, upToPhase: 'SOT' })), 'Mark Twain', B)
    const current = unwrap(performAssistedAction(twain.state, { playerId: A, action: 'horsebackRiding', requestId: 'target', payload: { targetId: B } }))
    const done = unwrap(command(current, twain.state, B, 'cancel', { logId: logOf(current, 'target'), itemId: twain.itemId }))
    expect(done.board.pieces.some((p) => p.id === silk.piece.id)).toBe(false)
    const record = done.assistedActions.find((r) => r.id === 'target')
    expect(record?.keptHistoryIds).toHaveLength(1)
    // The player's own Undo of the last board change would put the Silk back: refused
    expect(unwrapErr(undoLastBoardChange(done, A))).toMatchObject({ kind: 'BOARD_UNDO_ASSISTED' })
    expect(done.board.pieces.some((p) => p.id === silk.piece.id)).toBe(false)
  })
})
