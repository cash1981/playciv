/**
 * Port of the tests that covered `PlayerAction`.
 *
 * Java had no `PlayerActionTest` of its own; the coverage came through
 * `PlayerResourceTest` and `UndoActionTest.checkThatYouCanUndoTech`. These are
 * written against what the Java source actually does, naming the Java method.
 */

import { describe, expect, it } from 'vitest'

import { placePiece } from '../src/actions/board.js'
import { draw } from '../src/actions/draw.js'
import {
  chooseSocialPolicy,
  chooseTech,
  discardItem,
  discardRandomGreatPerson,
  endTurn,
  isYourTurn,
  remainingTechsForPlayer,
  removeSocialPolicy,
  removeTech,
  revealItem,
  revealSocialPolicy,
  revealTech,
  revealedTechsForAllPlayers,
  saveNote,
  takeTurn,
  tradeToPlayer,
} from '../src/actions/player.js'
import type { CivItem } from '../src/item.js'
import { itemName } from '../src/item.js'
import { uniqueItemNumber } from '../src/log.js'
import { nextId, shuffle } from '../src/random.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, withPlayer } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const handOf = (state: GameState, playerId: string) =>
  findPlayer(state, playerId)?.items ?? []

/** Java: `PlayerAction.chooseTech` / `removeTech` / `revealTech`. */
describe('technology', () => {
  it('chooses a technology and logs it hidden in public', () => {
    const state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const player = findPlayer(state, CASH1981)
    const entry = state.log.at(-1)

    expect(player?.techsChosen.map((tech) => tech.name)).toEqual(['Navy'])
    expect(player?.techsChosen[0]?.hidden).toBe(true)
    expect(player?.techsChosen[0]?.ownerId).toBe(CASH1981)
    expect(entry?.privateLog).toContain('Navy')
    expect(entry?.publicLog).toContain('has researched a hidden technology')
    expect(entry?.publicLog).not.toContain('Navy')
  })

  it('keeps state.techs clean of who chose what', () => {
    // Java mutated the technology in pbf.techs and put the same reference in the hand
    const state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const inCatalogue = state.techs.find((tech) => tech.name === 'Navy')
    expect(inCatalogue?.ownerId).toBeNull()
  })

  it('the same technology twice is refused', () => {
    const state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const error = unwrapErr(chooseTech(state, { playerId: CASH1981, techName: 'Navy' }))
    expect(error).toEqual({ kind: 'TECH_ALREADY_CHOSEN', techName: 'Navy' })
  })

  it('an unknown technology gives ITEM_NOT_FOUND', () => {
    const error = unwrapErr(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Warp Drive' }))
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })

  it('removes a chosen technology and logs REMOVED_TECH', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(removeTech(state, { playerId: CASH1981, techName: 'Navy' }))

    expect(findPlayer(state, CASH1981)?.techsChosen).toHaveLength(0)
    expect(state.log.at(-1)?.publicLog).toContain('has removed a hidden technology')
    expect(state.log.at(-1)?.publicLog).not.toContain('Navy')
  })

  it('reveals a technology, which everyone then sees', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Navy' }))

    expect(findPlayer(state, CASH1981)?.techsChosen[0]?.hidden).toBe(false)
    expect(state.log.at(-1)?.publicLog).toContain('Navy')
    expect(revealedTechsForAllPlayers(state)).toEqual([])
  })

  it('the remaining technologies leave out the chosen ones', () => {
    const before = firstCivGame()
    const total = remainingTechsForPlayer(before, CASH1981).length
    const after = unwrap(chooseTech(before, { playerId: CASH1981, techName: 'Navy' }))

    expect(remainingTechsForPlayer(after, CASH1981)).toHaveLength(total - 1)
    expect(remainingTechsForPlayer(after, CASH1981).some((t) => t.name === 'Navy')).toBe(false)
  })

  it('a player without access is refused', () => {
    const error = unwrapErr(chooseTech(firstCivGame(), { playerId: 'outsider', techName: 'Navy' }))
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'outsider' })
  })
})

