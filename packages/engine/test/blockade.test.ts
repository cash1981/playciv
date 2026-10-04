/**
 * The blockade rule (issue #241): an enemy army or scout standing in a square
 * switches off the building or Great Person token in it, for the owner of the
 * city it belongs to. Base rulebook p. 27 and FAQ 2.0 p. 2 and p. 5; the
 * human's own words are in `docs/agents/tasks/great-person-disable.md`.
 *
 * The fixture gives every player the same colour, so each test sets colours
 * first: Cash is Red, Karandras Blue and Itchi Green.
 */

import { describe, expect, it } from 'vitest'

import {
  movePiece,
  placePiece,
  redoLastBoardChange,
  removePiece,
  undoLastBoardChange,
} from '../src/actions/board.js'
import { initiateBattle } from '../src/actions/arena.js'
import { setCoinSource } from '../src/actions/player.js'
import {
  GREAT_PERSON_CARD_TYPES,
  blockadedGreatPersonTypes,
  blockadedPieceIds,
  greatPersonCoinsOf,
  isBlockaded,
  pieceColorOf,
  pieceOwnerColor,
} from '../src/blockade.js'
import { SQUARE_SIZE, boardAreas, findBoardAsset, mapTop } from '../src/board.js'
import type { BoardPiece } from '../src/board.js'
import { coinSourcesOf, totalCoins } from '../src/coins.js'
import { GREAT_PERSON_REFERENCE } from '../src/create-game.js'
import { combatBonusOf } from '../src/combat-bonus.js'
import { cultureHandSizeOf } from '../src/culture-hand.js'
import { describeError } from '../src/errors.js'
import type { CivItem, GreatPersonItem } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState } from '../src/state.js'

import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

/** Cash is Red, Karandras Blue, Itchi Green; Chul keeps the fixture's Red. */
function game(): GameState {
  const colors: Record<string, string> = { [CASH1981]: 'Red', [KARANDRAS1]: 'Blue', [ITCHI]: 'Green' }
  const state = firstCivGame()
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, color: colors[player.playerId] ?? player.color })),
  }
}

/** Places a piece so its centre is in map square (column, row), both from 0. */
function put(
  state: GameState,
  playerId: string,
  assetId: string,
  column: number,
  row: number,
  ownerId?: string,
): GameState {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) throw new Error(`no asset ${assetId}`)
  return unwrap(
    placePiece(state, {
      playerId,
      assetId,
      x: column * SQUARE_SIZE + (SQUARE_SIZE - asset.width) / 2,
      y: mapTop(state.board) + row * SQUARE_SIZE + (SQUARE_SIZE - asset.height) / 2,
      ...(ownerId === undefined ? {} : { ownerId }),
    }),
  )
}

function lastPiece(state: GameState): BoardPiece {
  const piece = state.board.pieces.at(-1)
  if (piece === undefined) throw new Error('the board is empty')
  return piece
}

/** The most recently placed piece's id, after `put`. */
function put2(
  state: GameState,
  playerId: string,
  assetId: string,
  column: number,
  row: number,
): readonly [GameState, BoardPiece] {
  const next = put(state, playerId, assetId, column, row)
  return [next, lastPiece(next)]
}

function player(state: GameState, playerId = CASH1981) {
  const found = findPlayer(state, playerId)
  if (found === undefined) throw new Error('no such player')
  return found
}

function withCiv(state: GameState, playerId: string, name: string | null): GameState {
  const civilization = name === null ? null : ({ kind: 'civ', name } as unknown as CivItem)
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? { ...p, civilization } : p)),
  }
}

function withColor(state: GameState, playerId: string, color: string | null): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? { ...p, color } : p)),
  }
}

function withPiecesAt(state: GameState, ids: readonly string[], x: number, y: number): GameState {
  return {
    ...state,
    board: {
      ...state.board,
      pieces: state.board.pieces.map((piece) => (ids.includes(piece.id) ? { ...piece, x, y } : piece)),
    },
  }
}

function generalCard(state: GameState, playerId: string, name = 'Test General'): GameState {
  const card: GreatPersonItem = {
    id: `card-${name}`,
    itemNumber: 777,
    kind: 'greatperson',
    sheetName: 'GREAT_PERSON',
    name,
    type: 'General',
    description: 'Hand-held secret.',
    used: false,
    hidden: true,
    ownerId: playerId,
  }
  return {
    ...state,
    players: state.players.map((p) => (p.playerId === playerId ? { ...p, items: [...p.items, card] } : p)),
  }
}

describe('pieceColorOf', () => {
  it('reads the colour off a city or figure asset id and nothing else', () => {
    const state = put(put(put(game(), CASH1981, 'cities/redcapitalwalled2', 1, 1), CASH1981, 'figures/bluescout', 2, 1), CASH1981, 'buildings/barracks', 3, 1)
    const [city, scout, barracks] = state.board.pieces
    expect(city && pieceColorOf(city)).toBe('red')
    expect(scout && pieceColorOf(scout)).toBe('blue')
    expect(barracks && pieceColorOf(barracks)).toBeUndefined()
  })
})

