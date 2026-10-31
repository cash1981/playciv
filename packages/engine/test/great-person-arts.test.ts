/**
 * The Great Persons that build on Devote to the Arts: Jerry Garcia, Ada Lovelace, Akira Kurosawa
 * and Charles Darwin. Each test names the printed ability it covers.
 *
 * The scene: America, a red capital on B2 and a red city on E2, City Management open.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { cityActionsTakenThisTurn, performAssistedAction } from '../src/assisted.js'
import { playableCardsOf } from '../src/assisted-cards.js'
import { SQUARE_SIZE, findBoardAsset, mapTop, slotOrigin } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { cityActionsOf } from '../src/city-actions.js'
import { tradeCeilingOf } from '../src/limits.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'

import { withCardInHand } from './assisted-fixture.js'
import { withStats } from './culture-advance-fixture.js'
import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-31T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

function put(state: GameState, assetId: string, column: number, row: number): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId: CASH1981,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
    }),
  )
}

function scene(options: { readonly capital?: boolean } = {}): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green', [CHUL]: 'Yellow' }
  const base = firstCivGame()
  let state: GameState = { ...base, players: base.players.map((p) => ({ ...p, color: colors[p.playerId] ?? p.color })) }
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('no slot')
  const [x, y] = slotOrigin(state.board, slot)
  state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
  state = put(state, options.capital === false ? 'cities/redcity2' : 'cities/redcapital2', 1, 1)
  state = put(state, 'cities/redcity2', 4, 1)
  return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
}

const me = (state: GameState, playerId = CASH1981): Playerhand => {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error(`no player ${playerId}`)
  return found
}

const cities = (state: GameState): readonly BoardPiece[] => state.board.pieces.filter((piece) => piece.category === 'city')
const capitalId = (state: GameState): string => (cities(state).find((piece) => piece.assetId.includes('capital')) as BoardPiece).id
const otherCityId = (state: GameState): string => (cities(state).find((piece) => !piece.assetId.includes('capital')) as BoardPiece).id
const estimate = (state: GameState, cityPieceId: string): number =>
  cityActionsOf(state, me(state)).find((city) => city.cityPieceId === cityPieceId)?.devoteToTheArts.culture ?? -1

/** A card in a player's hand, turned faceup as the play of a card that stays does it. */
function holding(state: GameState, name: string, ownerId = CASH1981): { readonly state: GameState; readonly itemId: string } {
  const card = withCardInHand(state, name, ownerId)
  return {
    itemId: card.itemId,
    state: {
      ...card.state,
      players: card.state.players.map((candidate) =>
        candidate.playerId === ownerId
          ? { ...candidate, items: candidate.items.map((item) => (item.id === card.itemId ? { ...item, hidden: false } : item)) }
          : candidate,
      ),
    },
  }
}

const play = (state: GameState, requestId: string, itemId: string) =>
  performAssistedAction(state, { playerId: CASH1981, action: 'playCard', requestId, at: AT, payload: { itemId, targets: [] } })

const devote = (
  state: GameState,
  requestId: string,
  cityPieceId: string,
  extra: { readonly darwin?: boolean; readonly confirmed?: boolean; readonly culture?: number } = {},
) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'devoteToTheArts',
    requestId,
    at: AT,
    ...(extra.confirmed === true ? { confirmedRepeat: true } : {}),
    payload: {
      cityPieceId,
      ...(extra.darwin === undefined ? {} : { darwin: extra.darwin }),
      ...(extra.culture === undefined ? {} : { culture: extra.culture }),
    },
  })

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