/** Java: `PlayerAction.revealItem`. */
describe('reveal item', () => {
  it('reveals a hut and logs the contents publicly', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = handOf(state, CASH1981)[0]
    if (hut === undefined) throw new Error('no hut')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'HUTS', itemNumber: hut.itemNumber }),
    )

    expect(handOf(state, CASH1981)[0]?.hidden).toBe(false)
    expect(state.log.at(-1)?.publicLog).toContain(itemName(hut))
  })

  it('finds the item by name when no item number is given', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'VILLAGES' }))
    const village = handOf(state, CASH1981)[0]
    if (village === undefined) throw new Error('no village')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'VILLAGES', name: itemName(village) }),
    )
    expect(handOf(state, CASH1981)[0]?.hidden).toBe(false)
  })

  it('revealing the same item twice gives ITEM_ALREADY_REVEALED', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = handOf(state, CASH1981)[0]
    if (hut === undefined) throw new Error('no hut')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'HUTS', itemNumber: hut.itemNumber }),
    )
    const error = unwrapErr(
      revealItem(state, { playerId: CASH1981, sheetName: 'HUTS', itemNumber: hut.itemNumber }),
    )
    expect(error.kind).toBe('ITEM_ALREADY_REVEALED')
  })
})

/**
 * Java: the civilization sequence in `revealItem`.
 *
 * Note that `drawStartingItems` goes through `DrawAction.draw`, which requires
 * that it is the turn of the player. In Java that means only the player whose
 * turn it is can reveal a civilization and get starting units. See the last
 * test below.
 */