describe('isBlockaded', () => {
  it.each(['figures/bluearmy', 'figures/bluescout'])(
    'an enemy %s blockades a building and a Great Person in its square',
    (figure) => {
      let state = game()
      let building: BoardPiece
      let general: BoardPiece
      ;[state, building] = put2(state, CASH1981, 'buildings/barracks', 5, 5)
      ;[state, general] = put2(state, CASH1981, 'great people/general', 5, 5)
      expect(isBlockaded(state, building)).toBe(false)
      expect(isBlockaded(state, general)).toBe(false)

      state = put(state, KARANDRAS1, figure, 5, 5)
      expect(isBlockaded(state, building)).toBe(true)
      expect(isBlockaded(state, general)).toBe(true)
      expect(blockadedPieceIds(state)).toEqual([building.id, general.id])
    },
  )

  it("the owner's own figure does not blockade", () => {
    let state = game()
    let general: BoardPiece
    ;[state, general] = put2(state, CASH1981, 'great people/general', 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = put(state, CASH1981, 'figures/redscout', 5, 5)
    expect(isBlockaded(state, general)).toBe(false)
    expect(blockadedPieceIds(state)).toEqual([])
  })

  it('a figure in the next square does not blockade', () => {
    let state = game()
    let general: BoardPiece
    ;[state, general] = put2(state, CASH1981, 'great people/general', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 6, 5)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 4)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 6, 6)
    expect(isBlockaded(state, general)).toBe(false)
  })

  it('a piece in a player area or off the map is never blockaded', () => {
    let state = game()
    let general: BoardPiece
    let army: BoardPiece
    ;[state, general] = put2(state, CASH1981, 'great people/general', 5, 5)
    ;[state, army] = put2(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    expect(isBlockaded(state, general)).toBe(true)

    // Both on the same point in the player area, then the culture track: the
    // same coordinates would blockade on the map, so only the location can
    // explain the answer.
    const area = boardAreas(state.board, state.players).find((a) => a.playerId === CASH1981)
    if (area === undefined) throw new Error('no area for Cash')
    const inArea = withPiecesAt(state, [general.id, army.id], area.x + 40, area.y + 40)
    expect(isBlockaded(inArea, lastPieceOf(inArea, general.id))).toBe(false)
    expect(blockadedPieceIds(inArea)).toEqual([])

    const onTrack = withPiecesAt(state, [general.id, army.id], 200, 10)
    expect(isBlockaded(onTrack, lastPieceOf(onTrack, general.id))).toBe(false)
    expect(blockadedPieceIds(onTrack)).toEqual([])
  })

  it('a figure of the owner’s colour is no enemy, even when someone else placed the building', () => {
    let state = game()
    let building: BoardPiece
    // Itchi (Green) places a building in Red's city: it belongs to Red.
    ;[state, building] = put2(state, ITCHI, 'buildings/library', 5, 5)
    state = put(state, ITCHI, 'cities/redcity2', 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    expect(isBlockaded(state, building)).toBe(false)
    state = put(state, ITCHI, 'figures/greenscout', 5, 5)
    expect(isBlockaded(state, building)).toBe(true)
  })

  it('does not blockade a piece that belongs to nobody', () => {
    let state = game()
    let general: BoardPiece
    ;[state, general] = put2(state, CASH1981, 'great people/general', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    expect(isBlockaded(state, general)).toBe(true)
    // No city, and the player who placed it has no colour yet.
    const colourless = withColor(state, CASH1981, null)
    expect(pieceOwnerColor(colourless, general)).toBeUndefined()
    expect(isBlockaded(colourless, general)).toBe(false)
  })

  describe('the white army', () => {
    function russianGame(): GameState {
      return withCiv(game(), CASH1981, 'Russians')
    }

    it('counts as the Russian player’s colour', () => {
      let state = russianGame()
      let ownGeneral: BoardPiece
      let enemyGeneral: BoardPiece
      ;[state, ownGeneral] = put2(state, CASH1981, 'great people/general', 5, 5)
      ;[state, enemyGeneral] = put2(state, KARANDRAS1, 'great people/general', 7, 7)
      state = put(state, CASH1981, 'figures/whitearmy', 5, 5)
      expect(isBlockaded(state, ownGeneral)).toBe(false)
      // The same piece moved onto a Blue general blockades it.
      const white = state.board.pieces.find((p) => p.assetId === 'figures/whitearmy')
      if (white === undefined) throw new Error('no white army')
      state = unwrap(
        movePiece(state, {
          playerId: CASH1981,
          pieceId: white.id,
          x: 7 * SQUARE_SIZE + (SQUARE_SIZE - white.width) / 2,
          y: mapTop(state.board) + 7 * SQUARE_SIZE + (SQUARE_SIZE - white.height) / 2,
        }),
      )
      expect(isBlockaded(state, enemyGeneral)).toBe(true)
    })

    it('is an enemy of no one while the Russian player has no colour', () => {
      let state = withColor(russianGame(), CASH1981, null)
      let general: BoardPiece
      ;[state, general] = put2(state, KARANDRAS1, 'great people/general', 5, 5)
      state = put(state, CASH1981, 'figures/whitearmy', 5, 5)
      expect(isBlockaded(state, general)).toBe(false)
      // A coloured army of another player still blockades, so the answer is the white army's alone.
      expect(isBlockaded(put(state, ITCHI, 'figures/greenarmy', 5, 5), general)).toBe(true)
      // Cash has a colour again: now it is Red's army and blockades Blue's general.
      expect(isBlockaded(withColor(state, CASH1981, 'Red'), general)).toBe(true)
    })

    it('is an enemy of everyone when there is no Russian player', () => {
      let state = russianGame()
      let general: BoardPiece
      ;[state, general] = put2(state, CASH1981, 'great people/general', 5, 5)
      state = put(state, CASH1981, 'figures/whitearmy', 5, 5)
      expect(isBlockaded(state, general)).toBe(false)
      expect(isBlockaded(withCiv(state, CASH1981, null), general)).toBe(true)
    })
  })
})

describe('which pieces can be blockaded', () => {
  it('leaves cities alone, even with an enemy figure on them, and blockades buildings and wonders', () => {
    let state = game()
    state = put(state, CASH1981, 'cities/redcity2', 5, 5)
    state = put(state, CASH1981, 'wonders/statueofzeus', 8, 8, CASH1981)
    state = put(state, CASH1981, 'buildings/library', 11, 11)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 8)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 11, 11)
    const ids = (asset: string): string | undefined => state.board.pieces.find((p) => p.assetId === asset)?.id
    expect(blockadedPieceIds(state)).toEqual([ids('wonders/statueofzeus'), ids('buildings/library')])
  })
})

