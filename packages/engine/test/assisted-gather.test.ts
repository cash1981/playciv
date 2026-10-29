/**
 * Devote to the Arts and Harvest a resource (issue #264 follow-up): what the map gives a
 * city, the two assisted actions, and the undo vote that takes each back.
 *
 * The scene is the one of `assisted-city-actions.test.ts`: Cash is Red, the America tile
 * lies in the first map slot and a red city stands on B2. America holds iron on A1, silk
 * on B2 (the city centre, so not in the outskirts) and incense on C3. The tile01 scenes
 * have wheat on C2 and a natural wonder's culture icon on B4.
 */

import { describe, expect, it } from 'vitest'

import tileIcons from '../data/tile-icons.json' with { type: 'json' }
import tileTerrain from '../data/tile-terrain.json' with { type: 'json' }

import { movePiece, placePiece, undoLastBoardChange } from '../src/actions/board.js'
import { chooseSocialPolicy, revealSocialPolicy } from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { initiateUndo, vote } from '../src/actions/undo.js'
import { PHASE_REASON, findResourceToken, performAssistedAction, spendResource } from '../src/assisted.js'
import type { AssistedPayload } from '../src/assisted.js'
import {
  SQUARE_SIZE,
  TILE_SQUARES,
  areaAt,
  createBoard,
  findBoardAsset,
  mapTop,
  playerAreas,
  slotOrigin,
} from '../src/board.js'
import type { Board, BoardPiece, Rotation } from '../src/board.js'
import { cityActionsOf } from '../src/city-actions.js'
import { describeError } from '../src/errors.js'
import { unwrap, unwrapErr } from '../src/result.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { GameState, Playerhand } from '../src/state.js'
import { RESOURCE_KINDS, squareIconsAt, squareIconsOfCell } from '../src/tile-icons.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const AT = '2026-10-10T10:00:00.000Z'
const OTHERS = [KARANDRAS1, ITCHI, CHUL]

function baseGame(): GameState {
  const colors: Record<string, string> = {
    [CASH1981]: 'Red',
    [KARANDRAS1]: 'Blue',
    [ITCHI]: 'Green',
    [CHUL]: 'Yellow',
  }
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

/** Places a piece so its centre is in map square (column, row), both from 0. */
function put(state: GameState, playerId: string, assetId: string, column: number, row: number): GameState {
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

function withTile(state: GameState, assetId: string): GameState {
  const slot = state.board.slots[0]
  if (slot === undefined) throw new Error('board has no slots')
  const [x, y] = slotOrigin(state.board, slot)
  return unwrap(placePiece(state, { playerId: CASH1981, assetId, x, y }))
}

const openTurn = (state: GameState): GameState =>
  unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))

/** America and a red city on B2, City Management open. */
const america = (): GameState => openTurn(put(withTile(baseGame(), 'tiles/america'), CASH1981, 'cities/redcity2', 1, 1))
/** tile01 and a red city on B1, City Management open: wheat on C2 in the outskirts, the culture icon on B4 outside them. */
const tile01 = (): GameState => openTurn(put(withTile(baseGame(), 'tiles/tile01'), CASH1981, 'cities/redcity2', 1, 0))
/** tile01 and a red city on B3: the culture icon on B4 and the wheat on C2 are both in the outskirts. */
const tile01Close = (): GameState => openTurn(put(withTile(baseGame(), 'tiles/tile01'), CASH1981, 'cities/redcity2', 1, 2))

const me = (state: GameState): Playerhand => {
  const found = findPlayer(state, CASH1981)
  if (found === undefined) throw new Error('no Cash')
  return found
}

const cityOf = (state: GameState): BoardPiece => {
  const city = state.board.pieces.find((piece) => piece.category === 'city')
  if (city === undefined) throw new Error('no city')
  return city
}

const firstCityId = (state: GameState): string => state.board.pieces.find((piece) => piece.category === 'city')?.id ?? 'none'

const optionOf = (state: GameState) => {
  const found = cityActionsOf(state, me(state))[0]
  if (found === undefined) throw new Error('no city action options')
  return found
}

const lastLine = (state: GameState): string => state.log.at(-1)?.publicLog ?? ''

const devote = (state: GameState, payload: Partial<AssistedPayload> = {}, requestId = 'devote-1', again = false) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'devoteToTheArts',
    requestId,
    at: AT,
    ...(again ? { confirmedRepeat: true } : {}),
    payload: { cityPieceId: firstCityId(state), ...payload } as AssistedPayload,
  })

const harvest = (state: GameState, resource: string, extra: Record<string, unknown> = {}, requestId = 'harvest-1', again = false) =>
  performAssistedAction(state, {
    playerId: CASH1981,
    action: 'harvest',
    requestId,
    at: AT,
    ...(again ? { confirmedRepeat: true } : {}),
    payload: { cityPieceId: firstCityId(state), resource, ...extra } as AssistedPayload,
  })

const refusal = (result: ReturnType<typeof devote>): string => describeError(unwrapErr(result))

const piecesOf = (state: GameState, assetId: string): readonly BoardPiece[] =>
  state.board.pieces.filter((piece) => piece.assetId === assetId)

