/**
 * Engineering (issue #354): once per turn a city splits its production to buy two items in one city action. The
 * `build` payload carries an optional `second` item. Rulings 80, 164-168 and the human's decisions of 2026-11-15.
 *
 * The scene is that of `assisted-build.test.ts`: Cash is Red on Monarchy, the America tile lies in the first map
 * slot and a red city stands on B2. Its outskirts are A1 mountain, B1 mountain, C1 water, A2 forest, C2 grassland, A3
 * desert, B3 desert and C3 mountain; the estimate is 5 production.
 */

import { describe, expect, it } from 'vitest'

import { placePiece, setCityProductionOverride } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { performAssistedAction, reverseAssistedAction, takeBackOpenBuild } from '../src/assisted.js'
import { applyCancellation } from '../src/cancellation.js'
import { SQUARE_SIZE, findBoardAsset, isInWondersArea, mapTop, slotOrigin, wonderAssetId, wondersArea } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import type { BuildItem } from '../src/build-item.js'
import type { BuildPayload, BuildSecond, BuildTarget } from '../src/build-options.js'
import { buildOptionsOf } from '../src/build-options.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-09T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

const WORKSHOP: BuildItem = { kind: 'building', assetId: 'buildings/workshop' }
const TRADING_POST: BuildItem = { kind: 'building', assetId: 'buildings/tradingpost' }
const MARKET: BuildItem = { kind: 'building', assetId: 'buildings/market' }
const LIBRARY: BuildItem = { kind: 'building', assetId: 'buildings/library' }
const ARMY: BuildItem = { kind: 'army' }
const WALLS: BuildItem = { kind: 'walls' }
const INFANTRY: BuildItem = { kind: 'unit', unitType: 'infantry' }

const A1: BuildTarget = { column: 0, row: 0 }
const B1: BuildTarget = { column: 1, row: 0 }
const C2: BuildTarget = { column: 2, row: 1 }
const A3: BuildTarget = { column: 0, row: 2 }
const B3: BuildTarget = { column: 1, row: 2 }

const KEY = 'card:Engineering'

function game(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const state = firstCivGame()
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      color: colors[p.playerId] ?? p.color,
      government: p.playerId === CASH1981 ? 'Monarchy' : p.government,
    })),
  }
}

function put(state: GameState, playerId: string, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
      rotation: 0,
    }),
  )
}

function withAmerica(state: GameState): GameState {
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  return unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
}

function learn(state: GameState, ...techs: readonly string[]): GameState {
  return techs.reduce(
    (next, techName) =>
      unwrap(revealTech(unwrap(chooseTech(next, { playerId: CASH1981, techName })), { playerId: CASH1981, techName })),
    state,
  )
}

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

const withTrade = (state: GameState, trade: number): GameState => ({
  ...state,
  players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, trade } } : p)),
})

const cityOf = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city on the board')
  return city
}