describe('wonders and the blockade', () => {
  const wonderIn = (state: GameState): BoardPiece => {
    const found = state.board.pieces.find((p) => p.category === 'wonder')
    if (found === undefined) throw new Error('no wonder')
    return found
  }

  it.each(['figures/bluearmy', 'figures/bluescout'])('an enemy %s blockades an owned wonder on the map', (figure) => {
    let state = put(game(), CASH1981, 'wonders/statueofzeus', 8, 8, CASH1981)
    expect(isBlockaded(state, wonderIn(state))).toBe(false)
    state = put(state, KARANDRAS1, figure, 8, 8)
    expect(isBlockaded(state, wonderIn(state))).toBe(true)
    expect(blockadedPieceIds(state)).toEqual([wonderIn(state).id])
  })

  it('the explicit owner decides, not the placer or a nearby city', () => {
    // Karandras places it next to a Blue city, but Cash (Red) owns it.
    let state = put(game(), KARANDRAS1, 'cities/bluecity2', 8, 8)
    state = put(state, KARANDRAS1, 'wonders/statueofzeus', 8, 8, CASH1981)
    expect(pieceOwnerColor(state, wonderIn(state))).toBe('red')
    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 8)
    expect(isBlockaded(state, wonderIn(state))).toBe(true)
    // Cash's own army alone would not.
    let own = put(put(game(), KARANDRAS1, 'wonders/statueofzeus', 8, 8, CASH1981), CASH1981, 'figures/redarmy', 8, 8)
    expect(isBlockaded(own, wonderIn(own))).toBe(false)
    own = put(own, KARANDRAS1, 'figures/bluescout', 8, 8)
    expect(isBlockaded(own, wonderIn(own))).toBe(true)
  })

  it('an own figure does not blockade it', () => {
    const state = put(put(game(), CASH1981, 'wonders/statueofzeus', 8, 8, CASH1981), CASH1981, 'figures/redscout', 8, 8)
    expect(isBlockaded(state, wonderIn(state))).toBe(false)
  })

  it('a wonder in the Wonders area or a player area is never blockaded', () => {
    let state = put(game(), CASH1981, 'wonders/statueofzeus', 8, 8, CASH1981)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 8)
    const wonder = wonderIn(state)
    const army = state.board.pieces.find((p) => p.assetId === 'figures/bluearmy')
    if (army === undefined) throw new Error('no army')
    const areas = boardAreas(state.board, state.players)
    for (const area of [areas.find((a) => a.playerId === CASH1981), areas.at(-1)]) {
      if (area === undefined) throw new Error('no area')
      const moved = withPiecesAt(state, [wonder.id, army.id], area.x + 40, area.y + 40)
      expect(isBlockaded(moved, wonderIn(moved))).toBe(false)
      expect(blockadedPieceIds(moved)).toEqual([])
    }
  })

  it('a wonder with nobody to own it is never blockaded', () => {
    let state = put(game(), CASH1981, 'wonders/statueofzeus', 8, 8)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 8)
    // Placed by Cash, so it falls back to Red; take away who placed it and Red's colour.
    const orphan = {
      ...state,
      board: {
        ...state.board,
        pieces: state.board.pieces.map((p) => (p.category === 'wonder' ? { ...p, placedBy: null } : p)),
      },
    }
    expect(pieceOwnerColor(orphan, wonderIn(orphan))).toBeUndefined()
    expect(isBlockaded(orphan, wonderIn(orphan))).toBe(false)
    // An owner who has no colour yet leaves it ownerless as well.
    const colourless = withColor(put(put(game(), CASH1981, 'wonders/statueofzeus', 8, 8, CASH1981), KARANDRAS1, 'figures/bluearmy', 8, 8), CASH1981, null)
    expect(isBlockaded(colourless, wonderIn(colourless))).toBe(false)
  })

  it('the Statue of Zeus (+6) stops counting while blockaded and returns when released', () => {
    let state = put(game(), CASH1981, 'wonders/statueofzeus', 8, 8, CASH1981)
    const bonus = (s: GameState): number => combatBonusOf(s, player(s))
    expect(bonus(state)).toBe(6)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 8)
    const army = lastPiece(state)
    expect(bonus(state)).toBe(0)
    expect(toPlayerView(state, KARANDRAS1).opponents.find((o) => o.playerId === CASH1981)?.stats.combat).toBe(0)
    state = unwrap(removePiece(state, { playerId: KARANDRAS1, pieceId: army.id }))
    expect(bonus(state)).toBe(6)
  })

  it('Egypt’s owned Statue of Zeus in its player area keeps +6 when an enemy figure is dropped there', () => {
    const state = game()
    const area = boardAreas(state.board, state.players).find((a) => a.playerId === CASH1981)
    if (area === undefined) throw new Error('no area for Cash')
    const placed = unwrap(
      placePiece(state, { playerId: CASH1981, assetId: 'wonders/statueofzeus', x: area.x + 20, y: area.y + 40, ownerId: CASH1981 }),
    )
    const wonder = lastPiece(placed)
    // The enemy army is moved onto exactly the same point, so only the area can explain the answer.
    const withArmy = unwrap(placePiece(placed, { playerId: KARANDRAS1, assetId: 'figures/bluearmy', x: 0, y: 0 }))
    const army = lastPiece(withArmy)
    const dropped = withPiecesAt(withArmy, [army.id], wonder.x, wonder.y)
    expect(combatBonusOf(dropped, player(dropped))).toBe(6)
    expect(blockadedPieceIds(dropped)).toEqual([])
  })

  it('the Panama Canal counter reads 0 while blockaded and its stored value comes back', () => {
    let state = put(game(), CASH1981, 'wonders/panamacanal', 8, 8, CASH1981)
    state = unwrap(
      setCoinSource(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, source: 'panamaCanal', value: 3 }),
    )
    const shown = (s: GameState): number => coinSourcesOf(s, player(s)).panamaCanal
    expect(shown(state)).toBe(3)

    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 8)
    const army = lastPiece(state)
    expect(shown(state)).toBe(0)
    expect(totalCoins(coinSourcesOf(state, player(state)))).toBe(0)
    expect(toPlayerView(state, CASH1981).you?.stats.coinSources.panamaCanal).toBe(0)
    // The stored value is untouched.
    expect(player(state).stats.coinSources.panamaCanal).toBe(3)

    state = unwrap(removePiece(state, { playerId: KARANDRAS1, pieceId: army.id }))
    expect(shown(state)).toBe(3)
    expect(toPlayerView(state, KARANDRAS1).opponents.find((o) => o.playerId === CASH1981)?.stats.coinSources.panamaCanal).toBe(3)
  })

  it('another player’s Panama Canal blockade does not touch my counter', () => {
    let state = put(game(), CASH1981, 'wonders/panamacanal', 8, 8, CASH1981)
    state = unwrap(
      setCoinSource(state, { editorPlayerId: KARANDRAS1, targetPlayerId: KARANDRAS1, source: 'panamaCanal', value: 2 }),
    )
    // Itchi's Green army is an enemy of Cash (Red) but not of Karandras (Blue), so
    // only the ownerId guard keeps Karandras's own counter out of it.
    state = put(state, ITCHI, 'figures/greenarmy', 8, 8)
    expect(coinSourcesOf(state, player(state, CASH1981)).panamaCanal).toBe(0)
    expect(coinSourcesOf(state, player(state, KARANDRAS1)).panamaCanal).toBe(2)
    const seen = toPlayerView(state, KARANDRAS1).opponents
    expect(seen.find((o) => o.playerId === CASH1981)?.stats.coinSources.panamaCanal).toBe(0)
    expect(toPlayerView(state, KARANDRAS1).you?.stats.coinSources.panamaCanal).toBe(2)
  })
})