describe('Jerry Garcia', () => {
  it("devotes every city for its own culture as the capital's action, and the other city may still act", () => {
    const card = withCardInHand(scene(), 'Jerry Garcia')
    const total = estimate(card.state, capitalId(card.state)) + estimate(card.state, otherCityId(card.state))
    expect(total).toBeGreaterThan(0)

    const played = unwrap(play(card.state, 'g1', card.itemId))
    expect(me(played).stats.culture).toBe(total)
    expect(me(played).items.some((item) => item.id === card.itemId)).toBe(false)
    expect(played.log.at(-1)?.publicLog).toContain('devoting 2 cities to the arts')
    expect(cityActionsTakenThisTurn(played, me(played), capitalId(played))).toEqual(['Devote to the Arts (Jerry Garcia)'])
    expect(cityActionsTakenThisTurn(played, me(played), otherCityId(played))).toEqual([])

    // The other city acts with no question; the capital is asked about as for any second action
    const second = unwrap(devote(played, 'g2', otherCityId(played)))
    expect(second.log.at(-1)?.publicLog).not.toContain('second action')
    const again = unwrapErr(devote(played, 'g3', capitalId(played)))
    expect(JSON.stringify(again)).toContain('already acted')
  })

  it('is undone by the vote: the culture goes and the card is back in the hand', () => {
    const card = withCardInHand(scene(), 'Jerry Garcia')
    const played = unwrap(play(card.state, 'g1', card.itemId))
    const undone = undoByVote(played, 'g1')
    expect(me(undone).stats.culture).toBe(0)
    expect(me(undone).items.some((item) => item.id === card.itemId)).toBe(true)
    expect(cityActionsTakenThisTurn(undone, me(undone), capitalId(undone))).toEqual([])
  })

  it('needs a capital on the map: the card stays in the hand', () => {
    const card = withCardInHand(scene({ capital: false }), 'Jerry Garcia')
    const refused = unwrapErr(play(card.state, 'g1', card.itemId))
    expect(JSON.stringify(refused)).toContain('no capital')
    expect(me(card.state).items.some((item) => item.id === card.itemId)).toBe(true)
  })

  it('cannot be played outside City Management', () => {
    const card = withCardInHand(firstCivGame(), 'Jerry Garcia')
    const listed = playableCardsOf(card.state, me(card.state)).find((candidate) => candidate.itemId === card.itemId)
    expect(listed?.status).toBe('wrong-phase')
  })
})