describe('reveal civilization', () => {
  const revealCivFor = (state: GameState, playerId: string) => {
    // Java filters on isHidden when looking the item up, so a civ card that
    // has already been revealed is invisible to revealItem
    const civ = handOf(state, playerId).find((item) => item.kind === 'civ' && item.hidden)
    if (civ === undefined) throw new Error('no hidden civ in the hand')
    return revealItem(state, { playerId, sheetName: 'CIV', itemNumber: civ.itemNumber })
  }

  it('sets the civilization and starting technology, and draws starting units', () => {
    let state = firstCivGame()
    // Java dealt several civ cards for the player to choose between
    for (let i = 0; i < 3; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    }

    const chosen = handOf(state, CASH1981).find((item) => item.kind === 'civ') as CivItem
    state = unwrap(revealCivFor(state, CASH1981))

    const player = findPlayer(state, CASH1981)
    expect(player?.civilization?.name).toBe(chosen.name)
    // The starting technology is revealed; the civ card makes it public anyway
    expect(player?.techsChosen.map((t) => t.name)).toEqual([chosen.startingTech.name])
    expect(player?.techsChosen[0]?.hidden).toBe(false)
  })

  it('discards the other civ cards to discardedItems', () => {
    let state = firstCivGame()
    for (let i = 0; i < 3; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    }
    state = unwrap(revealCivFor(state, CASH1981))

    expect(handOf(state, CASH1981).filter((item) => item.kind === 'civ')).toHaveLength(1)
    expect(state.discardedItems.filter((item) => item.kind === 'civ')).toHaveLength(2)
    expect(state.discardedItems.every((item) => item.hidden)).toBe(true)
  })

  it('draws three units for a civilization with no special rule', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    state = unwrap(revealCivFor(state, CASH1981))

    const units = handOf(state, CASH1981).filter(
      (item) => item.kind === 'infantry' || item.kind === 'artillery' || item.kind === 'mounted',
    )
    const civ = findPlayer(state, CASH1981)?.civilization
    const special = ['Germans', 'Mongols', 'Zulu', 'Egyptians']

    if (civ !== null && civ !== undefined && !special.includes(civ.name)) {
      expect(units).toHaveLength(3)
    } else {
      expect(units.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('revealing the same civ card again gives ITEM_ALREADY_REVEALED', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    const civ = handOf(state, CASH1981).find((item) => item.kind === 'civ')
    if (civ === undefined) throw new Error('no civ')

    state = unwrap(revealCivFor(state, CASH1981))
    // Java searches hidden items only, so the revealed card cannot be found
    const error = unwrapErr(
      revealItem(state, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }),
    )
    expect(error.kind).toBe('ITEM_ALREADY_REVEALED')
  })

  it('two civilizations cannot be chosen', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    state = unwrap(revealCivFor(state, CASH1981))

    // A fresh, hidden civ card gets past the hidden filter and hits the civ check
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    const error = unwrapErr(revealCivFor(state, CASH1981))
    expect(error).toEqual({ kind: 'CIVILIZATION_ALREADY_CHOSEN', playerId: CASH1981 })
  })

  /**
   * This records a real limitation inherited from Java rather than desired
   * behaviour: the starting units are drawn through DrawAction.draw, which
   * requires the turn.
   */
  it('a player whose turn it is not cannot reveal a civilization', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))

    // Hand Karandras1 a civ card by moving it across, since drawing is not allowed
    const civ = state.items.find((item) => item.kind === 'civ')
    if (civ === undefined) throw new Error('no civ in the deck')
    state = {
      ...state,
      items: state.items.filter((item) => item.id !== civ.id),
      players: state.players.map((player) =>
        player.playerId === KARANDRAS1
          ? { ...player, items: [{ ...civ, ownerId: KARANDRAS1 }] }
          : player,
      ),
    }

    const error = unwrapErr(
      revealItem(state, { playerId: KARANDRAS1, sheetName: 'CIV', itemNumber: civ.itemNumber }),
    )
    expect(error).toEqual({ kind: 'NOT_YOUR_TURN', playerId: KARANDRAS1 })
  })

  // Reveal a civilization for every player, in player-number order, forcing the
  // turn to each in turn (drawing and revealing both require the turn).
  const revealEveryCiv = (start: GameState): GameState => {
    let state = start
    const order = [...state.players]
      .sort((a, b) => a.playernumber - b.playernumber)
      .map((player) => player.playerId)
    for (const playerId of order) {
      state = {
        ...state,
        players: state.players.map((p) => ({ ...p, yourTurn: p.playerId === playerId })),
      }
      state = unwrap(draw(state, { playerId, sheetName: 'CIV' }))
      state = unwrap(revealCivFor(state, playerId))
    }
    return state
  }

  it('deals wonders onto the board, not into any hand, once every civ is revealed', () => {
    const state = revealEveryCiv(firstCivGame())

    expect(state.players.every((p) => p.civilization !== null)).toBe(true)
    expect(state.wondersDealt).toBe(true)
    // No wonder sits in any hand ...
    for (const player of state.players) {
      expect(player.items.some((item) => item.kind === 'wonder')).toBe(false)
    }
    // ... they are on the board instead.
    expect(state.board.pieces.some((piece) => piece.category === 'wonder')).toBe(true)
  })

  it('credits the automatic wonder deal to System, not the last revealer', () => {
    const state = revealEveryCiv(firstCivGame())
    const wonderLines = state.log.filter((entry) =>
      /drew .+ and placed it in the Wonders area/.test(entry.publicLog),
    )
    expect(wonderLines).toHaveLength(4)
    for (const entry of wonderLines) {
      expect(entry.username).toBe('System')
      expect(entry.publicLog.startsWith('System: ')).toBe(true)
    }
    // The deal belongs to the game, so none of it is credited to a player.
    expect(wonderLines.some((entry) => entry.username !== 'System')).toBe(false)
  })

  it('a wonder placed from the palette does not cancel the start-of-game deal', () => {
    // A moderator decorates the board with wonder art before setup finishes.
    let state = unwrap(
      placePiece(firstCivGame(), { playerId: CASH1981, assetId: 'wonders/bigben', x: 0, y: 0 }),
    )
    expect(state.board.pieces.some((piece) => piece.category === 'wonder')).toBe(true)
    // The decorative piece must not mark the wonders as dealt ...
    expect(state.wondersDealt).toBe(false)

    // ... so the deal still runs when the last civilization is revealed.
    state = revealEveryCiv(state)
    expect(state.wondersDealt).toBe(true)
    for (const player of state.players) {
      expect(player.items.some((item) => item.kind === 'wonder')).toBe(false)
    }
  })
})