/** The scene with City Management open, Engineering and the given techs revealed and the trade in hand. */
function ready(trade = 0, techs: readonly string[] = ['Engineering', 'Construction', 'Code of Laws', 'Currency', 'Writing']): GameState {
  const base = put(withAmerica(game()), CASH1981, 'cities/redcity2', 1, 1)
  return withTrade(unwrap(markPhasesDone(learn(base, ...techs), { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' })), trade)
}

const withOverride = (state: GameState, value: number): GameState =>
  unwrap(setCityProductionOverride(state, { playerId: CASH1981, pieceId: cityOf(state).id, value }))

const usedKeys = (state: GameState): readonly string[] =>
  me(state).playerTurns.find((turn) => turn.turnNumber === 1)?.usedActions ?? []

function payload(
  state: GameState,
  first: BuildItem,
  firstAt: BuildTarget | undefined,
  second?: BuildItem,
  secondAt?: BuildTarget,
  rush?: boolean,
): BuildPayload {
  const base = { cityPieceId: cityOf(state).id, ...(rush === undefined ? {} : { rush }) }
  const secondPart: { readonly second?: BuildSecond } =
    second === undefined
      ? {}
      : { second: (secondAt === undefined ? { item: second } : { item: second, target: secondAt }) as BuildSecond }
  if (first.kind === 'unit' || first.kind === 'walls') return { ...base, item: first, ...secondPart }
  if (firstAt === undefined) throw new Error('needs a square')
  return { ...base, item: first, target: firstAt, ...secondPart }
}

const tryBuild = (
  state: GameState,
  first: BuildItem,
  firstAt: BuildTarget | undefined,
  second?: BuildItem,
  secondAt?: BuildTarget,
  rush?: boolean,
  requestId = 'req-1',
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'build',
    requestId,
    at: AT,
    payload: payload(state, first, firstAt, second, secondAt, rush),
  })

const both = (
  state: GameState,
  first: BuildItem,
  firstAt: BuildTarget | undefined,
  second: BuildItem,
  secondAt?: BuildTarget,
  rush?: boolean,
  requestId = 'req-1',
): GameState => unwrap(tryBuild(state, first, firstAt, second, secondAt, rush, requestId))

const refusal = (result: ReturnType<typeof tryBuild>): string => describeError(unwrapErr(result))

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

function undoByVote(state: GameState, requestId: string): GameState {
  const logId = state.log.find((entry) => entry.assistedActionId === requestId)?.id
  if (logId === undefined) throw new Error('no log line')
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
  return next
}

/** What an undo must restore: the board pieces, the player's stats, hand and turn record. */
const snapshot = (state: GameState) =>
  JSON.stringify({
    // A wonder put back in the market is the same piece with an explicit null owner, and may sit elsewhere in the list
    pieces: [...state.board.pieces]
      .map(({ ownerId, ...piece }) => (ownerId === null || ownerId === undefined ? piece : { ...piece, ownerId }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    stats: me(state).stats,
    items: me(state).items,
    used: usedKeys(state),
    discard: state.discardedItems.length,
    deck: state.items.length,
    discount: me(state).wonderDiscount,
    wounds: me(state).hensonWounds,
  })

describe('two buildings from the sum of the production', () => {
  it('builds both with the production of the city and records one action', () => {
    const state = withOverride(ready(), 14)
    const done = both(state, WORKSHOP, A1, TRADING_POST, A3)

    expect(piecesOf(done, 'buildings/workshop')).toHaveLength(1)
    expect(piecesOf(done, 'buildings/tradingpost')).toHaveLength(1)
    expect(me(done).stats.trade).toBe(0)
    expect(usedKeys(done)).toContain(KEY)
    expect(done.assistedActions).toHaveLength(1)
    expect(done.assistedActions[0]).toMatchObject({ kind: 'build', status: 'applied', usageKey: null })
    expect(done.log.filter((entry) => entry.assistedActionId === 'req-1')).toHaveLength(1)
    expect(done.log.at(-1)?.publicLog).toBe(
      'cash1981 built a Workshop on square A1 and a Trading Post on square A3 in City B2, splitting the production with Engineering',
    )
  })

  it('a shortfall is paid with trade, counted once on the combined cost, and asks for the rush first', () => {
    // 7 + 7 = 14 against a hand-set 11: 3 missing, 9 trade
    const state = withOverride(ready(9), 11)
    expect(refusal(tryBuild(state, WORKSHOP, A1, TRADING_POST, A3))).toMatch(/cost 14 together.*Confirm paying 9 trade/)
    const done = both(state, WORKSHOP, A1, TRADING_POST, A3, true)
    expect(me(done).stats.trade).toBe(0)
    expect(done.log.at(-1)?.publicLog).toContain('paying 9 (0) trade for the missing production')
  })

  it('the extra hammers the first item gives do not count for the second', () => {
    // The estimate is 5 and the Workshop adds 2 once it stands; 14 - 5 = 9 missing, so 27 trade, not 21
    const state = ready(27)
    const done = both(state, WORKSHOP, A1, TRADING_POST, A3, true)
    expect(me(done).stats.trade).toBe(0)
    expect(tryBuild(withTrade(state, 26), WORKSHOP, A1, TRADING_POST, A3, true).ok).toBe(false)
  })

  it('is refused when the production and the trade together fall short, and nothing changes', () => {
    const state = ready(26)
    const result = tryBuild(state, WORKSHOP, A1, TRADING_POST, A3, true)
    expect(refusal(result)).toMatch(/Covering the missing 9 takes 27 trade and you have 26/)
  })

  it('the building program marker and the caravan are counted once and used up with the first item', () => {
    const marked = put(put(ready(), CASH1981, 'markers/Building Program', 1, 1), CASH1981, 'markers/caravan', 1, 1)
    // The doubled outskirts 10 plus the caravan 2 = 12 against 14: 2 missing, 6 trade
    const state = withTrade(marked, 6)
    const done = both(state, WORKSHOP, A1, TRADING_POST, A3, true)
    expect(piecesOf(done, 'markers/Building Program')).toEqual([])
    expect(piecesOf(done, 'markers/caravan')).toEqual([])
    expect(me(done).stats.trade).toBe(0)
    const undone = undoByVote(done, 'req-1')
    expect(piecesOf(undone, 'markers/Building Program')).toHaveLength(1)
    expect(piecesOf(undone, 'markers/caravan')).toHaveLength(1)
    expect(snapshot(undone)).toBe(snapshot(state))
  })
})

describe('what Engineering allows', () => {
  it('any two items each with its own check: building and army, scout, unit and walls', () => {
    const rich = withOverride(ready(0, ['Engineering', 'Construction', 'Masonry']), 30)
    expect(tryBuild(rich, WORKSHOP, A1, ARMY, B1).ok).toBe(true)
    expect(tryBuild(rich, INFANTRY, undefined, WALLS).ok).toBe(true)
    expect(tryBuild(rich, WALLS, undefined, WORKSHOP, A1).ok).toBe(true)
    expect(tryBuild(rich, ARMY, B1, { kind: 'scout' }, A1).ok).toBe(true)
    expect(tryBuild(rich, INFANTRY, undefined, INFANTRY).ok).toBe(true)
    // Not the same item where it is not legal twice: a Library goes on the one grassland square, City Walls once
    expect(refusal(tryBuild(rich, WALLS, undefined, WALLS))).toMatch(/already has City Walls|cannot be built/)
    expect(tryBuild(rich, LIBRARY, C2, LIBRARY, C2).ok).toBe(false)
  })

  it('the second item is checked as the first leaves the board: a taken square is refused', () => {
    const rich = withOverride(ready(), 30)
    const result = tryBuild(rich, WORKSHOP, A1, MARKET, A1)
    expect(refusal(result)).toMatch(/second item/)
    expect(tryBuild(rich, WORKSHOP, A1, MARKET, B3).ok).toBe(true)
  })

  it('a figure on a square does not stop the second item replacing a building on it', () => {
    const rich = put(withOverride(ready(0, ['Engineering', 'Construction', 'Code of Laws', 'Currency', 'Writing', 'Masonry']), 30), CASH1981, 'buildings/library', 2, 1)
    // The Market replaces the Library on C2 while the army stands there too, in either order of the two items
    expect(tryBuild(rich, ARMY, C2, MARKET, C2).ok).toBe(true)
    expect(tryBuild(rich, MARKET, C2, ARMY, C2).ok).toBe(true)
    // Two buildings still cannot replace one another on the same square
    expect(refusal(tryBuild(rich, MARKET, C2, LIBRARY, C2))).toMatch(/second item/)
  })

  it('a unit is a hidden card: the public line names the type only', () => {
    const rich = withOverride(ready(), 30)
    const done = both(rich, INFANTRY, undefined, WORKSHOP, A1)
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(
      'cash1981 built an infantry unit and a Workshop on square A1 in City B2, splitting the production with Engineering',
    )
    for (const viewerId of [KARANDRAS1, ITCHI, CHUL, 'spectator']) {
      const view = JSON.stringify(toPlayerView(done, viewerId))
      const card = me(done).items.find((item) => item.sheetName === 'INFANTRY')
      expect(card).toBeDefined()
      expect(view).not.toContain(card?.id ?? 'x')
    }
  })
})

describe('when Engineering cannot be used', () => {
  it('needs the tech chosen and revealed', () => {
    const none = withOverride(ready(0, ['Construction', 'Code of Laws']), 30)
    expect(refusal(tryBuild(none, WORKSHOP, A1, TRADING_POST, A3))).toMatch(/do not have Engineering/)
    const hidden = withOverride(
      unwrap(markPhasesDone(
        unwrap(chooseTech(put(withAmerica(game()), CASH1981, 'cities/redcity2', 1, 1), { playerId: CASH1981, techName: 'Engineering' })),
        { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' },
      )),
      30,
    )
    const learned = learn(hidden, 'Construction', 'Code of Laws')
    const hiddenAgain = {
      ...learned,
      players: learned.players.map((p) => p.playerId === CASH1981
        ? { ...p, techsChosen: [...p.techsChosen.filter((t) => t.name !== 'Engineering'), { name: 'Engineering', hidden: true } as never] }
        : p),
    }
    expect(refusal(tryBuild(hiddenAgain, WORKSHOP, A1, TRADING_POST, A3))).toMatch(/Reveal Engineering/)
  })

  it('cannot be used twice in a turn, even with another city action confirmed (ruling 166)', () => {
    const rich = withOverride(ready(), 40)
    const once = both(rich, WORKSHOP, A1, TRADING_POST, A3)
    const again = performAssistedAction(once, {
      playerId: CASH1981,
      action: 'build',
      requestId: 'req-2',
      at: AT,
      payload: payload(once, MARKET, B3, ARMY, B1),
      confirmedRepeat: true,
    })
    expect(refusal(again)).toMatch(/Engineering has already been used this turn/)
    // The ordinary build of the second city action is still allowed once confirmed
    const single = performAssistedAction(once, {
      playerId: CASH1981,
      action: 'build',
      requestId: 'req-3',
      at: AT,
      payload: payload(once, MARKET, B3),
      confirmedRepeat: true,
    })
    expect(single.ok).toBe(true)
  })

  it('a use written by another record this turn counts too', () => {
    const rich = withOverride(ready(), 40)
    const marked = unwrap(
      markPhasesDone(rich, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }),
    )
    const turn = me(marked).playerTurns.find((t) => t.turnNumber === 1)
    const used: GameState = {
      ...marked,
      players: marked.players.map((p) =>
        p.playerId === CASH1981 && turn !== undefined
          ? { ...p, playerTurns: p.playerTurns.map((t) => (t.turnNumber === 1 ? { ...t, usedActions: [...t.usedActions, KEY] } : t)) }
          : p,
      ),
    }
    expect(refusal(tryBuild(used, WORKSHOP, A1, TRADING_POST, A3))).toMatch(/already been used/)
  })

  it('the Engineering options need no second item: an ordinary build is unaffected and leaves the key free', () => {
    const rich = withOverride(ready(), 40)
    const single = unwrap(tryBuild(rich, WORKSHOP, A1))
    expect(usedKeys(single)).not.toContain(KEY)
    expect(single.assistedActions[0]?.effect).not.toHaveProperty('engineering')
    expect(buildOptionsOf(single, me(single))[0]?.choices.length).toBeGreaterThan(0)
  })
})

describe('blockade and battle', () => {
  const blockaded = (state: GameState): GameState => put(state, KARANDRAS1, 'figures/bluearmy', C2.column, C2.row)

  it('two armies may stand on a square with an enemy figure (ruling 167)', () => {
    const state = withOverride(blockaded(ready()), 30)
    const done = both(state, ARMY, C2, ARMY, C2)
    expect(piecesOf(done, 'figures/redarmy')).toHaveLength(2)
    expect(done.log.at(-1)?.publicLog).toContain('an enemy figure is there')
    expect(snapshot(undoByVote(done, 'req-1'))).toBe(snapshot(state))
  })

  it('a building is refused with an army when its only square is blockaded, even on the army square (ruling 168)', () => {
    const state = withOverride(blockaded(ready()), 30)
    // The Library goes on C2 only, and the enemy figure stands there
    expect(refusal(tryBuild(state, LIBRARY, C2, ARMY, C2))).toMatch(/blockaded/)
    expect(refusal(tryBuild(state, ARMY, C2, LIBRARY, C2))).toMatch(/blockaded/)
  })
})

describe('undo', () => {
  it('takes back both items, restores trade, markers and the key, and logs one line', () => {
    const state = withOverride(ready(9), 11)
    const done = both(state, WORKSHOP, A1, TRADING_POST, A3, true)
    const undone = undoByVote(done, 'req-1')
    expect(snapshot(undone)).toBe(snapshot(state))
    expect(usedKeys(undone)).not.toContain(KEY)
    expect(undone.log.at(-1)?.publicLog).toMatch(/Trading Post.*was undone.*Workshop.*was undone.*Engineering can be used again/)
    // Engineering can be used again
    expect(tryBuild(undone, WORKSHOP, A1, TRADING_POST, A3, true).ok).toBe(true)
  })

  it('restores a unit card and the deck, and City Walls', () => {
    const rich = withOverride(ready(0, ['Engineering', 'Construction', 'Masonry']), 30)
    const done = both(rich, INFANTRY, undefined, WALLS)
    expect(piecesOf(done, 'cities/redcity2')).toHaveLength(0)
    const undone = undoByVote(done, 'req-1')
    expect(piecesOf(undone, 'cities/redcity2')).toHaveLength(1)
    expect(me(undone).items.filter((item) => item.sheetName === 'INFANTRY').length).toBe(
      me(rich).items.filter((item) => item.sheetName === 'INFANTRY').length,
    )
    expect(usedKeys(undone)).not.toContain(KEY)
  })

  it('refuses the whole undo when one piece cannot be taken back, and nothing changes', () => {
    const rich = withOverride(ready(), 30)
    const done = both(rich, WORKSHOP, A1, TRADING_POST, A3)
    const post = piecesOf(done, 'buildings/tradingpost')[0] as BoardPiece
    const moved = {
      ...done,
      board: { ...done.board, pieces: done.board.pieces.filter((piece) => piece.id !== post.id) },
    }
    const logId = done.log.find((entry) => entry.assistedActionId === 'req-1')?.id ?? ''
    let next = unwrap(initiateUndo(moved, { logId, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId, playerId, vote: true, at: AT }))
    const last = vote(next, { logId, playerId: CHUL, vote: true, at: AT })
    expect(last.ok).toBe(false)
  })
})

describe('cancellation (ruling 165)', () => {
  it('Mark Twain takes back both items and gives Engineering back', () => {
    const twain = withCardInHand({ ...withOverride(ready(), 30), rev: 41 }, 'Mark Twain', KARANDRAS1)
    const before = twain.state
    const after = both(before, WORKSHOP, A1, TRADING_POST, A3)
    const record = after.assistedActions.at(-1)
    if (record === undefined) throw new Error('no record')
    expect(usedKeys(after)).toContain(KEY)
    const cancelled = unwrap(
      applyCancellation(after, {
        playerId: KARANDRAS1,
        requestId: 'cancel-1',
        command: { logId: record.logId, itemId: twain.itemId },
      }, before),
    )
    expect(cancelled.assistedActions.at(-1)?.status).toBe('cancelled')
    expect(piecesOf(cancelled, 'buildings/workshop')).toEqual([])
    expect(piecesOf(cancelled, 'buildings/tradingpost')).toEqual([])
    expect(usedKeys(cancelled)).not.toContain(KEY)
    // A cancelled city action stays the city's action of the turn, so another one is confirmed; Engineering is free for it
    const again = unwrap(
      performAssistedAction(cancelled, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'req-2',
        at: AT,
        payload: payload(cancelled, MARKET, B3, ARMY, B1),
        confirmedRepeat: true,
      }),
    )
    expect(usedKeys(again)).toContain(KEY)
    expect(piecesOf(again, 'buildings/market')).toHaveLength(1)
  })
})

describe('the undo is all or nothing', () => {
  const twoBuildings = () => both(withOverride(ready(), 30), WORKSHOP, A1, TRADING_POST, A3)
  const recordOf = (state: GameState) => state.assistedActions[0]?.id ?? ''

  it('the second item cannot be taken back: the state is untouched', () => {
    const done = twoBuildings()
    const post = piecesOf(done, 'buildings/tradingpost')[0] as BoardPiece
    const gone = { ...done, board: { ...done.board, pieces: done.board.pieces.filter((piece) => piece.id !== post.id) } }
    const before = JSON.stringify(gone)
    expect(reverseAssistedAction(gone, recordOf(gone), AT).ok).toBe(false)
    expect(JSON.stringify(gone)).toBe(before)
  })

  it('the first item cannot be taken back after the second was: nothing is changed', () => {
    const done = twoBuildings()
    const workshop = piecesOf(done, 'buildings/workshop')[0] as BoardPiece
    const gone = { ...done, board: { ...done.board, pieces: done.board.pieces.filter((piece) => piece.id !== workshop.id) } }
    const before = JSON.stringify(gone)
    const result = reverseAssistedAction(gone, recordOf(gone), AT)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(gone)).toBe(before)
    expect(gone.assistedActions[0]?.status).toBe('applied')
    expect(usedKeys(gone)).toContain(KEY)
  })
})

describe('by-hand removal of a piece of the build', () => {
  it('takes both items back before End turn', () => {
    const done = twoBuildings0()
    const workshop = piecesOf(done, 'buildings/workshop')[0] as BoardPiece
    const taken = takeBackOpenBuild(done, { playerId: CASH1981, pieceId: workshop.id, at: AT })
    expect(taken?.ok).toBe(true)
    if (taken?.ok) {
      expect(piecesOf(taken.value, 'buildings/tradingpost')).toEqual([])
      expect(usedKeys(taken.value)).not.toContain(KEY)
    }
  })

  it('falls back to a plain removal when the unit card of the build has left the hand', () => {
    const rich = withOverride(ready(0, ['Engineering', 'Construction']), 30)
    const done = both(rich, WORKSHOP, A1, INFANTRY)
    const card = me(done).items.find((item) => item.sheetName === 'INFANTRY')
    const without = {
      ...done,
      players: done.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => item.id !== card?.id) } : p)),
    }
    const workshop = piecesOf(without, 'buildings/workshop')[0] as BoardPiece
    expect(takeBackOpenBuild(without, { playerId: CASH1981, pieceId: workshop.id, at: AT })).toBeUndefined()
  })
})