describe('the Great Person token table', () => {
  it('has the same six card types as the Great Person cards', () => {
    expect(new Set(GREAT_PERSON_CARD_TYPES.map(([, type]) => type))).toEqual(
      new Set(GREAT_PERSON_REFERENCE.map((person) => person.type)),
    )
  })
})

describe('pieceOwnerColor', () => {
  it('is the colour of the one city around the piece, whoever placed it', () => {
    let state = game()
    let general: BoardPiece
    ;[state, general] = put2(state, KARANDRAS1, 'great people/general', 5, 5)
    // No city yet: the player who placed it.
    expect(pieceOwnerColor(state, general)).toBe('blue')

    // Any of the eight squares around, walled or not, capital or metropolis.
    for (const [asset, column, row] of [
      ['cities/redcity2', 4, 4],
      ['cities/redcapitalwalled2', 6, 5],
      ['cities/redmetropolis2', 5, 6],
    ] as const) {
      const withCity = put(state, ITCHI, asset, column, row)
      expect(pieceOwnerColor(withCity, general), asset).toBe('red')
    }
  })

  it('ignores a city two squares away', () => {
    let state = game()
    let general: BoardPiece
    ;[state, general] = put2(state, KARANDRAS1, 'great people/general', 5, 5)
    expect(pieceOwnerColor(put(state, ITCHI, 'cities/redcity2', 7, 5), general)).toBe('blue')
    expect(pieceOwnerColor(put(state, ITCHI, 'cities/redcity2', 5, 3), general)).toBe('blue')
  })

  it('falls back to who placed the piece when cities of two colours are around it', () => {
    let state = game()
    let general: BoardPiece
    ;[state, general] = put2(state, ITCHI, 'great people/general', 6, 5)
    state = put(state, CASH1981, 'cities/redcity2', 5, 5)
    state = put(state, KARANDRAS1, 'cities/bluecity2', 7, 5)
    expect(pieceOwnerColor(state, general)).toBe('green')

    // Two cities of the same colour are no conflict.
    const same = put(put(game(), KARANDRAS1, 'cities/redcity2', 5, 5), KARANDRAS1, 'cities/redcity2', 7, 5)
    const [withGeneral, token] = put2(same, ITCHI, 'great people/general', 6, 5)
    expect(pieceOwnerColor(withGeneral, token)).toBe('red')
  })

  it('does not take a city-state for an owner', () => {
    let state = game()
    let general: BoardPiece
    ;[state, general] = put2(state, KARANDRAS1, 'great people/general', 5, 5)
    state = put(state, CASH1981, 'city-states/cs1', 5, 5)
    expect(pieceOwnerColor(state, general)).toBe('blue')
    // With a Red city as well, the city-state neither adds a colour nor removes one.
    state = put(state, CASH1981, 'cities/redcity2', 4, 5)
    expect(pieceOwnerColor(state, general)).toBe('red')
  })
})

