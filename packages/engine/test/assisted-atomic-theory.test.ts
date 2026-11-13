/**
 * Atomic Theory (Uranium; issue #327, slice 2): an extra city action with each city in City Management, and a nuke on a
 * non-capital city, the player's own included, in Movement. Also Bureaucracy, a once-per-turn logged policy switch in
 * Research, which costs nothing, and the Democracy and Printing Press coin purchases (covered in `assisted.test.ts`).
 */

import { describe, expect, it } from 'vitest'

import { placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { chooseTech, revealTech } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { assistedAvailability, availableActionsFor, performAssistedAction } from '../src/assisted.js'
import { nukeTargetsFor } from '../src/atomic-theory.js'
import { SQUARE_SIZE, findBoardAsset, mapTop } from '../src/board.js'
import { cityActionsOf } from '../src/city-actions.js'
import { cityProductionsOf } from '../src/city-production.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { toPlayerView } from '../src/state.js'
import type { AssistedActionKind, GameState } from '../src/state.js'

import { player, withHutInHand } from './assisted-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-11-13T12:00:00.000Z'

const withTech = (state: GameState, techName: string, playerId = CASH1981): GameState =>
  unwrap(revealTech(unwrap(chooseTech(state, { playerId, techName })), { playerId, techName }))
const upTo = (state: GameState, phase: 'SOT' | 'TRADE' | 'CM' | 'MOVEMENT'): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: phase }))

const press = (state: GameState, action: AssistedActionKind, payload?: Record<string, unknown>, requestId = 'req-1', confirmedRepeat = false) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action,
    requestId,
    at: AT,
    ...(payload === undefined ? {} : { payload: payload as never }),
    ...(confirmedRepeat ? { confirmedRepeat } : {}),
  })

const tryVote = (state: GameState, requestId: string) => {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })
}
const refused = (result: ReturnType<typeof press>): string => unwrapErr(result).kind
const usedKeys = (state: GameState): readonly string[] => player(state).playerTurns.at(-1)?.usedActions ?? []
const hasHut = (state: GameState, name: string): boolean =>
  player(state).items.some((item) => item.kind === 'hut' && item.name === name && !item.used)

const put = (state: GameState, playerId: string, assetId: string, column: number, row: number): GameState => {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

/** Cash is Red, Karandras Blue, Itchi Green, Chul Yellow. */
function coloured(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const state = firstCivGame()
  return { ...state, players: state.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })) }
}

const idsAt = (state: GameState, assetId: string): readonly string[] => state.board.pieces.filter((piece) => piece.assetId === assetId).map((piece) => piece.id)

// ---------------------------------------------------------------------------
// Extra actions
// ---------------------------------------------------------------------------