describe('removal of a piece when its partner is already gone', () => {
  it('falls back to a plain removal when another player took the other piece off the board', () => {
    const done = twoBuildings0()
    const workshop = piecesOf(done, 'buildings/workshop')[0] as BoardPiece
    const post = piecesOf(done, 'buildings/tradingpost')[0] as BoardPiece
    const without = { ...done, board: { ...done.board, pieces: done.board.pieces.filter((piece) => piece.id !== post.id) } }
    expect(takeBackOpenBuild(without, { playerId: CASH1981, pieceId: workshop.id, at: AT })).toBeUndefined()
  })
})

function twoBuildings0(): GameState {
  return both(withOverride(ready(), 30), WORKSHOP, A1, TRADING_POST, A3)
}

describe('direct calls with a bad second item', () => {
  it('an empty or odd second is an error, not an exception', () => {
    const rich = withOverride(ready(), 30)
    for (const second of [{}, null, 'army', { item: null }, { item: { kind: 'castle' } }]) {
      const result = performAssistedAction(rich, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'req-1',
        at: AT,
        payload: { ...payload(rich, WORKSHOP, A1), second } as unknown as BuildPayload,
      })
      expect(result.ok).toBe(false)
    }
  })

  it('a null or odd square is an error, not an exception, for the second item and for the first', () => {
    const rich = withOverride(ready(), 30)
    for (const target of [null, 'A1', { column: 'x', row: 0 }, { column: 0 }, { column: 1.5, row: 0 }]) {
      const second = performAssistedAction(rich, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'req-1',
        at: AT,
        payload: { ...payload(rich, WORKSHOP, A1), second: { item: ARMY, target } } as unknown as BuildPayload,
      })
      expect(second.ok).toBe(false)
      const first = performAssistedAction(rich, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'req-2',
        at: AT,
        payload: { ...payload(rich, WORKSHOP, A1), target } as unknown as BuildPayload,
      })
      expect(first.ok).toBe(false)
    }
  })
})

