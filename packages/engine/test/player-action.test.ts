/**
 * Port av testene som dekket `PlayerAction`.
 *
 * Java hadde ingen egen `PlayerActionTest`; dekningen kom via
 * `PlayerResourceTest` og `UndoActionTest.checkThatYouCanUndoTech`. Testene her
 * er skrevet mot Java-kildens faktiske oppførsel, med Java-metoden navngitt.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import {
  chooseSocialPolicy,
  chooseTech,
  discardItem,
  endTurn,
  isYourTurn,
  remainingTechsForPlayer,
  removeTech,
  revealItem,
  revealTech,
  revealedTechsForAllPlayers,
  saveNote,
  takeTurn,
  tradeToPlayer,
} from '../src/actions/player.js'
import type { CivItem } from '../src/item.js'
import { itemName } from '../src/item.js'
import { unwrap, unwrapErr } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer } from '../src/state.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const handOf = (state: GameState, playerId: string) =>
  findPlayer(state, playerId)?.items ?? []

/** Java: `PlayerAction.chooseTech` / `removeTech` / `revealTech`. */
describe('teknologi', () => {
  it('velger en teknologi og logger den skjult offentlig', () => {
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

  it('lar ikke state.techs bli forurenset av hvem som valgte hva', () => {
    // Java muterte teknologien i pbf.techs og la samme referanse i hånden
    const state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const inCatalogue = state.techs.find((tech) => tech.name === 'Navy')
    expect(inCatalogue?.ownerId).toBeNull()
  })

  it('samme teknologi to ganger avvises', () => {
    const state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const error = unwrapErr(chooseTech(state, { playerId: CASH1981, techName: 'Navy' }))
    expect(error).toEqual({ kind: 'TECH_ALREADY_CHOSEN', techName: 'Navy' })
  })

  it('ukjent teknologi gir ITEM_NOT_FOUND', () => {
    const error = unwrapErr(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Warp Drive' }))
    expect(error).toEqual({ kind: 'ITEM_NOT_FOUND' })
  })

  it('fjerner en valgt teknologi og logger REMOVED_TECH', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(removeTech(state, { playerId: CASH1981, techName: 'Navy' }))

    expect(findPlayer(state, CASH1981)?.techsChosen).toHaveLength(0)
    expect(state.log.at(-1)?.publicLog).toContain('has removed a hidden technology')
    expect(state.log.at(-1)?.publicLog).not.toContain('Navy')
  })

  it('avslører en teknologi, som da blir synlig for alle', () => {
    let state = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    state = unwrap(revealTech(state, { playerId: CASH1981, techName: 'Navy' }))

    expect(findPlayer(state, CASH1981)?.techsChosen[0]?.hidden).toBe(false)
    expect(state.log.at(-1)?.publicLog).toContain('Navy')
    expect(revealedTechsForAllPlayers(state)).toEqual([])
  })

  it('gjenstående teknologier utelater de valgte', () => {
    const before = firstCivGame()
    const total = remainingTechsForPlayer(before, CASH1981).length
    const after = unwrap(chooseTech(before, { playerId: CASH1981, techName: 'Navy' }))

    expect(remainingTechsForPlayer(after, CASH1981)).toHaveLength(total - 1)
    expect(remainingTechsForPlayer(after, CASH1981).some((t) => t.name === 'Navy')).toBe(false)
  })

  it('spiller uten tilgang avvises', () => {
    const error = unwrapErr(chooseTech(firstCivGame(), { playerId: 'ingen', techName: 'Navy' }))
    expect(error).toEqual({ kind: 'NO_ACCESS', playerId: 'ingen' })
  })
})

/** Java: `PlayerAction.revealItem`. */
describe('avslør item', () => {
  it('avslører en hut og logger innholdet offentlig', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = handOf(state, CASH1981)[0]
    if (hut === undefined) throw new Error('ingen hut')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'HUTS', itemNumber: hut.itemNumber }),
    )

    expect(handOf(state, CASH1981)[0]?.hidden).toBe(false)
    expect(state.log.at(-1)?.publicLog).toContain(itemName(hut))
  })

  it('finner itemet på navn når itemNumber ikke er oppgitt', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'VILLAGES' }))
    const village = handOf(state, CASH1981)[0]
    if (village === undefined) throw new Error('ingen village')

    state = unwrap(
      revealItem(state, { playerId: CASH1981, sheetName: 'VILLAGES', name: itemName(village) }),
    )
    expect(handOf(state, CASH1981)[0]?.hidden).toBe(false)
  })

  it('å avsløre samme item to ganger gir ITEM_ALREADY_REVEALED', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = handOf(state, CASH1981)[0]
    if (hut === undefined) throw new Error('ingen hut')

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
 * Java: sivilisasjonssekvensen i `revealItem`.
 *
 * Merk at `drawStartingItems` går gjennom `DrawAction.draw`, som krever at det
 * er spillerens tur. I Java betyr det at bare spilleren som har turen kan
 * avsløre sin sivilisasjon og få startenheter. Se testen nederst.
 */
describe('avslør sivilisasjon', () => {
  const revealCivFor = (state: GameState, playerId: string) => {
    // Java filtrerer på isHidden når itemet skal finnes, så et allerede
    // avslørt civ-kort er usynlig for revealItem
    const civ = handOf(state, playerId).find((item) => item.kind === 'civ' && item.hidden)
    if (civ === undefined) throw new Error('ingen skjult civ i hånden')
    return revealItem(state, { playerId, sheetName: 'CIV', itemNumber: civ.itemNumber })
  }

  it('setter sivilisasjon, startteknologi og trekker startenheter', () => {
    let state = firstCivGame()
    // Java delte ut flere civ-kort som spilleren velger blant
    for (let i = 0; i < 3; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    }

    const chosen = handOf(state, CASH1981).find((item) => item.kind === 'civ') as CivItem
    state = unwrap(revealCivFor(state, CASH1981))

    const player = findPlayer(state, CASH1981)
    expect(player?.civilization?.name).toBe(chosen.name)
    // Startteknologien avsløres, den er offentlig kjent fra civ-kortet
    expect(player?.techsChosen.map((t) => t.name)).toEqual([chosen.startingTech.name])
    expect(player?.techsChosen[0]?.hidden).toBe(false)
  })

  it('kaster de andre civ-kortene til discardedItems', () => {
    let state = firstCivGame()
    for (let i = 0; i < 3; i++) {
      state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    }
    state = unwrap(revealCivFor(state, CASH1981))

    expect(handOf(state, CASH1981).filter((item) => item.kind === 'civ')).toHaveLength(1)
    expect(state.discardedItems.filter((item) => item.kind === 'civ')).toHaveLength(2)
    expect(state.discardedItems.every((item) => item.hidden)).toBe(true)
  })

  it('trekker tre enheter for en sivilisasjon uten spesialregel', () => {
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

  it('å avsløre samme civ-kort igjen gir ITEM_ALREADY_REVEALED', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    const civ = handOf(state, CASH1981).find((item) => item.kind === 'civ')
    if (civ === undefined) throw new Error('ingen civ')

    state = unwrap(revealCivFor(state, CASH1981))
    // Java leter bare blant skjulte items, så det avslørte kortet finnes ikke
    const error = unwrapErr(
      revealItem(state, { playerId: CASH1981, sheetName: 'CIV', itemNumber: civ.itemNumber }),
    )
    expect(error.kind).toBe('ITEM_ALREADY_REVEALED')
  })

  it('to sivilisasjoner kan ikke velges', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    state = unwrap(revealCivFor(state, CASH1981))

    // Et nytt, skjult civ-kort kommer forbi hidden-filteret og treffer civ-sjekken
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))
    const error = unwrapErr(revealCivFor(state, CASH1981))
    expect(error).toEqual({ kind: 'CIVILIZATION_ALREADY_CHOSEN', playerId: CASH1981 })
  })

  /**
   * Dette dokumenterer en reell begrensning arvet fra Java, ikke ønsket
   * oppførsel: startenhetene trekkes via DrawAction.draw, som krever tur.
   */
  it('en spiller som ikke har turen kan ikke avsløre sin sivilisasjon', () => {
    let state = firstCivGame()
    state = unwrap(draw(state, { playerId: CASH1981, sheetName: 'CIV' }))

    // Gi Karandras1 et civ-kort ved å flytte det manuelt, siden hen ikke kan trekke
    const civ = state.items.find((item) => item.kind === 'civ')
    if (civ === undefined) throw new Error('ingen civ i stokken')
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
})

/** Java: `PlayerAction.chooseSocialPolicy`. */
describe('sosialpolitikk', () => {
  it('velger et kort og skjuler det offentlig', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('ingen sosialpolitikk')

    const state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))

    expect(findPlayer(state, CASH1981)?.socialPolicies.map((p) => p.name)).toEqual([policy.name])
    expect(state.log.at(-1)?.publicLog).toContain('has chosen a hidden social policy')
    expect(state.log.at(-1)?.publicLog).not.toContain(policy.name)
  })

  it('itemNumber følger kortet, så loggnummeret er ikke null', () => {
    // Java lagde et nytt SocialPolicy-objekt, som ga itemNumber 0 og gjorde
    // det spillerspesifikke loggnummeret virkningsløst.
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('ingen sosialpolitikk')

    const state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    expect(findPlayer(state, CASH1981)?.socialPolicies[0]?.itemNumber).toBe(policy.itemNumber)
  })

  it('samme kort to ganger avvises', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('ingen sosialpolitikk')

    const state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    const error = unwrapErr(chooseSocialPolicy(state, { playerId: CASH1981, name: policy.name }))
    expect(error).toEqual({ kind: 'SOCIAL_POLICY_ALREADY_CHOSEN', name: policy.name })
  })

  it('baksiden av et kort man har kan ikke velges', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies.find(
      (candidate) =>
        candidate.flipside !== null &&
        game.socialPolicies.some((other) => other.name === candidate.flipside),
    )
    if (policy?.flipside == null) throw new Error('fant ingen kortpar i datasettet')

    const state = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    const error = unwrapErr(
      chooseSocialPolicy(state, { playerId: CASH1981, name: policy.flipside }),
    )
    expect(error.kind).toBe('SOCIAL_POLICY_FLIPSIDE_TAKEN')
  })
})