/** Java: `PlayerAction.chooseSocialPolicy`. */
describe('social policy', () => {
  it('chooses a card and keeps it hidden in public', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))

    expect(findPlayer(state, CASH1981)?.socialPolicies.map((p) => p.name)).toEqual([policy.name])
    expect(state.log.at(-1)?.publicLog).toContain('has chosen a hidden social policy')
    expect(state.log.at(-1)?.publicLog).not.toContain(policy.name)
  })

  it('allocates a non-zero item number for the chosen card', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    expect(findPlayer(state, CASH1981)?.socialPolicies[0]?.itemNumber).toBeGreaterThan(
      policy.itemNumber,
    )
  })

  it('the same card twice is refused', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    const error = unwrapErr(chooseSocialPolicy(state, { playerId: CASH1981, name: policy.name }))
    expect(error).toEqual({ kind: 'SOCIAL_POLICY_ALREADY_CHOSEN', name: policy.name })
  })

  it('the flipside of a card you hold cannot be chosen', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies.find(
      (candidate) =>
        candidate.flipside !== null &&
        game.socialPolicies.some((other) => other.name === candidate.flipside),
    )
    if (policy?.flipside == null) throw new Error('found no card pair in the data set')

    const state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    const error = unwrapErr(
      chooseSocialPolicy(state, { playerId: CASH1981, name: policy.flipside }),
    )
    expect(error.kind).toBe('SOCIAL_POLICY_FLIPSIDE_TAKEN')
  })

  it('reveals a chosen card, which then shows in the public log', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    let state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    state = unwrap(revealSocialPolicy(state, { playerId: CASH1981, name: policy.name }))

    expect(findPlayer(state, CASH1981)?.socialPolicies[0]?.hidden).toBe(false)
    expect(state.log.at(-1)?.publicLog).toContain(policy.name)
  })

  it('keeps one item number through choose, reveal and removal, then allocates a new one', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    let state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    const firstChoice = findPlayer(state, CASH1981)?.socialPolicies[0]
    if (firstChoice === undefined) throw new Error('policy was not chosen')
    const firstNumber = uniqueItemNumber('cash1981', firstChoice.itemNumber)
    expect(state.log.at(-1)?.privateLog).toContain(firstNumber)

    state = unwrap(revealSocialPolicy(state, { playerId: CASH1981, name: policy.name }))
    expect(state.log.at(-1)?.privateLog).toContain(firstNumber)
    expect(state.log.at(-1)?.publicLog).toContain(firstNumber)

    state = unwrap(removeSocialPolicy(state, { playerId: CASH1981, name: policy.name }))
    expect(state.log.at(-1)?.privateLog).toContain(firstNumber)

    state = unwrap(chooseSocialPolicy(state, { playerId: CASH1981, name: policy.name }))
    const secondChoice = findPlayer(state, CASH1981)?.socialPolicies[0]
    if (secondChoice === undefined) throw new Error('policy was not chosen again')
    expect(secondChoice.itemNumber).not.toBe(firstChoice.itemNumber)
    expect(state.log.at(-1)?.privateLog).toContain(
      uniqueItemNumber('cash1981', secondChoice.itemNumber),
    )
  })

  it('a card you have not chosen gives ITEM_NOT_FOUND', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const error = unwrapErr(revealSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })

  it('removes a chosen card, makes it available again and logs the removal', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const chosen = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    const state = unwrap(removeSocialPolicy(chosen, { playerId: CASH1981, name: policy.name }))

    expect(findPlayer(state, CASH1981)?.socialPolicies).toHaveLength(0)
    expect(state.socialPolicies.some((candidate) => candidate.name === policy.name)).toBe(true)
    expect(state.log.at(-1)?.logType).toBe('REMOVED_SOCIAL_POLICY')
    expect(state.log.at(-1)?.privateLog).toContain(policy.name)
    expect(state.log.at(-1)?.publicLog).toContain('has removed a hidden social policy')
    expect(state.log.at(-1)?.publicLog).not.toContain(policy.name)
  })

  it('cannot remove another player\'s chosen card', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')

    const chosen = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    const error = unwrapErr(removeSocialPolicy(chosen, { playerId: CHUL, name: policy.name }))

    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })
})