describe('log line for walls and another item', () => {
  it('puts the walls note in brackets', () => {
    const rich = withOverride(ready(0, ['Engineering', 'Construction', 'Masonry']), 30)
    const done = both(rich, WALLS, undefined, WORKSHOP, A1)
    expect(done.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toBe(
      'cash1981 built City Walls (turning the city marker over to its walled side) and a Workshop on square A1 in City B2, splitting the production with Engineering',
    )
  })
})

describe('wonders in an Engineering build', () => {
  const COLOSSUS = 'wonders/colossus'
  const STONEHENGE = 'wonders/stonehenge'
  const WONDER = (assetId: string): BuildItem => ({ kind: 'wonder', assetId })

  function market(extraTechs: readonly string[] = []): GameState {
    let state = withOverride(ready(0, ['Engineering', 'Construction', ...extraTechs]), 40)
    const area = wondersArea(state.board)
    ;[COLOSSUS, STONEHENGE].forEach((assetId, index) => {
      state = unwrap(placePiece(state, { playerId: CASH1981, assetId, x: area.x + 8 + index * 10, y: area.y + 40 + index * 90 }))
    })
    const onBoard = new Set(state.board.pieces.filter((piece) => piece.category === 'wonder').map((piece) => piece.assetId))
    return { ...state, items: state.items.filter((item) => item.kind !== 'wonder' || !onBoard.has(wonderAssetId((item as { name: string }).name))) }
  }
  const inMarket = (state: GameState): number =>
    state.board.pieces.filter((piece) => piece.category === 'wonder' && isInWondersArea(state.board, piece) && (piece.ownerId ?? null) === null).length

  it('refuses two wonders', () => {
    expect(refusal(tryBuild(market(), WONDER(COLOSSUS), A1, WONDER(STONEHENGE), B3))).toMatch(/one wonder/)
  })

  it('a wonder as the second item refills the market once and the undo puts everything back', () => {
    const state = market()
    const before = snapshot(state)
    const done = both(state, WORKSHOP, A1, WONDER(COLOSSUS), B3)
    expect(me(done).stats.trade).toBe(0)
    expect(inMarket(done)).toBe(inMarket(state))
    expect(done.assistedActions[0]?.effect).toMatchObject({ engineering: { second: { item: { kind: 'wonder' }, drawn: expect.anything() } } })
    const undone = undoByVote(done, 'req-1')
    expect(snapshot(undone)).toBe(before)
    expect(inMarket(undone)).toBe(inMarket(state))
    const colossus = piecesOf(undone, COLOSSUS)[0] as BoardPiece
    expect(isInWondersArea(undone.board, colossus)).toBe(true)
    expect(colossus.ownerId ?? null).toBeNull()
    // The board Undo may not walk back past the reversal
    expect(undone.board.undoFloor).toBe(undone.board.history.length)
  })

  it('a wonder first and a building second: the undo returns the wonder to its spot', () => {
    const state = market()
    const spot = piecesOf(state, COLOSSUS)[0] as BoardPiece
    const done = both(state, WONDER(COLOSSUS), B3, WORKSHOP, A1)
    expect(piecesOf(done, 'buildings/workshop')).toHaveLength(1)
    const undone = undoByVote(done, 'req-1')
    const back = piecesOf(undone, COLOSSUS)[0] as BoardPiece
    expect([back.x, back.y]).toEqual([spot.x, spot.y])
    expect(snapshot(undone)).toBe(snapshot(state))
  })

  it('records and undoes Education, Michelangelo and Jim Henson with the build', () => {
    const base = market(['Education'])
    const henson = withCardInHand(base, 'Jim Henson')
    const state: GameState = {
      ...henson.state,
      players: henson.state.players.map((p) =>
        p.playerId === CASH1981
          ? { ...p, wonderDiscount: 5, items: p.items.map((item) => (item.id === henson.itemId ? { ...item, hidden: false } : item)) }
          : p,
      ),
    }
    const before = snapshot(state)
    const done = both(state, WORKSHOP, A1, WONDER(COLOSSUS), B3)
    expect(me(done).wonderDiscount).toBe(0)
    expect(me(done).hensonWounds).toBe(1)
    expect(usedKeys(done)).toEqual(expect.arrayContaining([KEY, 'coin:Education']))
    expect(done.assistedActions[0]?.effect).toMatchObject({
      engineering: { second: { wonderDiscount: 5, hensonWound: true, educationCoin: { tech: 'Education' } } },
    })
    const undone = undoByVote(done, 'req-1')
    expect(snapshot(undone)).toBe(before)
    expect(usedKeys(undone)).not.toContain('coin:Education')
  })
})