describe('Ada Lovelace', () => {
  it("lets one city take a second action with no question, noted in the log, and no more than one", () => {
    const state = scene()
    const card = withCardInHand(state, 'Ada Lovelace')
    const city = capitalId(card.state)

    // Without her the second action is refused
    const first = unwrap(devote(card.state, 'a1', city))
    expect(JSON.stringify(unwrapErr(devote(first, 'a2', city)))).toContain('already acted')

    const played = unwrap(play(first, 'l1', card.itemId))
    expect(cityActionsOf(played, me(played)).every((option) => option.extraAction)).toBe(true)
    const extra = unwrap(devote(played, 'a2', city))
    expect(extra.log.at(-1)?.publicLog).toContain('an extra city action from Ada Lovelace')
    expect(cityActionsOf(extra, me(extra)).some((option) => option.extraAction)).toBe(false)

    // Her action is used up: a third one is asked about again
    expect(JSON.stringify(unwrapErr(devote(extra, 'a3', city)))).toContain('already acted')
  })

  it('gives nothing before the card is played, and undoing the card takes the extra action away', () => {
    const card = withCardInHand(scene(), 'Ada Lovelace')
    expect(cityActionsOf(card.state, me(card.state)).some((option) => option.extraAction)).toBe(false)
    const played = unwrap(play(card.state, 'l1', card.itemId))
    expect(cityActionsOf(played, me(played)).some((option) => option.extraAction)).toBe(true)
    const undone = undoByVote(played, 'l1')
    expect(cityActionsOf(undone, me(undone)).some((option) => option.extraAction)).toBe(false)
  })

  it("does not use her credit for a second action confirmed before her card was played", () => {
    const card = withCardInHand(scene(), 'Ada Lovelace')
    const city = capitalId(card.state)
    const first = unwrap(devote(card.state, 'a1', city))
    const confirmed = unwrap(devote(first, 'a2', city, { confirmed: true }))
    const played = unwrap(play(confirmed, 'l1', card.itemId))
    expect(cityActionsOf(played, me(played)).every((option) => option.extraAction)).toBe(true)
    expect(unwrap(devote(played, 'a3', city)).log.at(-1)?.publicLog).toContain('an extra city action from Ada Lovelace')
  })

  it('cannot be undone once an action has used her extra action, and can after that action is undone', () => {
    const card = withCardInHand(scene(), 'Ada Lovelace')
    const city = capitalId(card.state)
    const first = unwrap(devote(card.state, 'a1', city))
    const played = unwrap(play(first, 'l1', card.itemId))
    const used = unwrap(devote(played, 'a2', city))

    const entry = used.log.find((candidate) => candidate.assistedActionId === 'l1')
    if (entry === undefined) throw new Error('no log line for Lovelace')
    let pending = unwrap(initiateUndo(used, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of OTHERS.slice(0, -1)) pending = unwrap(vote(pending, { logId: entry.id, playerId, vote: true, at: AT }))
    const refused = vote(pending, { logId: entry.id, playerId: OTHERS[2] as string, vote: true, at: AT })
    expect(JSON.stringify(unwrapErr(refused))).toContain('already been used')

    const freed = undoByVote(used, 'a2')
    expect(cityActionsOf(freed, me(freed)).every((option) => option.extraAction)).toBe(true)
    expect(me(undoByVote(freed, 'l1')).items.some((item) => item.id === card.itemId)).toBe(true)
  })

  it("is used up by Garcia's play on a capital that has already acted, which the log says", () => {
    const lovelace = withCardInHand(scene(), 'Ada Lovelace')
    const garcia = withCardInHand(lovelace.state, 'Jerry Garcia')
    const first = unwrap(devote(garcia.state, 'a1', capitalId(garcia.state)))
    const credit = unwrap(play(first, 'l1', lovelace.itemId))
    const devoted = unwrap(play(credit, 'g1', garcia.itemId))
    expect(devoted.log.at(-1)?.publicLog).toContain('an extra city action from Ada Lovelace')
    expect(cityActionsOf(devoted, me(devoted)).some((option) => option.extraAction)).toBe(false)
  })

  it('cannot be played outside City Management', () => {
    const card = withCardInHand(firstCivGame(), 'Ada Lovelace')
    const listed = playableCardsOf(card.state, me(card.state)).find((candidate) => candidate.itemId === card.itemId)
    expect(listed?.status).toBe('wrong-phase')
  })
})

describe('Akira Kurosawa', () => {
  it('gives the holder 1 culture each time another player devotes a city, and the undo takes it back', () => {
    const holder = holding(scene(), 'Akira Kurosawa', KARANDRAS1)
    const devoted = unwrap(devote(holder.state, 'k1', capitalId(holder.state)))
    expect(me(devoted, KARANDRAS1).stats.culture).toBe(1)
    expect(devoted.log.at(-1)?.publicLog).toContain('Akira Kurosawa gives')

    const undone = undoByVote(devoted, 'k1')
    expect(me(undone, KARANDRAS1).stats.culture).toBe(0)
  })

  it('pays once for each city Jerry Garcia devotes', () => {
    const holder = holding(scene(), 'Akira Kurosawa', KARANDRAS1)
    const card = withCardInHand(holder.state, 'Jerry Garcia')
    const played = unwrap(play(card.state, 'k1', card.itemId))
    expect(me(played, KARANDRAS1).stats.culture).toBe(2)
    expect(me(undoByVote(played, 'k1'), KARANDRAS1).stats.culture).toBe(0)
  })

  it('pays nobody for the holder own devotion, a facedown card, or a card that is not played', () => {
    const own = holding(scene(), 'Akira Kurosawa', CASH1981)
    expect(me(unwrap(devote(own.state, 'k1', capitalId(own.state)))).stats.culture).toBe(estimate(own.state, capitalId(own.state)))

    const facedown = withCardInHand(scene(), 'Akira Kurosawa', KARANDRAS1)
    expect(me(unwrap(devote(facedown.state, 'k1', capitalId(facedown.state))), KARANDRAS1).stats.culture).toBe(0)
  })

  it('an undo stops at 0 when the holder has spent the culture since', () => {
    const holder = holding(scene(), 'Akira Kurosawa', KARANDRAS1)
    const devoted = unwrap(devote(holder.state, 'k1', capitalId(holder.state)))
    const spent = withStats(devoted, { culture: 0 }, KARANDRAS1)
    const undone = undoByVote(spent, 'k1')
    expect(me(undone, KARANDRAS1).stats.culture).toBe(0)
    expect(undone.log.at(-1)?.publicLog).toContain('had spent 1 of the culture from Akira Kurosawa')
  })

  it('is told to the player before it is played', () => {
    const card = withCardInHand(scene(), 'Akira Kurosawa')
    const listed = playableCardsOf(card.state, me(card.state)).find((candidate) => candidate.itemId === card.itemId)
    expect(listed?.automatic).toContain('1 culture each time another player devotes')
  })
})

describe('Charles Darwin', () => {
  it('turns all the culture of one devoted city into trade, once each turn', () => {
    const held = holding(withStats(scene(), { trade: 3 }), 'Charles Darwin')
    const city = capitalId(held.state)
    const culture = estimate(held.state, city)
    expect(cityActionsOf(held.state, me(held.state))[0]?.devoteToTheArts.darwin).toBe('ready')

    const devoted = unwrap(devote(held.state, 'd1', city, { darwin: true }))
    expect(me(devoted).stats.culture).toBe(0)
    expect(me(devoted).stats.trade).toBe(3 + culture)
    expect(devoted.log.at(-1)?.publicLog).toContain(`turned its ${culture} culture into ${culture} trade with Charles Darwin`)
    expect(cityActionsOf(devoted, me(devoted))[0]?.devoteToTheArts.darwin).toBe('used')

    // The next city's devotion is plain culture, and Darwin cannot be used again
    const other = otherCityId(devoted)
    expect(JSON.stringify(unwrapErr(devote(devoted, 'd2', other, { darwin: true })))).toContain('only once each turn')
    const plain = unwrap(devote(devoted, 'd2', other))
    expect(me(plain).stats.culture).toBe(estimate(devoted, other))
  })

  it('is undone with the devotion: culture and trade are back and Darwin is free again', () => {
    const held = holding(withStats(scene(), { trade: 3 }), 'Charles Darwin')
    const city = capitalId(held.state)
    const devoted = unwrap(devote(held.state, 'd1', city, { darwin: true }))
    const undone = undoByVote(devoted, 'd1')
    expect(me(undone).stats.trade).toBe(3)
    expect(me(undone).stats.culture).toBe(0)
    expect(cityActionsOf(undone, me(undone))[0]?.devoteToTheArts.darwin).toBe('ready')
  })

  it('stops at the end of the trade track', () => {
    const held = holding(scene(), 'Charles Darwin')
    const ceiling = tradeCeilingOf(me(held.state).civilization?.name)
    const full = withStats(held.state, { trade: ceiling - 1 })
    const devoted = unwrap(devote(full, 'd1', capitalId(full), { darwin: true, culture: 5 }))
    expect(me(devoted).stats.trade).toBe(ceiling)
    expect(devoted.log.at(-1)?.publicLog).toContain('turned its 5 culture into 1 trade')
    expect(undoByVote(devoted, 'd1').players.find((p) => p.playerId === CASH1981)?.stats.trade).toBe(ceiling - 1)
  })

  it('is refused without the faceup card', () => {
    const card = withCardInHand(scene(), 'Charles Darwin')
    expect(cityActionsOf(card.state, me(card.state))[0]?.devoteToTheArts.darwin).toBeNull()
    expect(JSON.stringify(unwrapErr(devote(card.state, 'd1', capitalId(card.state), { darwin: true })))).toContain('faceup')
  })

  it('is paid with Kurosawa for the same devotion: the other holder still gets 1 culture', () => {
    const held = holding(scene(), 'Charles Darwin')
    const both = holding(held.state, 'Akira Kurosawa', KARANDRAS1)
    const devoted = unwrap(devote(both.state, 'd1', capitalId(both.state), { darwin: true }))
    expect(me(devoted, KARANDRAS1).stats.culture).toBe(1)
  })
})

describe('hidden information', () => {
  it("Lovelace's credit and Darwin's box are in the owner's own view only, and a facedown Darwin shows nothing", () => {
    const lovelace = withCardInHand(scene(), 'Ada Lovelace')
    const played = unwrap(play(lovelace.state, 'l1', lovelace.itemId))
    const held = holding(played, 'Charles Darwin')

    const own = toPlayerView(held.state, CASH1981).you?.cityActions?.[0]
    expect(own?.extraAction).toBe(true)
    expect(own?.devoteToTheArts.darwin).toBe('ready')

    for (const viewer of OTHERS) {
      const text = JSON.stringify(toPlayerView(held.state, viewer))
      expect(text).not.toContain('extraAction')
      expect(text).not.toContain('"darwin"')
    }

    // A facedown Darwin in the hand is not told to anyone, the owner included
    const facedown = withCardInHand(scene(), 'Charles Darwin')
    expect(toPlayerView(facedown.state, CASH1981).you?.cityActions?.[0]?.devoteToTheArts.darwin).toBeNull()
  })
})
