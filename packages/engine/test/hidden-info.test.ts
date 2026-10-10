/**
 * Hidden information.
 *
 * Java stored the whole item on the log document and let the resource layer
 * filter it. That was the security hole noted in todo.txt ("hide the drawn item
 * in the public log"). These tests check that the projections do not leak.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import {
  chooseSocialPolicy,
  chooseTech,
  revealItem,
  revealSocialPolicy,
  revealTech,
  revealedTechsForAllPlayers,
} from '../src/actions/player.js'
import { markPhasesDone } from '../src/actions/turn.js'
import { performAssistedAction } from '../src/assisted.js'
import { SQUARE_SIZE, mapTop, slotOrigin } from '../src/board.js'
import type { CivItem } from '../src/item.js'
import { itemName, revealAll } from '../src/item.js'
import { createLogTexts, javaStringHashCode, uniqueItemNumber } from '../src/log.js'
import { unwrap } from '../src/result.js'
import { findPlayer, toPlayerView, toPublicLog } from '../src/state.js'

import { CASH1981, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

describe('toPublicLog', () => {
  it('strips the item and the private log text', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'GREAT_PERSON' }))
    const entry = state.log.at(-1)
    if (entry === undefined) throw new Error('no log entry')

    const item = entry.item
    if (item === null) throw new Error('the log entry has no item')

    const publicEntry = toPublicLog(entry)
    expect(Object.keys(publicEntry)).toEqual(['id', 'username', 'logType', 'publicLog'])
    expect(JSON.stringify(publicEntry)).not.toContain(itemName(item))
  })
})

describe('toPlayerView', () => {
  it('the owner sees their own hand in the clear', () => {
    let state = firstCivGame()
    for (const sheetName of ['CULTURE_1', 'HUTS', 'INFANTRY'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }

    const view = toPlayerView(state, CASH1981)
    expect(view.you?.items).toHaveLength(3)
    expect(view.you?.items.map((item) => item.sheetName)).toEqual([
      'CULTURE_1',
      'HUTS',
      'INFANTRY',
    ])
  })

  it('opponents see counts only, not contents', () => {
    let state = firstCivGame()
    for (const sheetName of ['CULTURE_1', 'HUTS', 'INFANTRY'] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }

    const view = toPlayerView(state, KARANDRAS1)
    const cash = view.opponents.find((opponent) => opponent.playerId === CASH1981)

    expect(cash?.numberOfItemsInHand).toBe(3)
    expect(cash).not.toHaveProperty('items')
    // None of the card names in cash1981's hand may appear in Karandras1's view
    const hand = findPlayer(state, CASH1981)?.items ?? []
    const serialised = JSON.stringify(view)
    for (const item of hand) {
      expect(serialised, `leaked ${revealAll(item)}`).not.toContain(revealAll(item))
    }
  })

  it('projects only category counts for opponents and spectators', () => {
    let state = firstCivGame()
    for (const sheetName of [
      'CULTURE_1', 'CULTURE_2', 'CULTURE_3', 'HUTS', 'VILLAGES',
      'GREAT_PERSON', 'INFANTRY', 'ARTILLERY', 'MOUNTED', 'AIRCRAFT', 'CIV',
    ] as const) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName }))
    }

    const hand = findPlayer(state, CASH1981)?.items ?? []
    const opponent = toPlayerView(state, ITCHI).opponents.find((entry) => entry.playerId === CASH1981)
    const spectator = toPlayerView(state, 'onlooker').opponents.find((entry) => entry.playerId === CASH1981)
    const expected = { cultureCards: 3, huts: 1, villages: 1, greatPersons: 1, units: 4 }
    expect(opponent?.publicHand).toEqual(expected)
    expect(spectator?.publicHand).toEqual(expected)
    expect(opponent?.numberOfItemsInHand).toBe(11)

    for (const projected of [opponent, spectator]) {
      const serialised = JSON.stringify(projected)
      expect(projected).not.toHaveProperty('items')
      for (const item of hand) {
        expect(serialised).not.toContain(item.id)
        expect(serialised).not.toContain(`"itemNumber":${item.itemNumber}`)
        expect(serialised).not.toContain(revealAll(item))
      }
    }
  })

  it('log entries belonging to others arrive in public form only', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))

    const own = toPlayerView(state, CASH1981)
    const other = toPlayerView(state, ITCHI)

    const ownEntry = own.log.at(-1)
    const otherEntry = other.log.at(-1)

    expect(ownEntry).toHaveProperty('item')
    expect(ownEntry).toHaveProperty('privateLog')
    expect(otherEntry).not.toHaveProperty('item')
    expect(otherEntry).not.toHaveProperty('privateLog')
  })

  it('shows the deck as a count, not as cards', () => {
    const state = firstCivGame()
    const view = toPlayerView(state, CASH1981)

    expect(view.numberOfItemsInDeck).toBe(state.items.length)
    expect(view).not.toHaveProperty('items')
  })

  it('an onlooker who is not in the game sees no hand', () => {
    const view = toPlayerView(firstCivGame(), 'onlooker')
    expect(view.you).toBeNull()
    expect(view.opponents).toHaveLength(4)
    expect(view.opponents.every((opponent) => opponent.government === 'Despotism')).toBe(true)
    expect(view.opponents.every((opponent) => !('items' in opponent))).toBe(true)
  })

  it('a hidden technology stays out of another player\'s public techs view', () => {
    // CASH1981 reveals a civilization first, so they show up in
    // revealedTechsForAllPlayers with their (public) starting technology —
    // otherwise the public-projection assertions below would pass vacuously
    // against an empty list, since revealedTechsForAllPlayers only returns
    // players who have chosen a civilization.
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CIV' }))
    const civ = findPlayer(state, CASH1981)?.items.find(
      (item): item is CivItem => item.kind === 'civ',
    )
    if (civ === undefined) throw new Error('no civ drawn')
    state = unwrap(revealItem(state, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }))

    // A level-1 tech that is not the starting technology, so choosing it
    // stays hidden rather than being published by the civ reveal.
    const tech = state.techs.find((candidate) => candidate.name !== civ.startingTech.name)
    if (tech === undefined) throw new Error('no tech')

    const chosen = unwrap(chooseTech(state, { playerId: CASH1981, techName: tech.name }))

    // The owner sees it, still hidden, in their own hand.
    const owner = toPlayerView(chosen, CASH1981)
    expect(owner.you?.techsChosen.some((item) => item.name === tech.name)).toBe(true)

    // Another player sees the opponent as a count only, and the general
    // catalogue of undrawn/uncommitted techs (in state.techs, sent to every
    // viewer so they can choose one) is not what is under test here — the
    // opponent projection and the public "revealed by everyone" list are.
    const other = toPlayerView(chosen, ITCHI)
    const cash = other.opponents.find((opponent) => opponent.playerId === CASH1981)
    expect(cash).not.toHaveProperty('techsChosen')
    expect(JSON.stringify(cash)).not.toContain(tech.name)

    // The public projection: CASH1981 is present (civ revealed), carries the
    // starting technology in the clear, and does not carry the hidden one.
    // This is the assertion the reviewer found was vacuous before the civ
    // reveal was added — it now fails if hidden filtering ever regresses.
    const publicTechs = revealedTechsForAllPlayers(chosen)
    const cashPublic = publicTechs.find((entry) => entry.civilization === civ.name)
    expect(cashPublic).toBeDefined()
    expect(cashPublic?.techs.map((entry) => entry.name)).toContain(civ.startingTech.name)
    expect(cashPublic?.techs.map((entry) => entry.name)).not.toContain(tech.name)
  })

  it('a hidden social policy stays out of another player\'s view, and shows in the public log once revealed', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const chosen = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))

    // The owner sees it, still hidden, in their own hand.
    const owner = toPlayerView(chosen, CASH1981)
    expect(owner.you?.socialPolicies.some((item) => item.name === policy.name)).toBe(true)

    // Another player sees only a count and an empty revealed list, not the
    // card, and the name does not leak anywhere in their view — including the
    // log line for choosing it.
    const other = toPlayerView(chosen, ITCHI)
    const cash = other.opponents.find((opponent) => opponent.playerId === CASH1981)
    expect(cash).not.toHaveProperty('socialPolicies')
    expect(cash?.revealedSocialPolicies).toEqual([])
    expect(JSON.stringify(other)).not.toContain(policy.name)

    const revealed = unwrap(
      revealSocialPolicy(chosen, { playerId: CASH1981, name: policy.name }),
    )

    // After the reveal the policy is the public thing (issue #140): it shows up
    // on the opponent projection, and the log line names it.
    const after = toPlayerView(revealed, ITCHI)
    const cashAfter = after.opponents.find((opponent) => opponent.playerId === CASH1981)
    expect(cashAfter?.revealedSocialPolicies.map((item) => item.name)).toEqual([policy.name])

    const entry = revealed.log.at(-1)
    if (entry === undefined) throw new Error('no log entry')
    expect(toPublicLog(entry).publicLog).toContain(policy.name)
  })
})

describe('log texts', () => {
  it('ITEM reveals everything privately and only the type publicly', () => {
    // Java: DELIM is " - ", which gives the double space after "drew"
    const texts = createLogTexts('ITEM', 'cash1981', null, 42, 'secret')
    expect(texts.privateLog).toBe('cash1981 drew  - . Item number #42')
    expect(texts.publicLog).toBe('cash1981 drew  - . Item number #42')
  })

  it('TECH hides the technology publicly', () => {
    const state = firstCivGame()
    const tech = state.techs[0]
    if (tech === undefined) throw new Error('no tech')

    const texts = createLogTexts('TECH', 'cash1981', tech, tech.itemNumber, state.logSecret)
    expect(texts.privateLog).toContain(tech.name)
    expect(texts.publicLog).toBe(
      `cash1981 has researched a hidden technology${uniqueItemNumber(state.logSecret, 'cash1981', tech.itemNumber)}`,
    )
    expect(texts.publicLog).not.toContain(tech.name)
  })

  it('SOCIAL_POLICY hides the card publicly, even though revealPublic would show it', () => {
    const state = firstCivGame()
    const policy = state.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const texts = createLogTexts('SOCIAL_POLICY', 'cash1981', policy, policy.itemNumber, state.logSecret)
    expect(texts.privateLog).toContain(policy.name)
    expect(texts.publicLog).not.toContain(policy.name)
    expect(texts.publicLog).toContain('has chosen a hidden social policy')
  })

  it('uniqueItemNumber gives a different number per player for the same card', () => {
    expect(uniqueItemNumber('key', 'cash1981', 42)).not.toBe(uniqueItemNumber('key', 'Karandras1', 42))
  })

  it('uniqueItemNumber is stable for one game and differs between games', () => {
    expect(uniqueItemNumber('key', 'cash1981', 42)).toBe(uniqueItemNumber('key', 'cash1981', 42))
    expect(uniqueItemNumber('key', 'cash1981', 42)).not.toBe(uniqueItemNumber('other', 'cash1981', 42))
  })

  it('the number on a hidden tech line only matches the tech list with the game key', () => {
    // Java added an offset from the username to the catalogue number. Both are
    // public, so subtracting one from the other named the tech.
    const state = firstCivGame()
    const tech = state.techs[0]
    if (tech === undefined) throw new Error('no tech')
    const texts = createLogTexts('TECH', 'cash1981', tech, tech.itemNumber, state.logSecret)
    const shown = `. Item number #${/#(\d+)$/.exec(texts.publicLog)?.[1]}`
    const matching = (secret: string) =>
      state.techs.filter(
        (candidate) => uniqueItemNumber(secret, 'cash1981', candidate.itemNumber) === shown,
      )

    // With the key, exactly one tech fits: the tie to the card is real
    expect(matching(state.logSecret).map((candidate) => candidate.name)).toEqual([tech.name])
    // Without it, a reader who knows the username and the tech list finds nothing
    const offset = Number(String(Math.abs(javaStringHashCode('cash1981'))).slice(0, 3))
    expect(state.techs.filter((candidate) => `. Item number #${candidate.itemNumber + offset}` === shown)).toEqual([])
    for (const guess of ['', 'secret', 'cash1981', state.id]) expect(matching(guess)).toEqual([])
  })

  it('no log entry or item id is the log secret, and it never reaches a player view', () => {
    // The key must not be something the game hands out as an id: log ids and item
    // ids are public.
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const ids = [
      ...state.log.map((entry) => entry.id),
      ...state.items.map((item) => item.id),
      ...state.techs.map((tech) => tech.id),
      state.id,
    ]
    expect(ids).not.toContain(state.logSecret)
    for (const viewer of [CASH1981, KARANDRAS1, 'spectator']) {
      expect(JSON.stringify(toPlayerView(state, viewer))).not.toContain(state.logSecret)
    }
  })

  it('javaStringHashCode matches the Java String.hashCode', () => {
    // Known values from java.lang.String.hashCode()
    expect(javaStringHashCode('')).toBe(0)
    expect(javaStringHashCode('a')).toBe(97)
    expect(javaStringHashCode('ab')).toBe(3105)
    expect(javaStringHashCode('hello')).toBe(99162322)
    // The classic collision: "Aa" and "BB" hash the same
    expect(javaStringHashCode('Aa')).toBe(2112)
    expect(javaStringHashCode('BB')).toBe(2112)
  })
})

describe('build options', () => {
  /** Cash is Red with the America tile and a city on B2; Karandras is Blue. City Management is open. */
  function buildScene(techs: readonly { readonly name: string; readonly reveal: boolean }[]) {
    let state = firstCivGame()
    state = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        color: player.playerId === CASH1981 ? 'Red' : player.playerId === KARANDRAS1 ? 'Blue' : 'Green',
      })),
    }
    const slot = state.board.slots[0]
    if (slot === undefined) throw new Error('board has no slots')
    const [x, y] = slotOrigin(state.board, slot)
    state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
    state = unwrap(
      placePiece(state, {
        playerId: CASH1981,
        assetId: 'cities/redcity2',
        x: 1 * SQUARE_SIZE + 4,
        y: mapTop(state.board) + 1 * SQUARE_SIZE + 4,
      }),
    )
    for (const tech of techs) {
      state = unwrap(chooseTech(state, { playerId: CASH1981, techName: tech.name }))
      if (tech.reveal) state = unwrap(revealTech(state, { playerId: CASH1981, techName: tech.name }))
    }
    return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  }

  it('the owner gets the options of their own city', () => {
    const view = toPlayerView(buildScene([{ name: 'Writing', reveal: true }]), CASH1981)
    expect(view.you?.buildOptions).toHaveLength(1)
    // Figures and units are offered as well (task `assisted-units`); this test is about the buildings
    const buildings = view.you?.buildOptions[0]?.choices.filter((choice) => choice.item.kind === 'building')
    expect(buildings?.map((choice) => choice.assetId)).toEqual(['buildings/library'])
  })

  it('an opponent and a spectator get no options, and none of the owner\'s are in their view', () => {
    const state = buildScene([{ name: 'Writing', reveal: true }])
    const owner = toPlayerView(state, CASH1981)
    const cityPieceId = owner.you?.buildOptions[0]?.cityPieceId ?? ''
    expect(cityPieceId).not.toBe('')

    const opponent = toPlayerView(state, KARANDRAS1)
    // Their own view carries the field, for their own cities (none), and nothing of Cash's
    expect(opponent.you?.buildOptions).toEqual([])
    const spectator = toPlayerView(state, 'spectator')
    expect(spectator.you).toBeNull()

    for (const view of [opponent, spectator]) {
      const json = JSON.stringify(view)
      // The city piece id is on the public board, but never beside any option or choice
      expect(json).not.toContain('"choices"')
      expect(json).not.toContain('"unavailable"')
      expect(json).not.toContain('"tradeToPay"')
      expect(json).not.toContain('Ready to build.')
    }
    expect(JSON.stringify(spectator)).not.toContain('buildOptions')
    // Cash's entry in an opponent's list of players has no such field either
    const cashAsOpponent = opponent.opponents.find((candidate) => candidate.playerId === CASH1981)
    expect(cashAsOpponent).toBeDefined()
    expect(cashAsOpponent).not.toHaveProperty('buildOptions')
    expect(cashAsOpponent).not.toHaveProperty('choices')
  })

  it('a tech that is chosen but not revealed unlocks nothing for anyone but the owner, who is told it is hidden', () => {
    const state = buildScene([{ name: 'Writing', reveal: false }])
    const owner = toPlayerView(state, CASH1981)
    expect(owner.you?.buildOptions[0]?.choices.filter((choice) => choice.item.kind === 'building')).toEqual([])
    expect(owner.you?.buildOptions[0]?.unavailable.find((entry) => entry.assetId === 'buildings/library')?.reason).toBe(
      'Needs Writing. Writing is chosen but not revealed yet.',
    )
    // Nothing of that sentence or of the building reaches anybody else
    for (const viewerId of [KARANDRAS1, ITCHI, 'spectator']) {
      const json = JSON.stringify(toPlayerView(state, viewerId))
      expect(json).not.toContain('chosen but not revealed')
      expect(json).not.toContain('Needs Writing')
      expect(json).not.toContain('buildings/library')
    }
  })

  it('a build shows others only its public line, never the effect', () => {
    let state = buildScene([{ name: 'Writing', reveal: true }])
    const cityPieceId = toPlayerView(state, CASH1981).you?.buildOptions[0]?.cityPieceId ?? ''
    state = unwrap(
      performAssistedAction(state, {
        playerId: CASH1981,
        action: 'build',
        requestId: 'req-1',
        payload: { cityPieceId, item: { kind: 'building', assetId: 'buildings/library' }, target: { column: 2, row: 1 } },
      }),
    )
    for (const viewerId of [KARANDRAS1, 'spectator']) {
      const view = toPlayerView(state, viewerId)
      const json = JSON.stringify(view)
      expect(json).not.toContain('"effect"')
      expect(json).not.toContain('buildOptions":[{')
      expect(view.assistedActions).toEqual([
        expect.objectContaining({ kind: 'build', label: 'Build', text: 'cash1981 built a Library in City B2 on square C2' }),
      ])
    }
  })
})