function lastPieceOf(state: GameState, id: string): BoardPiece {
  const piece = state.board.pieces.find((p) => p.id === id)
  if (piece === undefined) throw new Error(`no piece ${id}`)
  return piece
}

describe('combat bonus and the blockade', () => {
  const bonus = (state: GameState, playerId = CASH1981): number => combatBonusOf(state, player(state, playerId))

  it('a blockaded General (+4) and Barracks (+2) stop counting, and count again when the figure leaves', () => {
    let state = game()
    state = put(state, CASH1981, 'great people/general', 5, 5)
    state = put(state, CASH1981, 'buildings/barracks', 5, 5)
    expect(bonus(state)).toBe(6)

    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    const army = lastPiece(state)
    expect(bonus(state)).toBe(0)

    state = unwrap(removePiece(state, { playerId: KARANDRAS1, pieceId: army.id }))
    expect(bonus(state)).toBe(6)
  })

  it.each([
    ['buildings/shipyard', 2],
    ['buildings/militarydock', 4],
    ['buildings/academy', 4],
  ])('a blockaded %s stops adding %i', (asset, value) => {
    let state = put(game(), CASH1981, asset, 5, 5)
    expect(bonus(state)).toBe(value)
    state = put(state, KARANDRAS1, 'figures/bluescout', 5, 5)
    expect(bonus(state)).toBe(0)
  })

  it('only switches a piece off for the player the blockade is against', () => {
    // Itchi (Green) places a Barracks in Red's outskirts: it belongs to Red's city.
    let state = put(game(), CASH1981, 'cities/redcity2', 5, 5)
    state = put(state, ITCHI, 'buildings/barracks', 6, 5)
    expect(bonus(state, ITCHI)).toBe(2)

    // His own scout on it blockades Red's building, but his bonus is unchanged.
    state = put(state, ITCHI, 'figures/greenscout', 6, 5)
    expect(blockadedPieceIds(state)).toHaveLength(1)
    expect(bonus(state, ITCHI)).toBe(2)

    // A Red-owned barracks does drop when an enemy stands on it.
    state = put(state, CASH1981, 'buildings/barracks', 4, 5)
    expect(bonus(state)).toBe(2)
    state = put(state, ITCHI, 'figures/greenarmy', 4, 5)
    expect(bonus(state)).toBe(0)
  })

  it('a General placed by Red inside Blue’s outskirts, with a Blue army on it, costs Red 4', () => {
    // Blue's city owns the square, and no Red city is near: the board marker
    // belongs to Blue, but Red's own General still stops working for Red.
    let state = put(game(), KARANDRAS1, 'cities/bluecity2', 5, 5)
    state = put(state, CASH1981, 'great people/general', 6, 5)
    expect(bonus(state)).toBe(4)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 6, 5)
    expect(bonus(state)).toBe(0)
    expect(bonus(state, KARANDRAS1)).toBe(0)
  })

  it('a figure of the placing player’s own colour alone never switches the piece off', () => {
    let state = put(game(), CASH1981, 'buildings/academy', 5, 5)
    state = put(state, CASH1981, 'figures/redarmy', 5, 5)
    state = put(state, CASH1981, 'figures/redscout', 5, 5)
    expect(bonus(state)).toBe(4)
    // Not even inside someone else's outskirts.
    state = put(state, KARANDRAS1, 'cities/bluecity2', 4, 4)
    expect(bonus(state)).toBe(4)
  })

  it('with two Generals and one blockaded the bonus drops by 4', () => {
    let state = game()
    state = put(state, CASH1981, 'great people/general', 5, 5)
    state = put(state, CASH1981, 'great people/general', 8, 8)
    expect(bonus(state)).toBe(8)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 8, 8)
    expect(bonus(state)).toBe(4)
  })

  it('does not change what the enemy figure’s owner gets, and a free piece keeps counting', () => {
    let state = game()
    state = put(state, KARANDRAS1, 'buildings/barracks', 2, 2)
    state = put(state, CASH1981, 'great people/general', 5, 5)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    expect(bonus(state, KARANDRAS1)).toBe(2)
    expect(bonus(state)).toBe(0)
  })

  it('the battle summary and both projections use the same number', () => {
    let state = game()
    state = put(state, CASH1981, 'great people/general', 5, 5)
    state = put(state, CASH1981, 'buildings/academy', 8, 8)
    state = unwrap(initiateBattle(state, { initiatorId: CASH1981, opponentId: KARANDRAS1 }))
    const attacker = (s: GameState) =>
      toPlayerView(s, KARANDRAS1).battleSummary.find((side) => side.side === 'attacker')?.combatBonus
    expect(attacker(state)).toBe(8)

    const blockaded = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    expect(attacker(blockaded)).toBe(4)
    expect(toPlayerView(blockaded, CASH1981).you?.stats.combat).toBe(4)
    expect(
      toPlayerView(blockaded, KARANDRAS1).opponents.find((p) => p.playerId === CASH1981)?.stats.combat,
    ).toBe(4)
  })
})