/** Java: `PlayerAction.tradeToPlayer`. */
describe('trade', () => {
  it('gives a tradable item to another player and logs both sides', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handOf(state, CASH1981)[0]
    if (card === undefined) throw new Error('no culture card')

    state = unwrap(
      tradeToPlayer(state, {
        playerId: CASH1981,
        targetPlayerId: ITCHI,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
        name: itemName(card),
      }),
    )

    expect(handOf(state, CASH1981)).toHaveLength(0)
    expect(handOf(state, ITCHI).map((item) => item.id)).toEqual([card.id])
    expect(handOf(state, ITCHI)[0]?.ownerId).toBe(ITCHI)
    // Java: the first entry is attributed to the receiver
    expect(state.log.at(-2)?.username).toBe('Itchi')
    expect(state.log.at(-1)?.username).toBe('cash1981')
    expect(state.log.at(-1)?.publicLog).toBe('')
  })

  it('items that are not Tradable cannot be traded', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'ANCIENT_WONDERS' }))
    const wonder = handOf(state, CASH1981)[0]
    if (wonder === undefined) throw new Error('no wonder')

    const error = unwrapErr(
      tradeToPlayer(state, {
        playerId: CASH1981,
        targetPlayerId: ITCHI,
        sheetName: 'ANCIENT_WONDERS',
        name: itemName(wonder),
      }),
    )
    expect(error.kind).toBe('ITEM_NOT_FOUND')
  })
})

/** Java: `PlayerAction.discardItem`. */
describe('discarding', () => {
  it('moves the item to discardedItems and hides it', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handOf(state, CASH1981)[0]
    if (card === undefined) throw new Error('no culture card')

    state = unwrap(
      discardItem(state, {
        playerId: CASH1981,
        sheetName: 'CULTURE_1',
        itemNumber: card.itemNumber,
        name: itemName(card),
      }),
    )

    expect(handOf(state, CASH1981)).toHaveLength(0)
    expect(state.discardedItems.map((item) => item.id)).toEqual([card.id])
    expect(state.discardedItems[0]?.hidden).toBe(true)
    // Java: DISCARD reveals everything publicly too, the card is out of play
    expect(state.log.at(-1)?.publicLog).toContain(itemName(card))
  })
})

/**
 * New mechanic, with no Java counterpart — see
 * `docs/agents/tasks/great-person-discard.md`.
 */
describe('discardRandomGreatPerson', () => {
  /** Puts `count` Great Persons of one type into the player's hand. */
  const giveGreatPersons = (
    state: GameState,
    playerId: string,
    type: string,
    count: number,
  ): { readonly state: GameState; readonly ids: readonly string[] } => {
    const player = findPlayer(state, playerId)
    if (player === undefined) throw new Error('no player')
    const cards = state.items
      .filter((item) => item.kind === 'greatperson' && item.type === type)
      .slice(0, count)
    const taken = new Set(cards.map((card) => card.id))
    return {
      // Take the cards out of the deck too, so the fixture cannot mask a
      // reducer that removed from the deck instead of the hand.
      state: withPlayer(
        { ...state, items: state.items.filter((item) => !taken.has(item.id)) },
        { ...player, items: [...player.items, ...cards] },
      ),
      ids: cards.map((card) => card.id),
    }
  }

  it('removes one card of the type, discards it and logs DISCARD', () => {
    const { state, ids } = giveGreatPersons(firstCivGame(), CASH1981, 'General', 3)
    const after = unwrap(discardRandomGreatPerson(state, { playerId: CASH1981, type: 'General' }))

    expect(after.discardedItems).toHaveLength(1)
    expect(ids).toContain(after.discardedItems[0]?.id)
    expect(after.discardedItems[0]?.kind).toBe('greatperson')
    expect(after.discardedItems[0]?.hidden).toBe(true)
    expect(handOf(after, CASH1981)).toHaveLength(2)
    // The stored RNG must be the shuffle's next state, then advanced once more
    // by the log entry's id. `after.rng !== state.rng` alone would be vacuous:
    // the log's `nextId` advances the RNG anyway, so the assertion would pass
    // even if the shuffle's advance were dropped. Compare against both.
    const candidates = handOf(state, CASH1981).filter(
      (item) => item.kind === 'greatperson' && item.type === 'General',
    )
    const [, shuffledRng] = shuffle(candidates, state.rng)
    const [, afterStoredShuffle] = nextId(shuffledRng)
    const [, afterDroppedShuffle] = nextId(state.rng)
    expect(after.rng).toBe(afterStoredShuffle)
    expect(after.rng).not.toBe(afterDroppedShuffle)
    expect(after.log.at(-1)?.logType).toBe('DISCARD')
    // The random discard says so, like the loot lines; DISCARD still reveals
    // the card, so the public line names the type too.
    expect(after.log.at(-1)?.publicLog).toContain('has randomly discarded')
    expect(after.log.at(-1)?.publicLog).toContain('General')
  })

  it('picks across all candidates rather than always the first', () => {
    // The seeds are fixed, so this cannot pass by luck: the same seeds always
    // produce the same picks. See `conventions.md` on avoiding lucky tests.
    const { state, ids } = giveGreatPersons(firstCivGame(), CASH1981, 'General', 3)
    const picked = new Set<string>()
    for (let rng = 0; rng < 40; rng++) {
      const after = unwrap(
        discardRandomGreatPerson({ ...state, rng }, { playerId: CASH1981, type: 'General' }),
      )
      picked.add(after.discardedItems[0]?.id ?? '')
    }
    expect(picked).toEqual(new Set(ids))
  })

  it('leaves Great Persons of another type in the hand', () => {
    const withGenerals = giveGreatPersons(firstCivGame(), CASH1981, 'General', 2).state
    const { state, ids: scientistIds } = giveGreatPersons(
      withGenerals,
      CASH1981,
      'Scientist',
      1,
    )
    const after = unwrap(discardRandomGreatPerson(state, { playerId: CASH1981, type: 'General' }))

    const remaining = handOf(after, CASH1981)
    expect(remaining).toHaveLength(2)
    expect(remaining.some((item) => item.id === scientistIds[0])).toBe(true)
  })

  it('gives NOTHING_TO_DISCARD when the player holds none of the type', () => {
    const error = unwrapErr(
      discardRandomGreatPerson(firstCivGame(), { playerId: CASH1981, type: 'General' }),
    )
    expect(error).toEqual({ kind: 'NOTHING_TO_DISCARD', playerId: CASH1981, type: 'General' })
  })

  it('refuses a player who is not in the game', () => {
    const error = unwrapErr(
      discardRandomGreatPerson(firstCivGame(), { playerId: 'player-nobody', type: 'General' }),
    )
    expect(error.kind).toBe('NO_ACCESS')
  })
})