describe('Atomic Theory: an extra action with each city (Uranium, City Management)', () => {
  /** A red capital on B2 and a red city on F6, City Management open, one Uranium. */
  const ready = (): GameState =>
    withHutInHand(upTo(withTech(put(put(coloured(), CASH1981, 'cities/redcapital2', 1, 1), CASH1981, 'cities/redcity2', 5, 5), 'Atomic Theory'), 'TRADE'), 'Uranium').state
  const cityIds = (state: GameState) => state.board.pieces.filter((piece) => piece.category === 'city').map((piece) => piece.id)
  const devote = (state: GameState, cityPieceId: string, requestId: string, confirmed = false) => press(state, 'devoteToTheArts', { cityPieceId }, requestId, confirmed)

  it('needs Uranium, the tech revealed and City Management or Movement open', () => {
    expect(assistedAvailability(ready(), CASH1981, 'atomicTheory').status).toBe('ready')
    expect(assistedAvailability(withTech(coloured(), 'Atomic Theory'), CASH1981, 'atomicTheory')).toMatchObject({ status: 'wrong-phase' })
    expect(assistedAvailability(upTo(withTech(coloured(), 'Atomic Theory'), 'TRADE'), CASH1981, 'atomicTheory').status).toBe('needs-resource')
    expect(assistedAvailability(coloured(), CASH1981, 'atomicTheory').status).toBe('not-owned')
    expect(availableActionsFor(ready(), CASH1981).find((entry) => entry.action === 'atomicTheory')?.group).toBe('Resource abilities')
  })

  it('pays the Uranium and lets each city act once more without the question, which the second extra action does not', () => {
    const state = ready()
    const [capital, city] = cityIds(state)
    if (capital === undefined || city === undefined) throw new Error('missing cities')
    // Without Atomic Theory a second action of one city is asked for
    const first = unwrap(devote(state, capital, 'req-a'))
    expect(refused(devote(first, capital, 'req-b'))).toBe('ASSISTED_ACTION_REJECTED')

    const used = unwrap(press(state, 'atomicTheory', { mode: 'extraActions' }))
    expect(hasHut(used, 'Uranium')).toBe(false)
    expect(used.log.at(-1)?.publicLog).toBe('cash1981 used Atomic Theory: spent 1 Uranium, so each of their cities may take one more city action this turn')
    expect(usedKeys(used)).toContain('card:Atomic Theory')

    const one = unwrap(devote(used, capital, 'req-a'))
    expect(cityActionsOf(one, player(one)).find((option) => option.cityPieceId === capital)).toMatchObject({ actedThisTurn: ['Devote to the Arts'], extraAction: true })
    expect(cityActionsOf(one, player(one)).find((option) => option.cityPieceId === city)?.extraAction).toBe(false)
    const two = unwrap(devote(one, capital, 'req-b'))
    expect(two.log.at(-1)?.publicLog).toContain('(an extra city action from Atomic Theory)')
    // A third action of the same city is back to the question; the other city has its own extra action
    expect(cityActionsOf(two, player(two)).find((option) => option.cityPieceId === capital)?.extraAction).toBe(false)
    expect(refused(devote(two, capital, 'req-c'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrap(devote(unwrap(devote(two, city, 'req-d')), city, 'req-e')).log.at(-1)?.publicLog).toContain('Atomic Theory')
  })

  it('is refused in the Movement phase, which is for a nuke, and nothing is paid', () => {
    const movement = upTo(ready(), 'CM')
    expect(assistedAvailability(movement, CASH1981, 'atomicTheory').status).toBe('ready')
    expect(refused(press(movement, 'atomicTheory', { mode: 'extraActions' }))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(movement, 'Uranium')).toBe(true)
  })

  it('refuses outside City Management, without a city, and with a bad mode; nothing is paid', () => {
    const state = ready()
    for (const payload of [undefined, {}, { mode: 'raze' }, { mode: 'extraActions', cityPieceId: 'x' }]) {
      // `extraActions` with a stray city is a parser matter; the engine ignores it, so only the first three refuse
      if (payload?.['mode'] === 'extraActions') continue
      expect(refused(press(state, 'atomicTheory', payload))).toBe('ASSISTED_ACTION_REJECTED')
    }
    const noCity = withHutInHand(upTo(withTech(coloured(), 'Atomic Theory'), 'TRADE'), 'Uranium').state
    expect(refused(press(noCity, 'atomicTheory', { mode: 'extraActions' }))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(noCity, 'Uranium')).toBe(true)
    // A nuke belongs to Movement
    expect(refused(press(state, 'atomicTheory', { mode: 'nuke', cityPieceId: cityIds(state)[0] }))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(state, 'Uranium')).toBe(true)
  })

  it('an undo by vote returns the Uranium and takes the allowance off; refused once a city used its extra action', () => {
    const state = ready()
    const [capital] = cityIds(state)
    if (capital === undefined) throw new Error('missing city')
    const used = unwrap(press(state, 'atomicTheory', { mode: 'extraActions' }))
    const undone = unwrap(tryVote(used, 'req-1'))
    expect(hasHut(undone, 'Uranium')).toBe(true)
    expect(usedKeys(undone)).not.toContain('card:Atomic Theory')
    const after = unwrap(devote(undone, capital, 'req-a'))
    expect(refused(devote(after, capital, 'req-b'))).toBe('ASSISTED_ACTION_REJECTED')

    const spent = unwrap(devote(unwrap(devote(used, capital, 'req-a')), capital, 'req-b'))
    expect(unwrapErr(tryVote(spent, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('a confirmed repeat gives nothing more than one extra action', () => {
    // The deck holds one Uranium hut: a second one is a copy with its own id
    const base = ready()
    const hut = player(base).items.find((item) => item.kind === 'hut' && item.name === 'Uranium')
    if (hut === undefined) throw new Error('no hut')
    const state: GameState = { ...base, players: base.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: [...p.items, { ...hut, id: 'second-uranium' }] } : p)) }
    const first = unwrap(press(state, 'atomicTheory', { mode: 'extraActions' }))
    expect(refused(press(first, 'atomicTheory', { mode: 'extraActions' }, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrap(press(first, 'atomicTheory', { mode: 'extraActions' }, 'req-2', true)).log.at(-1)?.publicLog).toContain('confirmed by the player')
  })
})

// ---------------------------------------------------------------------------
// Nuke
// ---------------------------------------------------------------------------

describe('Atomic Theory: nuke a non-capital city (Uranium, Movement)', () => {
  /**
   * Karandras (Blue): a capital on D4 and a city on J10 with a Library on K10, a Big Ben wonder on K11, a Blue Army on I10,
   * a Scientist on J9, and on its centre a caravan. Around, things the nuke leaves: an iron token in the city's outskirts, an
   * army on its centre, a Library outside the outskirts, and a building of the capital. Cash is Red with its own city on B2.
   */
  function scene(): GameState {
    let state = coloured()
    state = put(state, KARANDRAS1, 'cities/bluecapital2', 3, 3)
    state = put(state, KARANDRAS1, 'buildings/library', 4, 3)
    state = put(state, KARANDRAS1, 'cities/bluecity2', 9, 9)
    state = put(state, KARANDRAS1, 'buildings/library', 10, 9)
    state = put(state, KARANDRAS1, 'wonders/bigben', 10, 10)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 9)
    state = put(state, KARANDRAS1, 'great people/scientist', 9, 8)
    state = put(state, KARANDRAS1, 'markers/caravan', 9, 9)
    state = put(state, KARANDRAS1, 'resources/iron', 8, 8)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 9, 9)
    state = put(state, KARANDRAS1, 'buildings/library', 13, 13)
    state = put(state, CASH1981, 'cities/redcity2', 1, 1)
    return upTo(withHutInHand(withTech(state, 'Atomic Theory'), 'Uranium').state, 'CM')
  }
  const blueCity = (state: GameState): string => {
    const found = state.board.pieces.find((piece) => piece.assetId === 'cities/bluecity2')
    if (found === undefined) throw new Error('no blue city')
    return found.id
  }
  const nuke = (state: GameState, cityPieceId: string, requestId = 'req-1') => press(state, 'atomicTheory', { mode: 'nuke', cityPieceId }, requestId)

  it('lists every city that is not a capital, the player\'s own included, with what each would take, and is ready in Movement', () => {
    const state = scene()
    expect(assistedAvailability(state, CASH1981, 'atomicTheory').status).toBe('ready')
    const targets = nukeTargetsFor(state, CASH1981)
    expect(targets.map((target) => [target.label, target.ownerUsername, target.own])).toEqual([
      ['City B2', 'cash1981', true],
      ['City J10', 'Karandras1', false],
    ])
    const theirs = targets.find((target) => target.pieceId === blueCity(state))
    // Figures first, then great persons, wonders, buildings and the markers of the city itself
    expect(theirs?.destroyed.map((item) => item.label)).toEqual(['Blue army', 'Scientist', 'Big Ben', 'Library', 'Caravan'])
  })

  it('destroys the city and the buildings, wonders, figures and great person markers in its outskirts, through the board history', () => {
    const state = scene()
    const before = state.board.pieces.length
    const used = unwrap(nuke(state, blueCity(state)))
    expect(hasHut(used, 'Uranium')).toBe(false)
    // The city, the Library, the wonder, the army and the Scientist in the outskirts, and the caravan on the centre
    expect(before - used.board.pieces.length).toBe(6)
    expect(used.board.pieces.some((piece) => piece.assetId === 'cities/bluecity2')).toBe(false)
    expect(used.board.pieces.some((piece) => piece.assetId === 'wonders/bigben')).toBe(false)
    expect(used.board.pieces.some((piece) => piece.assetId === 'great people/scientist')).toBe(false)
    expect(used.board.pieces.some((piece) => piece.assetId === 'markers/caravan')).toBe(false)
    // What the card does not name stays: the capital and its Library, the Library outside, the token, the figure on the centre
    expect(used.board.pieces.some((piece) => piece.assetId === 'cities/bluecapital2')).toBe(true)
    expect(idsAt(used, 'buildings/library')).toHaveLength(2)
    expect(used.board.pieces.some((piece) => piece.assetId === 'resources/iron')).toBe(true)
    expect(idsAt(used, 'figures/bluearmy')).toHaveLength(1)
    const line = used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog ?? ''
    expect(line).toMatch(/^cash1981 used Atomic Theory: spent 1 Uranium, nuking City J10 of Karandras1: the city is destroyed along with /)
    for (const name of ['Library (K10)', 'Big Ben', 'Blue army (I10)', 'Scientist (J9)']) expect(line).toContain(name)
    expect(usedKeys(used)).toContain('card:Atomic Theory')
    // The board's own Undo does not take one of the removals alone
    expect(undoLastBoardChange(used, CASH1981)).toMatchObject({ ok: false })
  })

  it('refuses a capital, a metropolis, your own capital, an unknown piece and a malformed payload, with nothing spent', () => {
    const state = put(scene(), CASH1981, 'cities/redcapital2', 14, 1)
    const capital = state.board.pieces.find((piece) => piece.assetId === 'cities/bluecapital2')
    const mine = state.board.pieces.find((piece) => piece.assetId === 'cities/redcapital2')
    if (capital === undefined || mine === undefined) throw new Error('missing cities')
    for (const payload of [{ mode: 'nuke', cityPieceId: capital.id }, { mode: 'nuke', cityPieceId: mine.id }, { mode: 'nuke', cityPieceId: 'nope' }, { mode: 'nuke' }, { mode: 'nuke', cityPieceId: 7 }]) {
      expect(refused(press(state, 'atomicTheory', payload as never))).toBe('ASSISTED_ACTION_REJECTED')
    }
    expect(hasHut(state, 'Uranium')).toBe(true)
    expect(state.assistedActions).toHaveLength(0)
    // A metropolis is the capital grown, so it is not a target either
    const grown = put(put(coloured(), KARANDRAS1, 'cities/bluemetropolis2', 3, 3), CASH1981, 'cities/redmetropolis2', 8, 8)
    expect(nukeTargetsFor(grown, CASH1981)).toHaveLength(0)
  })

  it('with no legal target the action is refused and the Uranium stays', () => {
    const only = upTo(withHutInHand(withTech(put(put(coloured(), KARANDRAS1, 'cities/bluecapital2', 3, 3), CASH1981, 'cities/redcapital2', 1, 1), 'Atomic Theory'), 'Uranium').state, 'CM')
    expect(nukeTargetsFor(only, CASH1981)).toEqual([])
    expect(refused(nuke(only, 'any'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(only, 'Uranium')).toBe(true)
  })

  describe("nuking the player's own city to kill the enemy figures around it", () => {
    /** Cash: a capital on D4 and a city on J10 with its Library, army and wonder around it; two Blue armies in its outskirts, one outside. */
    function ownScene(): GameState {
      let state = coloured()
      state = put(state, CASH1981, 'cities/redcapital2', 3, 3)
      state = put(state, CASH1981, 'cities/redcity2', 9, 9)
      state = put(state, CASH1981, 'buildings/library', 10, 9)
      state = put(state, CASH1981, 'wonders/bigben', 10, 10)
      state = put(state, CASH1981, 'figures/redarmy', 8, 9)
      state = put(state, KARANDRAS1, 'figures/bluearmy', 9, 8)
      state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 10)
      state = put(state, KARANDRAS1, 'figures/bluearmy', 13, 13)
      return upTo(withHutInHand(withTech(state, 'Atomic Theory'), 'Uranium').state, 'CM')
    }
    const redCity = (state: GameState): string => {
      const found = state.board.pieces.find((piece) => piece.assetId === 'cities/redcity2')
      if (found === undefined) throw new Error('no red city')
      return found.id
    }

    it('is a target, marked as the player\'s own, and destroys everything in its outskirts whoever owns it', () => {
      const state = ownScene()
      const target = nukeTargetsFor(state, CASH1981).find((candidate) => candidate.pieceId === redCity(state))
      expect(target).toMatchObject({ label: 'City J10', own: true })
      const used = unwrap(nuke(state, redCity(state)))
      // The city, its Library and wonder, the player's own army and the two Blue armies around it
      expect(state.board.pieces.length - used.board.pieces.length).toBe(6)
      expect(idsAt(used, 'figures/bluearmy')).toHaveLength(1)
      expect(idsAt(used, 'figures/redarmy')).toHaveLength(0)
      expect(used.board.pieces.some((piece) => piece.assetId === 'cities/redcity2')).toBe(false)
      expect(used.board.pieces.some((piece) => piece.assetId === 'cities/redcapital2')).toBe(true)
      expect(used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toMatch(/nuking City J10 of cash1981: the city is destroyed along with Red army \(I10\), Blue army/)
    })

    it('an undo by vote restores every piece exactly, the enemy figures too', () => {
      const state = ownScene()
      const used = unwrap(nuke(state, redCity(state)))
      const undone = unwrap(tryVote(used, 'req-1'))
      const key = (piece: { id: string; x: number; y: number; assetId: string }) => `${piece.id}@${piece.x},${piece.y}:${piece.assetId}`
      expect(undone.board.pieces.map(key).sort()).toEqual(state.board.pieces.map(key).sort())
      expect(hasHut(undone, 'Uranium')).toBe(true)
    })

    it('keeps the records that point at the destroyed city harmless: a boost on it counts for nothing and returns with the city', () => {
      const base = ownScene()
      const city = redCity(base)
      const boosted: GameState = {
        ...base,
        assistedActions: [
          {
            id: 'boost-1', kind: 'construction', playerId: CASH1981, turnNumber: 1, phase: 'CM', usageKey: 'card:Construction', at: null, logId: 'x', status: 'applied',
            effect: { kind: 'productionBoost', tech: 'Construction', cityPieceId: city, cityLabel: 'City J10', amount: 5, spent: [] },
          },
        ],
      }
      expect(cityProductionsOf(boosted, player(boosted)).find((entry) => entry.pieceId === city)?.boost).toBe(5)
      const used = unwrap(nuke(boosted, city))
      // The city is gone: the remaining city list is read without the dead record getting in the way
      expect(cityProductionsOf(used, player(used)).map((entry) => entry.pieceId)).not.toContain(city)
      expect(() => toPlayerView(used, CASH1981)).not.toThrow()
      expect(() => toPlayerView(used, KARANDRAS1)).not.toThrow()
      const undone = unwrap(tryVote(used, 'req-1'))
      expect(cityProductionsOf(undone, player(undone)).find((entry) => entry.pieceId === city)?.boost).toBe(5)
    })

  })

  it('is a Movement action: refused in City Management', () => {
    const cm = upTo(withHutInHand(withTech(put(put(coloured(), KARANDRAS1, 'cities/bluecity2', 9, 9), KARANDRAS1, 'cities/bluecapital2', 3, 3), 'Atomic Theory'), 'Uranium').state, 'TRADE')
    expect(refused(nuke(cm, blueCity(cm)))).toBe('ASSISTED_ACTION_REJECTED')
    expect(hasHut(cm, 'Uranium')).toBe(true)
  })

  it('an undo by vote puts every piece back exactly as it stood and returns the Uranium', () => {
    const state = scene()
    const used = unwrap(nuke(state, blueCity(state)))
    const undone = unwrap(tryVote(used, 'req-1'))
    expect(hasHut(undone, 'Uranium')).toBe(true)
    expect(undone.board.pieces.length).toBe(state.board.pieces.length)
    const key = (piece: { id: string; x: number; y: number; assetId: string }) => `${piece.id}@${piece.x},${piece.y}:${piece.assetId}`
    expect(undone.board.pieces.map(key).sort()).toEqual(state.board.pieces.map(key).sort())
    expect(usedKeys(undone)).not.toContain('card:Atomic Theory')
    expect(undone.log.at(-1)?.publicLog).toContain('City J10 was put back with everything that stood around it')
    // The board Undo cannot walk back through the restoration into the removals
    expect(undoLastBoardChange(undone, CASH1981)).toMatchObject({ ok: false })
  })

  it('refuses the undo when a city now stands where the destroyed city was, and changes nothing', () => {
    const state = scene()
    const used = unwrap(nuke(state, blueCity(state)))
    const rebuilt = put(used, CASH1981, 'cities/redcity2', 9, 9)
    const refusal = JSON.stringify(unwrapErr(tryVote(rebuilt, 'req-1')))
    expect(refusal).toContain('A city now stands where the destroyed city was')
    // A city elsewhere does not stop it
    const elsewhere = put(used, CASH1981, 'cities/redcity2', 13, 2)
    expect(unwrap(tryVote(elsewhere, 'req-1')).board.pieces.some((piece) => piece.assetId === 'cities/bluecity2')).toBe(true)
  })

  it('refuses the undo when a piece of the destroyed city is on the board again', () => {
    const state = scene()
    const used = unwrap(nuke(state, blueCity(state)))
    const effect = used.assistedActions.at(-1)?.effect
    if (effect?.kind !== 'atomicTheory' || effect.mode !== 'nuke') throw new Error('wrong effect')
    const back: GameState = { ...used, board: { ...used.board, pieces: [...used.board.pieces, effect.removed[0]!.piece] } }
    expect(unwrapErr(tryVote(back, 'req-1')).kind).toBe('ASSISTED_UNDO_BLOCKED')
  })

  it('pays with A Princely Gift, the only culture card that can be played as Uranium', () => {
    const base = scene()
    const without: GameState = { ...base, players: base.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: p.items.filter((item) => !(item.kind === 'hut' && item.name === 'Uranium')) } : p)) }
    const gift = base.items.find((item) => 'name' in item && item.name === 'A Princely Gift')
    if (gift === undefined) throw new Error('no gift')
    const state: GameState = {
      ...without,
      items: without.items.filter((item) => item.id !== gift.id),
      players: without.players.map((p) => (p.playerId === CASH1981 ? { ...p, items: [...p.items, { ...gift, hidden: true, ownerId: CASH1981 }] } : p)),
    }
    expect(assistedAvailability(state, CASH1981, 'atomicTheory')).toMatchObject({ status: 'ready', warning: expect.stringContaining('A Princely Gift') })
    const used = unwrap(nuke(state, blueCity(state)))
    expect(used.log.find((entry) => entry.assistedActionId === 'req-1')?.publicLog).toMatch(/played A Princely Gift item number #\d+ as Uranium, nuking/)
    expect(unwrap(tryVote(used, 'req-1')).board.pieces.length).toBe(state.board.pieces.length)
  })

  it('shows nothing private through the public records of a nuke', () => {
    const state = scene()
    const view = JSON.stringify(toPlayerView(unwrap(nuke(state, blueCity(state))), ITCHI).assistedActions)
    expect(view).not.toContain('removed')
    expect(view).not.toContain('effect')
  })
})

// ---------------------------------------------------------------------------
// Bureaucracy
// ---------------------------------------------------------------------------

describe('Bureaucracy (once per turn, during Research: switch one social policy)', () => {
  const research = (): GameState => upTo(withTech(firstCivGame(), 'Bureaucracy'), 'MOVEMENT')

  it('gives the flat 1 coin when the tech is revealed, and holds none while it is hidden', () => {
    expect(player(withTech(firstCivGame(), 'Bureaucracy')).stats.coinSources.bureaucracy).toBe(1)
    expect(player(unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Bureaucracy' }))).stats.coinSources.bureaucracy).toBe(0)
  })

  it('is available only in the open Research phase with the tech revealed, and costs nothing', () => {
    expect(assistedAvailability(research(), CASH1981, 'bureaucracy').status).toBe('ready')
    expect(assistedAvailability(upTo(withTech(firstCivGame(), 'Bureaucracy'), 'TRADE'), CASH1981, 'bureaucracy')).toMatchObject({ status: 'wrong-phase', reason: 'Only available during your open Research phase.' })
    expect(assistedAvailability(firstCivGame(), CASH1981, 'bureaucracy').status).toBe('not-owned')
    const hidden = upTo(unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Bureaucracy' })), 'MOVEMENT')
    expect(assistedAvailability(hidden, CASH1981, 'bureaucracy').status).toBe('unavailable')
    expect(availableActionsFor(research(), CASH1981).find((entry) => entry.action === 'bureaucracy')?.phase).toBe('RESEARCH')
  })

  it('logs one switch, changes nothing else and is once per turn with a confirmed repeat', () => {
    const before = research()
    const used = unwrap(press(before, 'bureaucracy'))
    expect(used.log.at(-1)?.publicLog).toBe('cash1981 used Bureaucracy: may switch one of their social policies during research (the switch is made by hand in the social policy panel)')
    expect(player(used).socialPolicies).toEqual(player(before).socialPolicies)
    expect(usedKeys(used)).toContain('card:Bureaucracy')
    expect(assistedAvailability(used, CASH1981, 'bureaucracy').status).toBe('used')
    expect(refused(press(used, 'bureaucracy', undefined, 'req-2'))).toBe('ASSISTED_ACTION_REJECTED')
    expect(unwrap(press(used, 'bureaucracy', undefined, 'req-2', true)).log.at(-1)?.publicLog).toContain('confirmed by the player')
  })

  it('an undo by vote frees the use and writes a line without any token', () => {
    const used = unwrap(press(research(), 'bureaucracy'))
    const undone = unwrap(tryVote(used, 'req-1'))
    expect(usedKeys(undone)).not.toContain('card:Bureaucracy')
    expect(undone.log.at(-1)?.publicLog).toBe(
      "System: cash1981's Bureaucracy was undone: the policy switch is no longer logged (the policies are not changed by the game)",
    )
    expect(assistedAvailability(undone, CASH1981, 'bureaucracy').status).toBe('ready')
  })
})