function undoByVote(state: GameState, requestId: string): GameState {
  const entry = state.log.find((candidate) => candidate.assistedActionId === requestId)
  if (entry === undefined) throw new Error('no log line for the action')
  let next = unwrap(initiateUndo(state, { logId: entry.id, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
  return next
}

// ---------------------------------------------------------------------------
// The icon data
// ---------------------------------------------------------------------------

describe('the tile icon data', () => {
  const tiles = (tileIcons as unknown as { tiles: Record<string, { row: number; column: number; resource?: string; culture?: number }[]> })
    .tiles

  it('covers exactly the tiles that have terrain', () => {
    expect(Object.keys(tiles).sort()).toEqual(Object.keys(tileTerrain.tiles).sort())
  })

  it('names squares inside the tile, known resources and at most one icon of each kind per square', () => {
    for (const [tile, squares] of Object.entries(tiles)) {
      const seen = new Set<string>()
      const resourcesHere = new Set<string>()
      for (const square of squares) {
        expect(square.row, tile).toBeGreaterThanOrEqual(0)
        expect(square.row, tile).toBeLessThan(TILE_SQUARES)
        expect(square.column, tile).toBeGreaterThanOrEqual(0)
        expect(square.column, tile).toBeLessThan(TILE_SQUARES)
        if (square.resource !== undefined) expect(RESOURCE_KINDS as readonly string[], tile).toContain(square.resource)
        const key = `${square.row},${square.column},${square.resource ?? 'culture'}`
        expect(seen.has(key), `${tile} lists ${key} twice`).toBe(false)
        seen.add(key)
        // At most one resource on a square: the lookup takes the first
        if (square.resource !== undefined) {
          const resourceKey = `${square.row},${square.column}`
          expect(resourcesHere.has(resourceKey), `${tile} has two resources on ${resourceKey}`).toBe(false)
          resourcesHere.add(resourceKey)
        }
      }
    }
  })

  const tileAt = (assetId: string, rotation: Rotation): { board: Board; x: number; y: number } => {
    const board = createBoard()
    const slot = board.slots[0]
    if (slot === undefined) throw new Error('no slot')
    const [x, y] = slotOrigin(board, slot)
    const piece: BoardPiece = {
      id: 't',
      assetId,
      path: `${assetId}.png`,
      label: assetId,
      category: 'civtile',
      x,
      y,
      width: TILE_SQUARES * SQUARE_SIZE,
      height: TILE_SQUARES * SQUARE_SIZE,
      rotation,
      placedBy: null,
    }
    return { board: { ...board, pieces: [piece] }, x, y }
  }

  it('finds the printed iron of America on the square it moves to when the tile is turned', () => {
    // Printed A1 (row 0, column 0) goes to the top right, bottom right and bottom left
    const expected: Record<Rotation, readonly [row: number, column: number]> = {
      0: [0, 0],
      90: [0, 3],
      180: [3, 3],
      270: [3, 0],
    }
    for (const rotation of [0, 90, 180, 270] as const) {
      const { board, x, y } = tileAt('tiles/america', rotation)
      const [row, column] = expected[rotation]
      const at = squareIconsAt(board, x + column * SQUARE_SIZE + SQUARE_SIZE / 2, y + row * SQUARE_SIZE + SQUARE_SIZE / 2)
      expect(at?.resource, `rotation ${rotation}`).toBe('iron')
      // The cell lookup the engine uses finds the same square
      const cellRow = Math.round((y - mapTop(board)) / SQUARE_SIZE) + row
      const cellColumn = Math.round(x / SQUARE_SIZE) + column
      expect(squareIconsOfCell(board, { column: cellColumn, row: cellRow })?.resource).toBe('iron')
    }
  })

  it('has no icons for a point off every tile', () => {
    expect(squareIconsAt(createBoard(), 5, 5)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// What the city offers
// ---------------------------------------------------------------------------

describe('what a city offers: devote to the arts', () => {
  it('a bare city gives 1 culture and says what is not counted', () => {
    const option = optionOf(america()).devoteToTheArts
    expect(option.status).toBe('ready')
    expect(option.culture).toBe(1)
    expect(option.parts).toEqual([{ label: 'The city itself', amount: 1 }])
    expect(option.scouts).toEqual([])
    expect(option.notes.join(' ')).toContain('Culture from other civilization, government, tech and card effects is not counted.')
  })

  it('outside City Management it says wrong-phase with the phase reason', () => {
    const closed = put(withTile(baseGame(), 'tiles/america'), CASH1981, 'cities/redcity2', 1, 1)
    const option = optionOf(closed).devoteToTheArts
    expect(option.status).toBe('wrong-phase')
    expect(option.reason).toBe(PHASE_REASON)
  })

  it('adds the culture of the buildings in the outskirts, and nothing for a building outside them', () => {
    let state = america()
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    state = put(state, CASH1981, 'buildings/library', 2, 1)
    state = put(state, CASH1981, 'buildings/cathedral', 3, 3)
    const option = optionOf(state).devoteToTheArts
    expect(option.culture).toBe(1 + 2 + 1)
    expect(option.parts.map((part) => part.label)).toEqual(['The city itself', 'Temple at A3', 'Library at C2'])
  })

  it('counts the culture icon of a natural wonder in the outskirts', () => {
    const option = optionOf(tile01Close()).devoteToTheArts
    expect(option.culture).toBe(2)
    expect(option.parts).toContainEqual({ label: 'Culture icon at B4', amount: 1 })
  })

  it('a building replaces the culture icon of the square it stands on', () => {
    const state = put(tile01Close(), CASH1981, 'buildings/granary', 1, 3)
    const option = optionOf(state).devoteToTheArts
    expect(option.culture).toBe(1)
    expect(option.parts.map((part) => part.label)).toEqual(['The city itself'])
  })

  it('a wonder gives the culture of its era: 1 ancient, 2 medieval, 3 modern', () => {
    for (const [assetId, name, culture] of [
      ['wonders/stonehenge', 'Stonehenge', 1],
      ['wonders/louvre', 'The Louvre', 2],
      ['wonders/bigben', 'Big Ben', 3],
    ] as const) {
      const option = optionOf(put(america(), CASH1981, assetId, 0, 0)).devoteToTheArts
      expect(option.culture, assetId).toBe(1 + culture)
      expect(option.parts, assetId).toContainEqual({ label: `${name} at A1`, amount: culture })
    }
  })

  it('an obsolete wonder keeps its culture: it is a marker on the board, whatever its card shows', () => {
    // Nothing on the board changes when a wonder is obsoleted (base rules p. 27), so the sum does not either
    const state = put(america(), CASH1981, 'wonders/colossus', 0, 0)
    expect(optionOf(state).devoteToTheArts.culture).toBe(2)
  })

  it('a Great Person gives the culture on its marker: Artist 2, Merchant 2, Humanitarian 1, the rest none', () => {
    for (const [assetId, culture] of [
      ['great people/artist', 2],
      ['great people/merchant', 2],
      ['great people/humanitarian', 1],
      ['great people/builder', 0],
      ['great people/general', 0],
      ['great people/scientist', 0],
    ] as const) {
      const option = optionOf(put(america(), CASH1981, assetId, 0, 0)).devoteToTheArts
      expect(option.culture, assetId).toBe(1 + culture)
      const label = `${findBoardAsset(assetId)?.label ?? ''} (Great Person) at A1`
      if (culture > 0) expect(option.parts, assetId).toContainEqual({ label, amount: culture })
      else expect(option.parts.map((part) => part.label), assetId).toEqual(['The city itself'])
    }
  })

  it('a wonder or a Great Person replaces the culture icon of the square it stands on', () => {
    const state = put(tile01Close(), CASH1981, 'great people/artist', 1, 3)
    const option = optionOf(state).devoteToTheArts
    expect(option.culture).toBe(1 + 2)
    expect(option.parts.map((part) => part.label)).toEqual(['The city itself', 'Artist (Great Person) at B4'])
    expect(option.notes.join(' ')).not.toContain('Great Person')
  })

  it('the culture of buildings, wonders and Great People adds up', () => {
    let state = america()
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    state = put(state, CASH1981, 'wonders/louvre', 2, 1)
    state = put(state, CASH1981, 'great people/merchant', 1, 0)
    const option = optionOf(state).devoteToTheArts
    expect(option.culture).toBe(1 + 2 + 2 + 2)
    expect(option.parts.map((part) => part.label).sort()).toEqual(
      ['Merchant (Great Person) at B1', 'The Louvre at C2', 'The city itself', 'Temple at A3'].sort(),
    )
  })

  it('a wonder or a Great Person outside the outskirts adds nothing', () => {
    let state = america()
    state = put(state, CASH1981, 'wonders/bigben', 3, 3)
    state = put(state, CASH1981, 'great people/artist', 3, 0)
    expect(optionOf(state).devoteToTheArts.culture).toBe(1)
  })

  it('an enemy figure on a wonder or a Great Person blockades its culture too', () => {
    let state = america()
    state = put(state, CASH1981, 'wonders/bigben', 0, 0)
    state = put(state, CASH1981, 'great people/artist', 2, 2)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 0, 0)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 2, 2)
    const option = optionOf(state).devoteToTheArts
    expect(option.culture).toBe(1)
    expect(option.notes.join(' ')).toContain('A1 and C3 are blockaded and give nothing.')
  })

  it('an enemy figure in a square blockades it, and the note says so', () => {
    let state = america()
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 0, 2)
    const option = optionOf(state).devoteToTheArts
    expect(option.culture).toBe(1)
    expect(option.notes.join(' ')).toContain('A3 is blockaded and gives nothing.')
  })

  it('a metropolis gives 2 as its base', () => {
    const asset = findBoardAsset('cities/redmetropolis2')
    if (asset === undefined) throw new Error('no metropolis asset')
    // Horizontal, rotation 0: its image centre on the boundary between B2 and C2... A2 and B2 here
    const state = openTurn(
      unwrap(
        placePiece(withTile(baseGame(), 'tiles/america'), {
          playerId: CASH1981,
          assetId: 'cities/redmetropolis2',
          x: 1 * SQUARE_SIZE - asset.width / 2,
          y: mapTop(createBoard()) + 1.5 * SQUARE_SIZE - asset.height / 2,
        }),
      ),
    )
    const option = optionOf(state).devoteToTheArts
    expect(option.parts[0]).toEqual({ label: 'The metropolis itself', amount: 2 })
  })

  it('lists a scout of the player on a culture square outside the outskirts, and none inside them', () => {
    let state = tile01()
    state = put(state, CASH1981, 'figures/redscout', 1, 3)
    state = put(state, CASH1981, 'figures/redscout', 2, 1)
    const option = optionOf(state).devoteToTheArts
    expect(option.scouts).toHaveLength(1)
    expect(option.scouts[0]).toMatchObject({ square: 'B4', culture: 1, resource: null })
    expect(option.notes.join(' ')).toContain('A scout gathers from the turn after it was placed')
    // The scout's culture is not in the sum: the player says whether to send it
    expect(option.culture).toBe(1)
  })

  it('reads the square a scout stands on now, so a scout moved in City Management gathers there (rules 198, 334)', () => {
    let state = tile01()
    state = put(state, CASH1981, 'figures/redscout', 2, 1)
    expect(optionOf(state).devoteToTheArts.scouts).toHaveLength(0)

    // Galileo, Steam Power, Hannibal and the culture cards all move the figure on the board: the
    // gathering follows it, and the game keeps no once-per-turn record of an icon (rules 422 to 424).
    const scout = state.board.pieces.find((piece) => piece.assetId === 'figures/redscout')
    if (scout === undefined) throw new Error('missing scout')
    const moved = unwrap(
      movePiece(state, {
        playerId: CASH1981,
        pieceId: scout.id,
        x: scout.x - SQUARE_SIZE,
        y: scout.y + 2 * SQUARE_SIZE,
      }),
    )
    expect(optionOf(moved).devoteToTheArts.scouts).toEqual([
      expect.objectContaining({ square: 'B4', culture: 1 }),
    ])
  })

  it('an enemy scout is not offered', () => {
    const state = put(tile01(), KARANDRAS1, 'figures/bluescout', 1, 3)
    expect(optionOf(state).devoteToTheArts.scouts).toEqual([])
  })

  it('names what a scout stands on: a wonder, a Great Person, a building in another city or a culture icon', () => {
    // The city on B2 has its outskirts on A1 to C3; D1 to D4 are outside them. A player has two scouts.
    const scoutsOn = (assetIds: readonly string[]) => {
      let state = america()
      assetIds.forEach((assetId, row) => {
        state = put(state, CASH1981, assetId, 3, row)
        state = put(state, CASH1981, 'figures/redscout', 3, row)
      })
      const option = optionOf(state).devoteToTheArts
      // None of it is in the city's own sum: the player says which scout goes to which city
      expect(option.culture).toBe(1)
      return option.scouts.map((scout) => [scout.square, scout.source, scout.culture])
    }
    expect(scoutsOn(['wonders/louvre', 'great people/artist'])).toEqual([
      ['D1', 'The Louvre', 2],
      ['D2', 'Artist (Great Person)', 2],
    ])
    expect(scoutsOn(['buildings/temple', 'buildings/granary'])).toEqual([['D1', 'Temple', 2]])
    // The Builder has no culture, so its scout is not offered
    expect(scoutsOn(['great people/builder'])).toEqual([])

    const icon = put(tile01(), CASH1981, 'figures/redscout', 1, 3)
    expect(optionOf(icon).devoteToTheArts.scouts[0]).toMatchObject({ square: 'B4', source: 'Culture icon', culture: 1 })
  })

  it('a scout on a wonder gathers its culture even when an enemy stands there too', () => {
    // A scout's square is read with no blockade, as it is for the culture icon of a natural wonder
    let state = america()
    state = put(state, CASH1981, 'wonders/bigben', 3, 0)
    state = put(state, CASH1981, 'figures/redscout', 3, 0)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 3, 0)
    expect(optionOf(state).devoteToTheArts.scouts[0]).toMatchObject({ square: 'D1', culture: 3 })
  })
})

describe('Urban Development', () => {
  const withPolicy = (state: GameState, reveal: boolean): GameState => {
    const chosen = unwrap(chooseSocialPolicy(state, { playerId: CASH1981, name: 'Urban Development' }))
    return reveal ? unwrap(revealSocialPolicy(chosen, { playerId: CASH1981, name: 'Urban Development' })) : chosen
  }
  const urban = (state: GameState) => optionOf(state).devoteToTheArts

  /** The city on B2 with a Temple on A3 and a Library on C2: 1 + 2 + 1 culture before the policy. */
  const twoBuildings = (): GameState => {
    let state = america()
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    return put(state, CASH1981, 'buildings/library', 2, 1)
  }

  it('adds 2 culture to a city with two different buildings in its outskirts', () => {
    const state = withPolicy(twoBuildings(), true)
    expect(urban(state).culture).toBe(1 + 2 + 1 + 2)
    expect(urban(state).parts).toContainEqual({ label: 'Urban Development (Temple and Library)', amount: 2 })
    expect(urban(state).notes.join(' ')).not.toContain('Urban Development')
  })

  it('does not count a policy that is chosen but not revealed', () => {
    const state = withPolicy(twoBuildings(), false)
    expect(me(state).socialPolicies[0]?.hidden).toBe(true)
    expect(urban(state).culture).toBe(1 + 2 + 1)
    expect(urban(state).notes.join(' ')).not.toContain('Urban Development')
  })

  it('counts a wonder as one of the buildings, but not a Great Person', () => {
    let state = withPolicy(america(), true)
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    state = put(state, CASH1981, 'great people/artist', 2, 1)
    expect(urban(state).culture).toBe(1 + 2 + 2)
    expect(urban(state).notes.join(' ')).toContain('Urban Development needs 2 different buildings or wonders in the outskirts, and this city has one.')

    state = put(state, CASH1981, 'wonders/stonehenge', 1, 0)
    expect(urban(state).culture).toBe(1 + 2 + 2 + 1 + 2)
    expect(urban(state).parts).toContainEqual({ label: 'Urban Development (Temple and Stonehenge)', amount: 2 })
  })

  it('does not count two of the same building twice, and says how many it found', () => {
    let state = withPolicy(america(), true)
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    state = put(state, CASH1981, 'buildings/temple', 1, 2)
    expect(urban(state).culture).toBe(1 + 2 + 2)
    expect(urban(state).notes.join(' ')).toContain('and this city has one.')
    expect(urban(withPolicy(america(), true)).notes.join(' ')).toContain('and this city has none.')
  })

  it('needs the buildings in the outskirts of the city itself', () => {
    let state = withPolicy(america(), true)
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    state = put(state, CASH1981, 'buildings/library', 3, 3)
    expect(urban(state).culture).toBe(1 + 2)
  })

  it('does not count a blockaded square, as the city cannot use it', () => {
    const state = put(withPolicy(twoBuildings(), true), KARANDRAS1, 'figures/bluearmy', 2, 1)
    expect(urban(state).culture).toBe(1 + 2)
    expect(urban(state).notes.join(' ')).toContain('has one')
  })

  it('does nothing without the policy, and says nothing about it', () => {
    expect(urban(twoBuildings()).culture).toBe(1 + 2 + 1)
    expect(urban(twoBuildings()).parts.map((part) => part.label).join(' ')).not.toContain('Urban Development')
    expect(urban(twoBuildings()).notes.join(' ')).not.toContain('Urban Development')
  })

  it('does nothing under Anarchy, when social policies have no effect', () => {
    const state = withPolicy(twoBuildings(), true)
    const anarchy: GameState = {
      ...state,
      players: state.players.map((p) => (p.playerId === CASH1981 ? { ...p, government: 'Anarchy' } : p)),
    }
    expect(urban(anarchy).culture).toBe(1 + 2 + 1)
  })

  it('does not count the square of a scout among the buildings', () => {
    let state = withPolicy(america(), true)
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    state = put(state, CASH1981, 'wonders/louvre', 3, 0)
    state = put(state, CASH1981, 'figures/redscout', 3, 0)
    expect(urban(state).culture).toBe(1 + 2)
  })

  it('does not count the flipside of the card, Expansionism', () => {
    const state = unwrap(chooseSocialPolicy(twoBuildings(), { playerId: CASH1981, name: 'Expansionsim' }))
    expect(urban(state).culture).toBe(1 + 2 + 1)
  })

  it('is added to what Devote to the Arts takes, and a number typed by the player still wins', () => {
    const state = withPolicy(twoBuildings(), true)
    const before = me(state).stats.culture
    const next = unwrap(devote(state))
    expect(me(next).stats.culture).toBe(before + 6)
    expect(lastLine(next)).toBe('cash1981 devoted City B2 to the arts and gained 6 culture')

    const typed = unwrap(devote(state, { culture: 3 }))
    expect(me(typed).stats.culture).toBe(before + 3)
    expect(lastLine(typed)).toBe('cash1981 devoted City B2 to the arts and gained 3 culture (set by the player; the estimate was 6)')
  })

  it('is added to the squares of the scouts the player sends', () => {
    let state = withPolicy(twoBuildings(), true)
    state = put(state, CASH1981, 'wonders/louvre', 3, 0)
    state = put(state, CASH1981, 'figures/redscout', 3, 0)
    const scout = optionOf(state).devoteToTheArts.scouts[0]
    if (scout === undefined) throw new Error('no scout offered')
    const next = unwrap(devote(state, { scoutPieceIds: [scout.pieceId] }))
    // The city 1, Temple 2, Library 1, Urban Development 2, and the Louvre under the scout 2
    expect(me(next).stats.culture).toBe(me(state).stats.culture + 8)
  })
})

describe('the Indians', () => {
  const indians = (state: GameState): GameState => ({
    ...state,
    players: state.players.map((p) =>
      p.playerId === CASH1981 ? { ...p, civilization: { ...(p.civilization as object), name: 'Indians' } as never } : p,
    ),
  })

  it('get 1 culture for each outskirts square with a resource', () => {
    // America: iron on A1 and incense on C3 are in the outskirts; silk is under the city
    const option = optionOf(indians(america())).devoteToTheArts
    expect(option.culture).toBe(1 + 2)
    expect(option.parts).toContainEqual({ label: 'Indians: resources at A1 and C3', amount: 2 })
    expect(optionOf(america()).devoteToTheArts.culture).toBe(1)
  })

  it('get nothing for a covered or blockaded resource', () => {
    let state = put(indians(america()), CASH1981, 'buildings/granary', 0, 0)
    state = put(state, KARANDRAS1, 'figures/bluearmy', 2, 2)
    expect(optionOf(state).devoteToTheArts.culture).toBe(1)
  })
})

describe('what a city offers: harvest', () => {
  it('lists the resources in the outskirts, but not the one under the city centre', () => {
    const option = optionOf(america()).harvest
    expect(option.status).toBe('ready')
    expect(option.choices.map((choice) => [choice.resource, choice.label, choice.available])).toEqual([
      ['incense', 'Incense at C3', true],
      ['iron', 'Iron at A1', true],
    ])
  })

  it('lists one choice per resource however many squares hold it', () => {
    const option = optionOf(tile01Close()).harvest
    expect(option.choices.map((choice) => choice.label)).toEqual(['Wheat at C2'])
  })

  it('an enemy figure on the square removes the choice and the note says why', () => {
    const state = put(america(), KARANDRAS1, 'figures/bluearmy', 0, 0)
    const option = optionOf(state).harvest
    expect(option.choices.map((choice) => choice.resource)).toEqual(['incense'])
    expect(option.notes.join(' ')).toContain('A1 is blockaded')
  })

  it('a building, a Great Person or a disaster token on the square covers its resource, and the note says so', () => {
    for (const assetId of ['buildings/granary', 'great people/artist', 'disasters/drought']) {
      const option = optionOf(put(america(), CASH1981, assetId, 0, 0)).harvest
      expect(option.choices.map((choice) => choice.resource), assetId).toEqual(['incense'])
      expect(option.notes.join(' '), assetId).toContain('Iron at A1 is covered by a building, wonder, Great Person or disaster token and cannot be harvested.')
    }
  })

  it('a covered resource cannot be harvested, also by asking for it directly', () => {
    const state = put(america(), CASH1981, 'buildings/granary', 0, 0)
    expect(refusal(harvest(state, 'iron'))).toContain('has no iron icon')
  })

  it('a wonder on the square covers its resource, and the note names it', () => {
    const state = put(america(), CASH1981, 'wonders/bigben', 0, 0)
    const option = optionOf(state)
    expect(option.harvest.choices.map((choice) => choice.resource)).toEqual(['incense'])
    expect(option.harvest.notes.join(' ')).toContain('Iron at A1 is covered by a building, wonder, Great Person or disaster token')
    // The wonder's own culture is counted in the Devote sum instead
    expect(option.devoteToTheArts.culture).toBe(1 + 3)
  })

  it('a disaster token covers the culture icon of its square too, and the Devote total drops by it', () => {
    // tile01 B4 has a natural wonder's culture icon
    expect(optionOf(tile01Close()).devoteToTheArts.culture).toBe(2)
    const state = put(tile01Close(), CASH1981, 'disasters/drought', 1, 3)
    const option = optionOf(state).devoteToTheArts
    expect(option.culture).toBe(1)
    expect(option.parts.map((part) => part.label)).toEqual(['The city itself'])
  })

  it('offers the white scout of the Spanish, and not to anyone else', () => {
    const civ = (state: GameState, name: string): GameState => ({
      ...state,
      players: state.players.map((p) =>
        p.playerId === CASH1981 ? { ...p, civilization: { ...(p.civilization as object), name } as never } : p,
      ),
    })
    // Only the Spanish may place the white scout
    let state = civ(openTurn(put(withTile(baseGame(), 'tiles/tile02'), CASH1981, 'cities/redcity2', 3, 3)), 'Spanish')
    state = put(state, CASH1981, 'figures/whitescout', 1, 1)
    expect(optionOf(state).harvest.choices.map((choice) => choice.label)).toEqual(['Incense under a scout at B2'])
    expect(optionOf(civ(state, 'Russians')).harvest.choices).toEqual([])
  })

  it('the Harvest panel carries the scout note when a scout is offered', () => {
    let state = openTurn(put(withTile(baseGame(), 'tiles/tile02'), CASH1981, 'cities/redcity2', 3, 3))
    state = put(state, CASH1981, 'figures/redscout', 1, 1)
    expect(optionOf(state).harvest.notes.join(' ')).toContain('A scout gathers from the turn after it was placed')
    expect(optionOf(america()).harvest.notes.join(' ')).not.toContain('A scout gathers')
  })

  it('a resource under a scout is covered too when a building stands there', () => {
    let state = openTurn(put(withTile(baseGame(), 'tiles/tile02'), CASH1981, 'cities/redcity2', 3, 3))
    state = put(state, CASH1981, 'figures/redscout', 1, 1)
    expect(optionOf(state).harvest.choices).toHaveLength(1)
    state = put(state, CASH1981, 'buildings/granary', 1, 1)
    expect(optionOf(state).harvest.choices).toEqual([])
    expect(optionOf(state).harvest.status).toBe('unavailable')
  })

  it('offers the resource under a scout outside the outskirts', () => {
    // tile01 has wheat on C2; a scout there while the city is on B1 is inside, so move the city away
    let state = openTurn(put(withTile(baseGame(), 'tiles/tile02'), CASH1981, 'cities/redcity2', 1, 1))
    expect(optionOf(state).harvest.status).toBe('unavailable')
    // tile02 holds incense on B2 (the city centre); put the city on C3 and a scout on B2
    state = openTurn(put(withTile(baseGame(), 'tiles/tile02'), CASH1981, 'cities/redcity2', 3, 3))
    state = put(state, CASH1981, 'figures/redscout', 1, 1)
    const option = optionOf(state).harvest
    expect(option.status).toBe('ready')
    expect(option.choices).toHaveLength(1)
    expect(option.choices[0]).toMatchObject({ resource: 'incense', label: 'Incense under a scout at B2', available: true })
    expect(option.choices[0]?.scoutPieceId).not.toBeNull()
  })

  it('with nothing to harvest it is unavailable and says so', () => {
    const state = openTurn(put(withTile(baseGame(), 'tiles/tile02'), CASH1981, 'cities/redcity2', 3, 3))
    const option = optionOf(state).harvest
    expect(option.status).toBe('unavailable')
    expect(option.reason).toContain('No resource icon in the outskirts of City D4')
  })

  it('a resource the market has run out of is listed but cannot be taken, and a city with only that is unavailable', () => {
    let state = america()
    // Four players: four tokens of each kind. Put them all on the board, outside any player area.
    for (let n = 0; n < 4; n++) state = put(state, CASH1981, 'resources/iron', 5 + n, 5)
    const option = optionOf(state).harvest
    expect(option.status).toBe('ready')
    const iron = option.choices.find((choice) => choice.resource === 'iron')
    expect(iron).toMatchObject({ available: false, unavailableReason: 'The market has no iron token left.' })

    for (let n = 0; n < 4; n++) state = put(state, CASH1981, 'resources/incense', 5 + n, 6)
    const none = optionOf(state).harvest
    expect(none.status).toBe('unavailable')
    expect(none.reason).toBe('The market has no token left of the resources there.')
  })

  it('outside City Management it says wrong-phase', () => {
    const closed = put(withTile(baseGame(), 'tiles/america'), CASH1981, 'cities/redcity2', 1, 1)
    expect(optionOf(closed).harvest.status).toBe('wrong-phase')
  })
})

// ---------------------------------------------------------------------------
// Devote to the Arts
// ---------------------------------------------------------------------------

describe('devoting a city to the arts', () => {
  it('adds the estimate to the culture stock, writes one public line and records what undo needs', () => {
    let state = america()
    state = put(state, CASH1981, 'buildings/temple', 0, 2)
    const before = me(state).stats.culture
    const next = unwrap(devote(state))
    expect(me(next).stats.culture).toBe(before + 3)
    expect(lastLine(next)).toBe('cash1981 devoted City B2 to the arts and gained 3 culture')
    expect(next.assistedActions).toHaveLength(1)
    expect(next.assistedActions[0]?.effect).toEqual({
      kind: 'devoteToTheArts',
      cityPieceId: cityOf(state).id,
      cityLabel: 'City B2',
      culture: 3,
    })
    expect(next.assistedActions[0]?.usageKey).toBeNull()
  })

  it('may be done again once the player has confirmed it', () => {
    const once = unwrap(devote(america()))
    const twice = unwrap(devote(once, {}, 'devote-2', true))
    expect(me(twice).stats.culture).toBe(me(once).stats.culture + 1)
  })

  it('adds the squares of the scouts the player sends', () => {
    const state = put(tile01(), CASH1981, 'figures/redscout', 1, 3)
    const scout = optionOf(state).devoteToTheArts.scouts[0]
    if (scout === undefined) throw new Error('no scout offered')
    const next = unwrap(devote(state, { scoutPieceIds: [scout.pieceId] }))
    expect(me(next).stats.culture).toBe(me(state).stats.culture + 2)
    expect(lastLine(next)).toBe('cash1981 devoted City B1 to the arts and gained 2 culture, with the squares of the scouts at B4')
  })

  it('adds the culture of a wonder under a scout the player sends', () => {
    let state = america()
    state = put(state, CASH1981, 'wonders/louvre', 3, 0)
    state = put(state, CASH1981, 'figures/redscout', 3, 0)
    const scout = optionOf(state).devoteToTheArts.scouts[0]
    if (scout === undefined) throw new Error('no scout offered')
    const next = unwrap(devote(state, { scoutPieceIds: [scout.pieceId] }))
    expect(me(next).stats.culture).toBe(me(state).stats.culture + 1 + 2)
    expect(lastLine(next)).toBe('cash1981 devoted City B2 to the arts and gained 3 culture, with the squares of the scouts at D1')
  })

  it('takes the number the player typed and says what the estimate was', () => {
    const next = unwrap(devote(america(), { culture: 5 }))
    expect(me(next).stats.culture).toBe(me(america()).stats.culture + 5)
    expect(lastLine(next)).toBe('cash1981 devoted City B2 to the arts and gained 5 culture (set by the player; the estimate was 1)')
    expect(next.assistedActions[0]?.effect).toMatchObject({ culture: 5 })
  })

  it('a typed number equal to the estimate is not described as typed', () => {
    expect(lastLine(unwrap(devote(america(), { culture: 1 })))).toBe('cash1981 devoted City B2 to the arts and gained 1 culture')
  })

  it('refuses a typed number that is not a whole number from 0 to 99', () => {
    for (const culture of [-1, 100, 1.5, '3', null, Number.NaN]) {
      const result = devote(america(), { culture } as unknown as Partial<AssistedPayload>)
      expect(refusal(result), String(culture)).toContain('culture must be a whole number from 0 to 99')
    }
    expect(me(unwrap(devote(america(), { culture: 0 }))).stats.culture).toBe(me(america()).stats.culture)
    expect(me(unwrap(devote(america(), { culture: 99 }))).stats.culture).toBe(me(america()).stats.culture + 99)
  })

  it('refuses a scout that is not offered, or the same scout twice, and changes nothing', () => {
    const state = put(tile01(), CASH1981, 'figures/redscout', 1, 3)
    const scout = optionOf(state).devoteToTheArts.scouts[0]
    if (scout === undefined) throw new Error('no scout offered')
    expect(refusal(devote(state, { scoutPieceIds: ['nope'] } as Partial<AssistedPayload>))).toContain('A scout is not yours')
    expect(refusal(devote(state, { scoutPieceIds: [scout.pieceId, scout.pieceId] }))).toContain('different scout ids')
    expect(refusal(devote(state, { scoutPieceIds: 'x' } as unknown as Partial<AssistedPayload>))).toContain('different scout ids')
    // A scout of the city's own outskirts is never offered
    const inside = put(tile01(), CASH1981, 'figures/redscout', 2, 1)
    const piece = piecesOf(inside, 'figures/redscout')[0]
    expect(refusal(devote(inside, { scoutPieceIds: [piece?.id ?? ''] }))).toContain('A scout is not yours')
  })

  it('refuses outside City Management as wrong-phase', () => {
    const closed = put(withTile(baseGame(), 'tiles/america'), CASH1981, 'cities/redcity2', 1, 1)
    const error = unwrapErr(devote(closed))
    expect(error).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'wrong-phase' })
  })

  it('refuses a city that is not the player\'s, and a missing payload', () => {
    const state = put(america(), KARANDRAS1, 'cities/bluecity2', 7, 1)
    const blue = piecesOf(state, 'cities/bluecity2')[0]
    expect(refusal(devote(state, { cityPieceId: blue?.id ?? '' }))).toContain('not yours')
    const result = performAssistedAction(america(), { playerId: CASH1981, action: 'devoteToTheArts', requestId: 'x', at: AT })
    expect(refusal(result)).toContain('Say which city')
  })

  it('a player without a city is refused', () => {
    const state = openTurn(baseGame())
    expect(refusal(devote(state, { cityPieceId: 'none' }))).toContain('no city on the map')
  })

  it('the same request id twice does it once', () => {
    const once = unwrap(devote(america()))
    const again = unwrap(devote(once))
    expect(again).toBe(once)
  })

  it('does not change the input state', () => {
    const state = america()
    const copy = JSON.stringify(state)
    unwrap(devote(state))
    expect(JSON.stringify(state)).toBe(copy)
  })

  it('is public: the line reaches an opponent, and no effect is projected', () => {
    const next = unwrap(devote(america()))
    const view = toPlayerView(next, KARANDRAS1)
    expect(view.assistedActions.at(-1)?.text).toBe('cash1981 devoted City B2 to the arts and gained 1 culture')
    expect(JSON.stringify(view)).not.toContain('"effect"')
  })
})

describe('taking a devotion back', () => {
  it('removes the culture again with the vote, and writes a System line', () => {
    const state = america()
    const done = unwrap(devote(state))
    const undone = undoByVote(done, 'devote-1')
    expect(me(undone).stats.culture).toBe(me(state).stats.culture)
    expect(lastLine(undone)).toBe("System: cash1981's devotion of City B2 to the arts was undone: 1 culture removed")
    expect(undone.assistedActions[0]?.status).toBe('undone')
  })

  it('is refused, with the vote left open, when the culture has been spent', () => {
    const done = unwrap(devote(america()))
    const spent: GameState = {
      ...done,
      players: done.players.map((p) => (p.playerId === CASH1981 ? { ...p, stats: { ...p.stats, culture: 0 } } : p)),
    }
    const entry = spent.log.find((candidate) => candidate.assistedActionId === 'devote-1')
    if (entry === undefined) throw new Error('no log line')
    let next = unwrap(initiateUndo(spent, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
    const last = vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT })
    const error = unwrapErr(last)
    expect(error.kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(describeError(error)).toContain('cannot be taken back')
  })
})

// ---------------------------------------------------------------------------
// Harvest
// ---------------------------------------------------------------------------

describe('harvesting a resource', () => {
  it('puts a token of the kind in the player\'s own area, writes one public line and records the piece', () => {
    const state = america()
    const next = unwrap(harvest(state, 'iron'))
    const token = piecesOf(next, 'resources/iron')
    expect(token).toHaveLength(1)
    const piece = token[0] as BoardPiece
    const areas = playerAreas(next.board, next.players)
    expect(areaAt(areas, piece.x + piece.width / 2, piece.y + piece.height / 2)?.playerId).toBe(CASH1981)
    expect(lastLine(next)).toBe('cash1981 harvested iron with City B2 (Iron at A1)')
    expect(next.assistedActions[0]?.effect).toMatchObject({
      kind: 'harvest',
      cityPieceId: cityOf(state).id,
      cityLabel: 'City B2',
      resource: 'iron',
      pieceId: piece.id,
    })
    expect(next.assistedActions[0]?.usageKey).toBeNull()
    expect(next.board.history.at(-1)?.logLength).toBe(next.log.length)
  })

  it('the token then pays for a card the way a hand placed one does', () => {
    const next = unwrap(harvest(america(), 'incense'))
    const piece = piecesOf(next, 'resources/incense')[0] as BoardPiece
    // The lookup the cards use finds it, and spending it takes it off the board again
    const found = findResourceToken(next, CASH1981, 'Incense')
    expect(found).toMatchObject({ kind: 'piece', piece: { id: piece.id } })
    const spent = unwrap(spendResource(next, CASH1981, 'Incense'))
    expect(piecesOf(spent.state, 'resources/incense')).toEqual([])
    // Nobody else's lookup finds it
    expect(findResourceToken(next, KARANDRAS1, 'Incense')).toBeUndefined()
  })

  it('a second harvest puts the next token in the next free slot, not on top of the first', () => {
    const one = unwrap(harvest(america(), 'iron'))
    const two = unwrap(harvest(one, 'incense', {}, 'harvest-2', true))
    const [a, b] = [piecesOf(two, 'resources/iron')[0], piecesOf(two, 'resources/incense')[0]] as BoardPiece[]
    expect([a?.x, a?.y]).not.toEqual([b?.x, b?.y])
  })

  it('harvests the resource under a scout', () => {
    let state = openTurn(put(withTile(baseGame(), 'tiles/tile02'), CASH1981, 'cities/redcity2', 3, 3))
    state = put(state, CASH1981, 'figures/redscout', 1, 1)
    const choice = optionOf(state).harvest.choices[0]
    if (choice === undefined || choice.scoutPieceId === null) throw new Error('no scout choice')
    const next = unwrap(harvest(state, 'incense', { scoutPieceId: choice.scoutPieceId }))
    expect(piecesOf(next, 'resources/incense')).toHaveLength(1)
    expect(lastLine(next)).toBe('cash1981 harvested incense with City D4 (Incense under a scout at B2)')
  })

  it('refuses a resource the city does not have, one of an unknown kind, and a scout that is not on it', () => {
    const state = america()
    expect(refusal(harvest(state, 'wheat'))).toContain('City B2 has no wheat icon in its outskirts')
    expect(refusal(harvest(state, 'silk'))).toContain('City B2 has no silk icon in its outskirts')
    expect(refusal(harvest(state, 'gold'))).toContain('resource must be one of wheat, silk, incense, iron')
    expect(refusal(harvest(state, 'iron', { scoutPieceId: 'nope' }))).toContain('That scout is not yours')
    expect(refusal(harvest(state, 'iron', { scoutPieceId: 7 }))).toContain('scoutPieceId must be a scout id')
    expect(state.board.pieces.some((piece) => piece.category === 'resource')).toBe(false)
  })

  it('refuses a resource the market has run out of', () => {
    let state = america()
    for (let n = 0; n < 4; n++) state = put(state, CASH1981, 'resources/iron', 5 + n, 5)
    expect(refusal(harvest(state, 'iron'))).toContain('The market has no iron token left.')
    // The other resource is still there
    expect(piecesOf(unwrap(harvest(state, 'incense')), 'resources/incense')).toHaveLength(1)
  })

  it('refuses outside City Management as wrong-phase', () => {
    const closed = put(withTile(baseGame(), 'tiles/america'), CASH1981, 'cities/redcity2', 1, 1)
    expect(unwrapErr(harvest(closed, 'iron'))).toMatchObject({ kind: 'ASSISTED_ACTION_REJECTED', status: 'wrong-phase' })
  })

  it('a blockaded square gives nothing to harvest', () => {
    const state = put(america(), KARANDRAS1, 'figures/bluearmy', 0, 0)
    expect(refusal(harvest(state, 'iron'))).toContain('has no iron icon')
  })

  it('the plain board Undo cannot take the token back alone', () => {
    const done = unwrap(harvest(america(), 'iron'))
    expect(unwrapErr(undoLastBoardChange(done, CASH1981))).toEqual({ kind: 'BOARD_UNDO_ASSISTED' })
  })

  it('the same request id twice does it once', () => {
    const once = unwrap(harvest(america(), 'iron'))
    expect(unwrap(harvest(once, 'iron'))).toBe(once)
    expect(piecesOf(once, 'resources/iron')).toHaveLength(1)
  })

  it('does not change the input state', () => {
    const state = america()
    const copy = JSON.stringify(state)
    unwrap(harvest(state, 'iron'))
    expect(JSON.stringify(state)).toBe(copy)
  })
})

describe('taking a harvest back', () => {
  it('removes the token with the vote and writes a System line', () => {
    const done = unwrap(harvest(america(), 'iron'))
    const undone = undoByVote(done, 'harvest-1')
    expect(piecesOf(undone, 'resources/iron')).toHaveLength(0)
    expect(lastLine(undone)).toBe("System: cash1981's harvest of iron with City B2 was undone: the token was removed")
  })

  it('is refused, with the vote left open, when the token has been spent', () => {
    const done = unwrap(harvest(america(), 'iron'))
    const piece = piecesOf(done, 'resources/iron')[0] as BoardPiece
    const gone: GameState = { ...done, board: { ...done.board, pieces: done.board.pieces.filter((p) => p.id !== piece.id) } }
    const entry = gone.log.find((candidate) => candidate.assistedActionId === 'harvest-1')
    if (entry === undefined) throw new Error('no log line')
    let next = unwrap(initiateUndo(gone, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
    const error = unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
    expect(error.kind).toBe('ASSISTED_UNDO_BLOCKED')
    expect(describeError(error)).toContain('no longer on the board')
  })

  it('is refused when the token has left the player\'s area', () => {
    const done = unwrap(harvest(america(), 'iron'))
    const piece = piecesOf(done, 'resources/iron')[0] as BoardPiece
    const moved: GameState = {
      ...done,
      board: { ...done.board, pieces: done.board.pieces.map((p) => (p.id === piece.id ? { ...p, x: 20, y: mapTop(done.board) + 20 } : p)) },
    }
    const entry = moved.log.find((candidate) => candidate.assistedActionId === 'harvest-1')
    if (entry === undefined) throw new Error('no log line')
    let next = unwrap(initiateUndo(moved, { logId: entry.id, playerId: CASH1981 }))
    for (const playerId of [KARANDRAS1, ITCHI]) next = unwrap(vote(next, { logId: entry.id, playerId, vote: true, at: AT }))
    const error = unwrapErr(vote(next, { logId: entry.id, playerId: CHUL, vote: true, at: AT }))
    expect(describeError(error)).toContain('has left your player area')
  })
})

describe('the player view', () => {
  it('carries both options on the viewer\'s own cities only, also when the opponent has a city', () => {
    const state = put(america(), KARANDRAS1, 'cities/bluecity2', 7, 1)
    const own = toPlayerView(state, CASH1981).you?.cityActions?.[0]
    expect(own?.devoteToTheArts.culture).toBe(1)
    expect(own?.harvest.choices.map((choice) => choice.resource)).toEqual(['incense', 'iron'])
    const opponent = toPlayerView(state, KARANDRAS1)
    // Karandras sees his own city's options, not Cash's
    expect(opponent.you?.cityActions?.map((city) => city.label)).toEqual(['City H2'])
    expect(opponent.you?.cityActions?.[0]?.harvest.choices).toEqual([])
    expect(JSON.stringify(opponent.opponents)).not.toContain('devoteToTheArts')
  })
})
