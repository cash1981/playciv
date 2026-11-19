/**
 * What a civilization gets when its player first reveals a tech (the one place every tech gain funnels through:
 * `revealTech`). The starting tech is set at the civ reveal and never comes here ("after setup").
 *
 * - Germans: for each unit type the tech upgrades or unlocks, one free unit card of that type, and one resource of
 *   their choice from the market. The resource is taken from the market by hand, as every token is, so it only
 *   gets a public reminder line and nothing to undo.
 * - Greeks: 1 culture for each other player who has not chosen the tech (a hidden choice counts as knowing or researching it).
 *
 * Every effect is kept in `techRevealEffects` (server only) so that taking the tech back takes them back.
 */

import { drawCandidates, shuffleSheetTwice } from './assisted-culture.js'
import { UNIT_LEVEL_TECHS } from './build-item.js'
import type { UnitType } from './build-item.js'
import { unitSheetOf } from './build-options.js'
import { deckWith } from './item-number.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog, appendPublicLog } from './log.js'
import { SHEET_LABEL } from './sheet-name.js'
import type { GameState, TechRevealEffect } from './state.js'
import { findPlayer, withPlayer } from './state.js'

const GERMANS = 'Germans'
const GREEKS = 'Greeks'

/** The unit types a tech upgrades or unlocks: a level in `UNIT_LEVEL_TECHS` (also a lower one than the player has), or Flight. */
export function unitTypesOfTech(techName: string): readonly UnitType[] {
  const types = (Object.keys(UNIT_LEVEL_TECHS) as Exclude<UnitType, 'aircraft'>[]).filter((type) =>
    Object.hasOwn(UNIT_LEVEL_TECHS[type], techName),
  )
  return techName === 'Flight' ? [...types, 'aircraft'] : types
}

/** Applies the civilization's effect of the first reveal of `techName`. */
export function applyTechRevealAbilities(state: GameState, playerId: string, techName: string): GameState {
  const player = findPlayer(state, playerId)
  if (player === undefined) return state
  const civ = player.civilization?.name
  let next = state

  if (civ === GREEKS) {
    // Players who know the tech, or have it chosen (hidden or not, which is what researching is), are not counted; the other players only
    const culture = state.players.filter(
      (other) =>
        other.playerId !== playerId &&
        !other.techsChosen.some((tech) => tech.name === techName),
    ).length
    if (culture === 0) return state
    const holder = findPlayer(next, playerId) ?? player
    next = withPlayer(next, { ...holder, stats: { ...holder.stats, culture: holder.stats.culture + culture } })
    next = appendPublicLog(next, player.username, player.playerId, `gains ${culture} (${holder.stats.culture + culture}) culture as the Greeks`)
    return recorded(next, { playerId, techName, culture, units: [] })
  }

  if (civ === GERMANS) {
    const types = unitTypesOfTech(techName)
    if (types.length === 0) return state
    const units: TechRevealEffect['units'][number][] = []
    for (const unitType of types) {
      const sheetName = unitSheetOf(unitType)
      const drawn = drawCandidates(next, sheetName, 1)
      const first = drawn.ok ? drawn.value.items[0] : undefined
      if (!drawn.ok || first === undefined) {
        next = appendPublicLog(next, player.username, player.playerId, `would build a free ${unitType} unit as the Germans, but no ${unitType} unit cards are left`)
        continue
      }
      const card: Item = { ...first, ownerId: playerId, hidden: true }
      const holder = findPlayer(drawn.value.state, playerId) ?? player
      next = withPlayer(drawn.value.state, { ...holder, items: [...holder.items, card] })
      next = appendPublicLog(next, player.username, player.playerId, `builds a free ${unitType} unit as the Germans (${techName})`)
      next = appendLog(next, {
        username: player.username,
        playerId,
        privateLog: `${player.username} drew ${itemName(card)} (${SHEET_LABEL[sheetName]}) for the free German ${unitType} unit`,
        publicLog: '',
      })
      units.push({ itemId: card.id, sheetName })
    }
    next = appendPublicLog(next, player.username, player.playerId, `may take one resource of their choice from the market as the Germans (${techName})`)
    return recorded(next, { playerId, techName, culture: 0, units })
  }
  return state
}

const recorded = (state: GameState, effect: TechRevealEffect): GameState => ({
  ...state,
  techRevealEffects: [...(state.techRevealEffects ?? []), effect],
})

/**
 * Takes back what the first reveal of the tech gave, when the tech is taken back. The culture goes back as far as it is
 * still there (never below 0), and a free unit card still in the hand or the battle hand goes back to its deck, which is
 * shuffled again. A line says what was really taken back: a gain that is spent, or a card that has left the hand, stays.
 */
export function undoTechRevealAbilities(state: GameState, playerId: string, techName: string): GameState {
  const effects = (state.techRevealEffects ?? []).filter((effect) => effect.playerId === playerId && effect.techName === techName)
  if (effects.length === 0) return state
  let next: GameState = {
    ...state,
    techRevealEffects: (state.techRevealEffects ?? []).filter((effect) => !effects.includes(effect)),
  }
  const said: string[] = []
  for (const effect of effects) {
    const holder = findPlayer(next, playerId)
    if (holder === undefined) continue
    const wanted = new Set(effect.units.map((unit) => unit.itemId))
    // The card is in the hand, and a unit drawn for a battle is a copy in the battle hand: both go
    const back = holder.items.filter((item) => wanted.has(item.id))
    const taken = Math.min(holder.stats.culture, effect.culture)
    next = withPlayer(next, {
      ...holder,
      items: holder.items.filter((item) => !wanted.has(item.id)),
      battlehand: holder.battlehand.filter((item) => !wanted.has(item.id)),
      stats: { ...holder.stats, culture: holder.stats.culture - taken },
    })
    if (back.length > 0) {
      next = { ...next, ...deckWith(next, back.map((item) => ({ ...item, hidden: true, ownerId: null }))) }
      for (const sheetName of new Set(back.map((item) => item.sheetName))) next = shuffleSheetTwice(next, sheetName)
    }
    if (effect.culture > 0) {
      said.push(taken === effect.culture ? `took back ${taken} culture` : `took back ${taken} of ${effect.culture} culture (the rest is spent)`)
    }
    if (effect.units.length > 0) {
      const lost = effect.units.length - back.length
      said.push(
        lost === 0
          ? `took back the free unit${back.length === 1 ? '' : 's'}`
          : `took back ${back.length} of ${effect.units.length} free units (${lost === 1 ? 'a card' : `${lost} cards`} could no longer be returned: ${lost === 1 ? 'it has' : 'they have'} left the hand)`,
      )
    }
  }
  const owner = findPlayer(next, playerId)
  return owner === undefined || said.length === 0
    ? next
    : appendPublicLog(next, owner.username, owner.playerId, `${said.join(' and ')}: the ${owner.civilization?.name ?? 'civilization'} ability for ${techName} goes with the tech`)
}
