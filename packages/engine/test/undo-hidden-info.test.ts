/**
 * An undo names the item it puts back. Java wrote the full name for everyone,
 * so a hidden tech, a social policy or a drawn card was public the moment
 * somebody asked to take it back. Everything an opponent can read must be no
 * more than the original log line showed.
 */

import { describe, expect, it } from 'vitest'

import { draw } from '../src/actions/draw.js'
import { chooseSocialPolicy, chooseTech } from '../src/actions/player.js'
import { initiateUndo, playerPutsItemBackInDeck, vote } from '../src/actions/undo.js'
import { itemName } from '../src/item.js'
import { uniqueItemNumber } from '../src/log.js'
import { unwrap } from '../src/result.js'
import type { GameState } from '../src/state.js'
import { findPlayer, toPlayerView } from '../src/state.js'
import type { SheetName } from '../src/sheet-name.js'

import { CASH1981, CHUL, ITCHI, KARANDRAS1, firstCivGame } from './fixture.js'

const OTHERS = [KARANDRAS1, ITCHI, CHUL]

/** Every line an opponent can read, from the view and from the plain entries. */
function readByOpponent(state: GameState, viewerId: string): string {
  const fromView = toPlayerView(state, viewerId).log.map((entry) => JSON.stringify(entry))
  const fromEntries = state.log.map((entry) => entry.publicLog)
  return [...fromView, ...fromEntries].join('\n')
}

function undoWithAllVotes(state: GameState, logId: string): GameState {
  let next = unwrap(initiateUndo(state, { logId, playerId: CASH1981 }))
  for (const playerId of OTHERS) next = unwrap(vote(next, { logId, playerId, vote: true }))
  return next
}

describe('undo does not reveal hidden items', () => {
  it('a researched tech stays hidden through request, votes and result', () => {
    const chosen = unwrap(chooseTech(firstCivGame(), { playerId: CASH1981, techName: 'Navy' }))
    const tech = findPlayer(chosen, CASH1981)?.techsChosen[0]
    if (tech === undefined) throw new Error('no tech')
    const logId = chosen.log.at(-1)?.id as string

    const requested = unwrap(initiateUndo(chosen, { logId, playerId: CASH1981 }))
    expect(requested.log.at(-1)?.publicLog).toBe(
      `cash1981 has requested undo of  - a hidden technology${uniqueItemNumber('cash1981', tech.itemNumber)}`,
    )
    expect(requested.log.at(-1)?.privateLog).toContain('Navy')

    const voted = unwrap(vote(requested, { logId, playerId: KARANDRAS1, vote: true }))
    expect(voted.log.at(-1)?.publicLog).toBe(
      `Karandras1 has voted yes to undo a hidden technology with item number ${
        Number(uniqueItemNumber('cash1981', tech.itemNumber).split('#')[1])
      }`,
    )

    const done = undoWithAllVotes(chosen, logId)
    const result = done.log.at(-1)
    expect(result?.publicLog).toBe(
      `System: has removed a hidden technology from cash1981${uniqueItemNumber('cash1981', tech.itemNumber)}`,
    )
    // The owner still reads which tech it was
    expect(result?.playerId).toBe(CASH1981)
    expect(result?.privateLog).toContain('has removed Navy from cash1981')

    for (const viewer of OTHERS) {
      expect(readByOpponent(done, viewer)).not.toContain('Navy')
    }
    // Not even the catalogue number, which anyone can match against the tech list
    expect(readByOpponent(done, KARANDRAS1)).not.toContain(`#${tech.itemNumber}"`)
  })

  it('a chosen social policy does not show up in the vote line', () => {
    const game = firstCivGame()
    const policy = game.socialPolicies[0]
    if (policy === undefined) throw new Error('no social policy')
    const chosen = unwrap(chooseSocialPolicy(game, { playerId: CASH1981, name: policy.name }))
    const logId = chosen.log.at(-1)?.id as string

    const requested = unwrap(initiateUndo(chosen, { logId, playerId: CASH1981 }))
    const voted = unwrap(vote(requested, { logId, playerId: KARANDRAS1, vote: true }))

    expect(voted.log.at(-1)?.publicLog).toContain('a hidden social policy')
    expect(readByOpponent(voted, KARANDRAS1)).not.toContain(policy.name)
  })

  it.each<SheetName>(['CULTURE_1', 'CULTURE_2', 'CULTURE_3', 'GREAT_PERSON', 'INFANTRY', 'HUTS'])(
    'a drawn %s card keeps its name through an undo',
    (sheetName) => {
      const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName }))
      const card = findPlayer(drawn, CASH1981)?.items[0]
      if (card === undefined) throw new Error('no card')
      const logId = drawn.log.at(-1)?.id as string

      const done = undoWithAllVotes(drawn, logId)

      const result = done.log.at(-1)
      expect(result?.privateLog).toContain(itemName(card))
      expect(result?.playerId).toBe(CASH1981)
      for (const viewer of OTHERS) {
        expect(readByOpponent(done, viewer)).not.toContain(itemName(card))
      }
      // The requester reads the name in their own log, nobody else
      const request = done.log.find((entry) => entry.logType === 'UNDO')
      expect(request?.privateLog).toContain(itemName(card))
      expect(request?.publicLog).not.toContain(itemName(card))
    },
  )

  it('putting a card back in the deck yourself does not name it', () => {
    const drawn = unwrap(draw(firstCivGame(), { playerId: CASH1981, sheetName: 'HUTS' }))
    const hut = findPlayer(drawn, CASH1981)?.items[0]
    if (hut === undefined) throw new Error('no hut')

    const after = unwrap(
      playerPutsItemBackInDeck(drawn, {
        playerId: CASH1981,
        sheetName: 'HUTS',
        name: itemName(hut),
      }),
    )

    expect(after.log.at(-1)?.privateLog).toContain(itemName(hut))
    expect(readByOpponent(after, KARANDRAS1)).not.toContain(itemName(hut))
  })
})