describe('Great People coins', () => {
  const coins = (state: GameState, playerId = CASH1981): number => greatPersonCoinsOf(state, player(state, playerId))

  it.each(['great people/merchant', 'great people/builder', 'great people/humanitarian'])(
    'a %s in the outskirts of an own city gives 1, and nothing once it is gone',
    (token) => {
      let state = put(game(), CASH1981, 'cities/redcity2', 5, 5)
      expect(coins(state)).toBe(0)

      state = put(state, CASH1981, token, 6, 6)
      const piece = lastPiece(state)
      expect(coins(state)).toBe(1)
      expect(totalCoins(coinSourcesOf(state, player(state)))).toBe(1)

      expect(coins(unwrap(removePiece(state, { playerId: CASH1981, pieceId: piece.id })))).toBe(0)
    },
  )

  it('gives nothing in the player area, away from the cities or for the other tokens', () => {
    let state = put(game(), CASH1981, 'cities/redcity2', 5, 5)
    const area = boardAreas(state.board, state.players).find((a) => a.playerId === CASH1981)
    if (area === undefined) throw new Error('no area for Cash')
    state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'great people/merchant', x: area.x + 20, y: area.y + 40 }))
    expect(coins(state)).toBe(0)
    state = put(state, CASH1981, 'great people/merchant', 9, 9)
    expect(coins(state)).toBe(0)
    state = put(state, CASH1981, 'great people/general', 5, 6)
    state = put(state, CASH1981, 'great people/scientist', 4, 4)
    state = put(state, CASH1981, 'great people/artist', 6, 6)
    expect(coins(state)).toBe(0)
  })

  it('gives the coin to the owner of the city, not to whoever placed the token', () => {
    const state = put(put(game(), KARANDRAS1, 'cities/bluecity2', 5, 5), CASH1981, 'great people/merchant', 6, 6)
    expect(coins(state)).toBe(0)
    expect(coins(state, KARANDRAS1)).toBe(1)
  })

  it('gives nothing while it is blockaded, and again when the figure leaves', () => {
    let state = put(put(game(), CASH1981, 'cities/redcity2', 5, 5), CASH1981, 'great people/builder', 6, 6)
    expect(coins(state)).toBe(1)
    state = put(state, KARANDRAS1, 'figures/bluescout', 6, 6)
    const scout = lastPiece(state)
    expect(coins(state)).toBe(0)
    state = unwrap(removePiece(state, { playerId: KARANDRAS1, pieceId: scout.id }))
    expect(coins(state)).toBe(1)
  })

  it('two tokens give 2, and the projections show the derived number whatever is stored', () => {
    let state = put(game(), CASH1981, 'cities/redcity2', 5, 5)
    state = put(state, CASH1981, 'great people/merchant', 6, 6)
    state = put(state, CASH1981, 'great people/humanitarian', 4, 5)
    expect(coins(state)).toBe(2)

    const stored = {
      ...state,
      players: state.players.map((p) =>
        p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, coinSources: { ...p.stats.coinSources, greatPeople: 9 } } } : p,
      ),
    }
    expect(toPlayerView(stored, CASH1981).you?.stats.coinSources.greatPeople).toBe(2)
    expect(
      toPlayerView(stored, KARANDRAS1).opponents.find((p) => p.playerId === CASH1981)?.stats.coinSources.greatPeople,
    ).toBe(2)
  })

  it('Computers counts the derived coins towards the culture hand size', () => {
    let state = put(game(), CASH1981, 'cities/redcity2', 5, 5)
    for (const [column, row] of [[4, 4], [6, 4], [4, 6]] as const) {
      state = put(state, CASH1981, 'great people/merchant', column, row)
    }
    state = unwrap(
      setCoinSource(state, { editorPlayerId: CASH1981, targetPlayerId: CASH1981, source: 'sheet', value: 2 }),
    )
    // Three tokens and 2 coins on the sheet are 5; Computers adds one card for every five.
    const computers = {
      ...state,
      players: state.players.map((p) =>
        p.playerId === CASH1981
          ? {
              ...p,
              techsChosen: [
                ...p.techsChosen,
                { id: 't', itemNumber: 1, kind: 'tech', sheetName: 'TECH_4', name: 'Computers', hidden: false, used: false, ownerId: CASH1981 } as never,
              ],
            }
          : p,
      ),
    }
    const without = cultureHandSizeOf(
      { ...computers, board: { ...computers.board, pieces: computers.board.pieces.filter((p) => p.category !== 'greatperson') } },
      player(computers),
    )
    expect(cultureHandSizeOf(computers, player(computers))).toBe(without + 1)
  })

  it('a manual Great People value is refused, and says why', () => {
    const error = unwrapErr(
      setCoinSource(game(), { editorPlayerId: CASH1981, targetPlayerId: CASH1981, source: 'greatPeople', value: 1 }),
    )
    expect(error).toEqual({ kind: 'COIN_SOURCE_NOT_EDITABLE', source: 'greatPeople' })
    expect(describeError(error)).toContain('calculated from the board')
  })
})