/** Java: `PlayerAction.tradeToPlayer`. */
describe('handel', () => {
  it('gir et tradable item til en annen spiller og logger begge sider', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handOf(state, CASH1981)[0]
    if (card === undefined) throw new Error('ingen kulturkort')

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
    // Java: den første posten tilskrives mottakeren
    expect(state.log.at(-2)?.username).toBe('Itchi')
    expect(state.log.at(-1)?.username).toBe('cash1981')
    expect(state.log.at(-1)?.publicLog).toBe('')
  })

  it('items som ikke er Tradable kan ikke handles', () => {
    const state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'ANCIENT_WONDERS' }))
    const wonder = handOf(state, CASH1981)[0]
    if (wonder === undefined) throw new Error('ingen wonder')

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
describe('kasting', () => {
  it('flytter itemet til discardedItems og skjuler det', () => {
    let state = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'CULTURE_1' }))
    const card = handOf(state, CASH1981)[0]
    if (card === undefined) throw new Error('ingen kulturkort')

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
    // Java: DISCARD avslører alt også offentlig, kortet er ute av spill
    expect(state.log.at(-1)?.publicLog).toContain(itemName(card))
  })
})

/** Java: `PlayerAction.endTurn` og `takeTurnButton`. */
describe('turskifte', () => {
  it('gir turen til neste spillernummer', () => {
    const before = firstCivGame()
    expect(isYourTurn(before, CASH1981)).toBe(true)

    const after = unwrap(endTurn(before))
    expect(isYourTurn(after, CASH1981)).toBe(false)
    expect(isYourTurn(after, KARANDRAS1)).toBe(true)
  })

  it('går rundt til første spiller etter siste', () => {
    let state = firstCivGame()
    for (let i = 0; i < 4; i++) state = unwrap(endTurn(state))

    expect(isYourTurn(state, CASH1981)).toBe(true)
    expect(state.players.filter((player) => player.yourTurn)).toHaveLength(1)
  })

  it('takeTurn tar turen fra hvem som helst', () => {
    const state = unwrap(takeTurn(firstCivGame(), CHUL))

    expect(isYourTurn(state, CHUL)).toBe(true)
    expect(isYourTurn(state, CASH1981)).toBe(false)
    expect(state.log.at(-1)?.publicLog).toBe('Chul took turn button')
  })
})

/** Java: `PlayerAction.saveNote` — notatet er privat. */
describe('gamenote', () => {
  it('lagres på spillerens hånd og havner ikke i loggen', () => {
    const state = unwrap(saveNote(firstCivGame(), CASH1981, 'husk å kjøpe bank'))

    expect(findPlayer(state, CASH1981)?.gamenote).toBe('husk å kjøpe bank')
    expect(JSON.stringify(state.log)).not.toContain('husk å kjøpe bank')
  })
})