/** Java: `PlayerAction.endTurn` and `takeTurnButton`. */
describe('changing turn', () => {
  it('returns GAME_NOT_STARTED for a legacy zero-numbered game rather than guessing an index', () => {
    const before = firstCivGame()
    const legacy = {
      ...before,
      players: before.players.map((player) => ({ ...player, playernumber: 0 })),
    }

    const result = endTurn(legacy, { playerId: CASH1981, username: 'cash1981' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('GAME_NOT_STARTED')
  })

  it('returns GAME_NOT_STARTED when no player has the turn yet', () => {
    const before = firstCivGame()
    const unstarted = {
      ...before,
      players: before.players.map((player) => ({ ...player, yourTurn: false })),
    }

    const result = endTurn(unstarted)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('GAME_NOT_STARTED')
  })

  it('gives the turn to the next player number', () => {
    const before = firstCivGame()
    expect(isYourTurn(before, CASH1981)).toBe(true)

    const after = unwrap(endTurn(before))
    expect(isYourTurn(after, CASH1981)).toBe(false)
    expect(isYourTurn(after, KARANDRAS1)).toBe(true)
  })

  it('wraps back to the first player after the last', () => {
    let state = firstCivGame()
    for (let i = 0; i < 4; i++) state = unwrap(endTurn(state))

    expect(isYourTurn(state, CASH1981)).toBe(true)
    expect(state.players.filter((player) => player.yourTurn)).toHaveLength(1)
  })

  it('takeTurn takes the turn from anyone', () => {
    const state = unwrap(takeTurn(firstCivGame(), CHUL))

    expect(isYourTurn(state, CHUL)).toBe(true)
    expect(isYourTurn(state, CASH1981)).toBe(false)
    expect(state.log.at(-1)?.publicLog).toBe('Chul took turn button')
  })
})

/** Java: `PlayerAction.saveNote` — the note is private. */
describe('gamenote', () => {
  it('is stored on the hand of the player and stays out of the log', () => {
    const state = unwrap(saveNote(firstCivGame(), CASH1981, 'remember to buy a bank'))

    expect(findPlayer(state, CASH1981)?.gamenote).toBe('remember to buy a bank')
    expect(JSON.stringify(state.log)).not.toContain('remember to buy a bank')
  })
})