describe('blockadedGreatPersonTypes', () => {
  const types = (state: GameState, playerId = CASH1981): readonly string[] =>
    blockadedGreatPersonTypes(state, player(state, playerId))

  it('lists a type whose only token is blockaded', () => {
    let state = put(game(), CASH1981, 'great people/general', 5, 5)
    expect(types(state)).toEqual([])
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    expect(types(state)).toEqual(['General'])
  })

  it('keeps a type out while one token of it is free', () => {
    let state = put(put(game(), CASH1981, 'great people/general', 5, 5), CASH1981, 'great people/general', 8, 8)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
    expect(types(state)).toEqual([])
    state = put(state, KARANDRAS1, 'figures/bluescout', 8, 8)
    expect(types(state)).toEqual(['General'])
  })

  it('does not list a type with no token on the map', () => {
    expect(types(game())).toEqual([])
    // A token in the player area is not on the map either.
    const area = boardAreas(game().board, game().players).find((a) => a.playerId === CASH1981)
    if (area === undefined) throw new Error('no area for Cash')
    const state = unwrap(
      placePiece(game(), { playerId: CASH1981, assetId: 'great people/scientist', x: area.x + 20, y: area.y + 40 }),
    )
    expect(types(state)).toEqual([])
  })

  it('maps each token to its card type and counts only the player’s own tokens', () => {
    let state = game()
    const tokens: readonly [string, string][] = [
      ['great people/artist', 'Artist or Thinker'],
      ['great people/builder', 'Builder or Inventor'],
      ['great people/general', 'General'],
      ['great people/humanitarian', 'Humanitarian'],
      ['great people/merchant', 'Merchant or Explorer'],
      ['great people/scientist', 'Scientist'],
    ]
    tokens.forEach(([asset], index) => {
      state = put(state, CASH1981, asset, 1 + index * 2, 1)
      state = put(state, KARANDRAS1, 'figures/bluearmy', 1 + index * 2, 1)
    })
    expect(types(state)).toEqual(tokens.map(([, type]) => type))
    // Karandras has no tokens of his own on the map, so nothing is disabled for him.
    expect(types(state, KARANDRAS1)).toEqual([])
  })

  it('does not take a token near an enemy city for the player’s own', () => {
    let state = put(put(game(), KARANDRAS1, 'cities/bluecity2', 5, 5), CASH1981, 'great people/general', 5, 6)
    // Red's army on a token that belongs to Blue's city blockades it for Blue.
    state = put(state, CASH1981, 'figures/redarmy', 5, 6)
    expect(types(state)).toEqual([])
    expect(types(state, KARANDRAS1)).toEqual(['General'])
  })
})