describe('city actions', () => {
  /**
   * Cash is Red with the America tile, a city on B2 and a Granary on A1 and C2;
   * Karandras is Blue. City Management is open and Engineering, which unlocks the
   * Aqueduct, is revealed, chosen but hidden, or not chosen.
   */
  function cityScene(engineering: 'revealed' | 'hidden' | 'none') {
    let state = firstCivGame()
    state = {
      ...state,
      players: state.players.map((player) => ({
        ...player,
        color: player.playerId === CASH1981 ? 'Red' : player.playerId === KARANDRAS1 ? 'Blue' : 'Green',
      })),
    }
    const slot = state.board.slots[0]
    if (slot === undefined) throw new Error('board has no slots')
    const [x, y] = slotOrigin(state.board, slot)
    state = unwrap(placePiece(state, { playerId: CASH1981, assetId: 'tiles/america', x, y }))
    const at = (assetId: string, column: number, row: number) =>
      unwrap(
        placePiece(state, {
          playerId: CASH1981,
          assetId,
          x: column * SQUARE_SIZE + 2,
          y: mapTop(state.board) + row * SQUARE_SIZE + 2,
        }),
      )
    state = at('cities/redcity2', 1, 1)
    state = at('buildings/granary', 0, 0)
    state = at('buildings/granary', 2, 1)
    if (engineering !== 'none') {
      state = unwrap(chooseTech(state, { playerId: CASH1981, techName: 'Engineering' }))
      if (engineering === 'revealed') state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Engineering' }))
    }
    return unwrap(markPhasesDone(state, { playerId: CASH1981, turnNumber: 1, upToPhase: 'TRADE' }))
  }

  it('the owner gets the Building Program option of each city and the families to upgrade', () => {
    const view = toPlayerView(cityScene('revealed'), CASH1981)
    expect(view.you?.cityActions).toEqual([
      expect.objectContaining({
        label: 'City B2',
        startBuildingProgram: { status: 'ready', reason: 'Ready to start a Building Program.', hasMarker: false },
      }),
    ])
    expect(view.you?.upgradeOptions).toEqual([
      expect.objectContaining({ label: 'Granary to Aqueduct', count: 2, squares: [expect.objectContaining({ label: 'A1' }), expect.objectContaining({ label: 'C2' })] }),
    ])
  })

  it('an opponent and a spectator get neither the city actions nor the upgrade options of the owner', () => {
    const state = cityScene('revealed')
    const opponent = toPlayerView(state, KARANDRAS1)
    const spectator = toPlayerView(state, 'spectator')
    expect(opponent.you?.cityActions).toEqual([])
    expect(opponent.you?.upgradeOptions).toEqual([])
    expect(spectator.you).toBeNull()

    for (const view of [opponent, spectator]) {
      const json = JSON.stringify(view)
      expect(json).not.toContain('"startBuildingProgram"')
      expect(json).not.toContain('Ready to start a Building Program')
      expect(json).not.toContain('Granary to Aqueduct')
      expect(json).not.toContain('"upgradedLabel"')
      expect(json).not.toContain('"hasMarker"')
    }
    for (const key of ['cityActions', 'upgradeOptions']) {
      expect(JSON.stringify(spectator)).not.toContain(key)
      expect(opponent.opponents.find((candidate) => candidate.playerId === CASH1981)).not.toHaveProperty(key)
    }
  })

  it('a tech that is chosen but not revealed unlocks no upgrade for anyone, and nothing of it reaches the others', () => {
    const state = cityScene('hidden')
    expect(toPlayerView(state, CASH1981).you?.upgradeOptions).toEqual([])
    for (const viewerId of [KARANDRAS1, ITCHI, 'spectator']) {
      const json = JSON.stringify(toPlayerView(state, viewerId))
      expect(json).not.toContain('Granary to Aqueduct')
      expect(json).not.toContain('"upgradedLabel"')
    }
    // Without the tech chosen at all, the owner's view is the same
    expect(toPlayerView(cityScene('none'), CASH1981).you?.upgradeOptions).toEqual([])
  })

  it('the two actions show others only their public line, never the effect', () => {
    let state = cityScene('revealed')
    const cityPieceId = toPlayerView(state, CASH1981).you?.cityActions[0]?.cityPieceId ?? ''
    state = unwrap(
      performAssistedAction(state, { playerId: CASH1981, action: 'startBuildingProgram', requestId: 'start-1', payload: { cityPieceId } }),
    )
    state = unwrap(performAssistedAction(state, { playerId: CASH1981, action: 'upgradeBuildings', requestId: 'up-1' }))
    for (const viewerId of [KARANDRAS1, 'spectator']) {
      const view = toPlayerView(state, viewerId)
      const json = JSON.stringify(view)
      expect(json).not.toContain('"effect"')
      expect(json).not.toContain('"flipped"')
      expect(json).not.toContain('removedHistoryId')
      expect(json).not.toContain('cityLabel')
      expect(view.assistedActions.map((action) => [action.kind, action.label, action.text])).toEqual([
        ['startBuildingProgram', 'Start Building Program', 'cash1981 started a Building Program in City B2'],
        ['upgradeBuildings', 'Upgrade buildings', 'cash1981 upgraded 2 Granaries to Aqueducts at A1 and C2'],
      ])
    }
    // The owner's own list is derived again: the marker is there, and nothing is left to flip
    const owner = toPlayerView(state, CASH1981)
    expect(owner.you?.cityActions[0]?.startBuildingProgram).toMatchObject({ status: 'unavailable', hasMarker: true })
    expect(owner.you?.upgradeOptions).toEqual([])
  })
})