describe('undo and redo of a figure move', () => {
  it('change the blockade, the combat bonus and the coins back and forth', () => {
    let state = put(game(), CASH1981, 'cities/redcity2', 5, 5)
    state = put(state, CASH1981, 'great people/general', 6, 6)
    state = put(state, CASH1981, 'great people/merchant', 4, 4)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 1, 1)
    const army = lastPiece(state)

    const readings = (s: GameState) => ({
      combat: combatBonusOf(s, player(s)),
      coins: greatPersonCoinsOf(s, player(s)),
      types: blockadedGreatPersonTypes(s, player(s)),
      ids: blockadedPieceIds(s).length,
    })
    const free = { combat: 4, coins: 1, types: [], ids: 0 }
    expect(readings(state)).toEqual(free)

    const onGeneral = unwrap(
      movePiece(state, {
        playerId: KARANDRAS1,
        pieceId: army.id,
        x: 6 * SQUARE_SIZE + (SQUARE_SIZE - army.width) / 2,
        y: mapTop(state.board) + 6 * SQUARE_SIZE + (SQUARE_SIZE - army.height) / 2,
      }),
    )
    expect(readings(onGeneral)).toEqual({ combat: 0, coins: 1, types: ['General'], ids: 1 })

    const onMerchant = unwrap(
      movePiece(onGeneral, {
        playerId: KARANDRAS1,
        pieceId: army.id,
        x: 4 * SQUARE_SIZE + (SQUARE_SIZE - army.width) / 2,
        y: mapTop(state.board) + 4 * SQUARE_SIZE + (SQUARE_SIZE - army.height) / 2,
      }),
    )
    expect(readings(onMerchant)).toEqual({ combat: 4, coins: 0, types: ['Merchant or Explorer'], ids: 1 })

    const undone = unwrap(undoLastBoardChange(onMerchant, KARANDRAS1))
    expect(readings(undone)).toEqual({ combat: 0, coins: 1, types: ['General'], ids: 1 })
    const undoneAgain = unwrap(undoLastBoardChange(undone, KARANDRAS1))
    expect(readings(undoneAgain)).toEqual(free)
    const redone = unwrap(redoLastBoardChange(undoneAgain, KARANDRAS1))
    expect(readings(redone)).toEqual({ combat: 0, coins: 1, types: ['General'], ids: 1 })
  })
})

describe('the projections and hidden information', () => {
  function blockadedGeneralGame(): GameState {
    let state = put(game(), CASH1981, 'great people/general', 5, 5)
    state = put(state, CASH1981, 'cities/redcity2', 4, 4)
    return put(state, KARANDRAS1, 'figures/bluearmy', 5, 5)
  }

  it('lists the blockaded pieces to everyone and the blockaded card types to the viewer only', () => {
    const state = blockadedGeneralGame()
    const general = state.board.pieces.find((p) => p.assetId === 'great people/general')
    if (general === undefined) throw new Error('no general')

    const own = toPlayerView(state, CASH1981)
    const other = toPlayerView(state, KARANDRAS1)
    expect(own.blockadedPieceIds).toEqual([general.id])
    expect(other.blockadedPieceIds).toEqual([general.id])
    expect(own.you?.blockadedGreatPersonTypes).toEqual(['General'])
    expect(other.you?.blockadedGreatPersonTypes).toEqual([])
    // Opponents are counts and public numbers: no per-type list on them.
    expect(own.opponents.some((o) => 'blockadedGreatPersonTypes' in o)).toBe(false)
    expect(other.opponents.some((o) => 'blockadedGreatPersonTypes' in o)).toBe(false)
    expect(JSON.stringify(other.opponents)).not.toContain('blockadedGreatPersonTypes')
  })

  it('does not depend on the hand: the same board gives the same answer with or without the card', () => {
    const board = blockadedGeneralGame()
    const holding = generalCard(board, CASH1981, 'SECRET-HELD-GENERAL')
    // The same board, the same players, a different hand.
    const empty = board

    const heldView = toPlayerView(holding, CASH1981)
    const emptyView = toPlayerView(empty, CASH1981)
    expect(heldView.you?.blockadedGreatPersonTypes).toEqual(emptyView.you?.blockadedGreatPersonTypes)
    expect(heldView.blockadedPieceIds).toEqual(emptyView.blockadedPieceIds)

    // What the opponent sees of the player who holds the card and of the one who does not.
    const seenHolding = toPlayerView(holding, KARANDRAS1)
    const seenEmpty = toPlayerView(empty, KARANDRAS1)
    expect(seenHolding.blockadedPieceIds).toEqual(seenEmpty.blockadedPieceIds)
    expect(seenHolding.you?.blockadedGreatPersonTypes).toEqual(seenEmpty.you?.blockadedGreatPersonTypes)
    const stats = (view: typeof seenHolding) => view.opponents.find((o) => o.playerId === CASH1981)?.stats
    expect(stats(seenHolding)).toEqual(stats(seenEmpty))

    // The card itself never reaches the opponent, and no field names a type.
    const json = JSON.stringify(seenHolding)
    expect(json).not.toContain('SECRET-HELD-GENERAL')
    expect(json).not.toContain('Hand-held secret.')
    const opponent = seenHolding.opponents.find((o) => o.playerId === CASH1981)
    expect(Object.keys(opponent ?? {})).not.toContain('blockadedGreatPersonTypes')
    expect(JSON.stringify(opponent)).not.toContain('"General"')
  })
})
