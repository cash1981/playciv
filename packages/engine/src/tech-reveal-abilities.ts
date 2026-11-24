/**
 * What a civilization gets when its player first reveals a tech (the one place every tech gain funnels through:
 * `revealTech`). The starting tech is set at the civ reveal and never comes here ("after setup").
 *
 * - Germans: for each unit type the tech upgrades or unlocks, one free unit card of that type, and one resource of
 *   their choice from the market. The resource is taken from the market by hand, as every token is, so it only
 *   gets a public reminder line and nothing to undo.
 * - Greeks: 1 culture for each other player who does not have the tech revealed. Only what is public counts: a hidden
 *   choice of another player is not counted, so the amount never tells whether they are researching the same tech (the
 *   Greeks may get one more than the card says when another player chose the tech and has not revealed it yet).
 *
 * Every effect is kept in `techRevealEffects` (server only) so that taking the tech back takes them back. The reward is
 * paid once per reveal chain: when a take-back cannot recover all of it (culture that is spent, a unit card that left
 * the hand) a `paid` record stays, and revealing the tech again pays nothing more. A complete take-back leaves no
 * record, so the next reveal pays again.
 */

import { drawCandidates, shuffleSheetTwice } from './assisted-culture.js'
import { UNIT_LEVEL_TECHS } from './build-item.js'
import type { UnitType } from './build-item.js'
import { unitSheetOf } from './build-options.js'
import { deckWith } from './item-number.js'
import { isUnit, itemName } from './item.js'
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

/** Whether the player's reward for the tech stays paid: an earlier take-back could not recover all of it (see `undoTechRevealAbilities`). */
const isPaid = (state: GameState, playerId: string, techName: string): boolean =>
  (state.techRevealEffects ?? []).some((effect) => effect.paid === true && effect.playerId === playerId && effect.techName === techName)

/** Applies the civilization's effect of the first reveal of `techName`. */
export function applyTechRevealAbilities(state: GameState, playerId: string, techName: string): GameState {
  const player = findPlayer(state, playerId)
  if (player === undefined) return state
  const civ = player.civilization?.name
  if (civ !== GREEKS && civ !== GERMANS) return state
  // An earlier take-back could not recover all of the reward: it was paid once and stays paid
  if (isPaid(state, playerId, techName)) {
    return appendPublicLog(state, player.username, player.playerId, `gets nothing for ${techName} as the ${civ}: the ability was already paid when the tech was revealed before`)
  }
  let next = state

  if (civ === GREEKS) {
    // Only what is public counts: another player who has the tech revealed. A hidden choice is not counted, so the
    // amount does not tell whether another player is researching the same tech
    const culture = state.players.filter(
      (other) =>
        other.playerId !== playerId &&
        !other.techsChosen.some((tech) => tech.name === techName && tech.hidden === false),
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
 * shuffled again; a unit card that stood in the arena comes back without its battle lock. A line says what was really
 * taken back: a gain that is spent, or a card that has left the hand, stays.
 *
 * When not everything could be taken back, a `paid` record is left: the reward was paid once, so revealing the tech again
 * pays nothing more (otherwise the player could farm it by spending the gain and removing the tech). A `paid` record is
 * never removed by a later take-back. A complete take-back leaves no record, so the next reveal pays again.
 */
export function undoTechRevealAbilities(state: GameState, playerId: string, techName: string): GameState {
  const effects = (state.techRevealEffects ?? []).filter((effect) => effect.playerId === playerId && effect.techName === techName && effect.paid !== true)
  if (effects.length === 0) return state
  let next: GameState = {
    ...state,
    techRevealEffects: (state.techRevealEffects ?? []).filter((effect) => !effects.includes(effect)),
  }
  const said: string[] = []
  let complete = true
  for (const effect of effects) {
    const holder = findPlayer(next, playerId)
    if (holder === undefined) continue
    const wanted = new Set(effect.units.map((unit) => unit.itemId))
    // The card is in the hand, and a unit drawn for a battle is a copy in the battle hand: both go
    const back = holder.items.filter((item) => wanted.has(item.id))
    const taken = Math.min(holder.stats.culture, effect.culture)
    if (taken < effect.culture || back.length < effect.units.length) complete = false
    next = withPlayer(next, {
      ...holder,
      items: holder.items.filter((item) => !wanted.has(item.id)),
      battlehand: holder.battlehand.filter((item) => !wanted.has(item.id)),
      stats: { ...holder.stats, culture: holder.stats.culture - taken },
    })
    if (back.length > 0) {
      next = {
        ...next,
        ...deckWith(
          next,
          // A unit placed in the arena was flagged `inBattle`: the card must not keep the lock in the deck
          back.map((item) => ({ ...item, hidden: true, ownerId: null, ...(isUnit(item) ? { inBattle: false } : {}) })),
        ),
      }
      for (const sheetName of new Set(back.map((item) => item.sheetName))) next = shuffleSheetTwice(next, sheetName)
    }
    if (effect.culture > 0) {
      const left = holder.stats.culture - taken
      said.push(taken === effect.culture ? `took back ${taken} (${left}) culture` : `took back ${taken} of ${effect.culture} (${left}) culture (the rest is spent)`)
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
  if (!complete && !isPaid(next, playerId, techName)) {
    next = recorded(next, { playerId, techName, culture: 0, units: [], paid: true })
  }
  return owner === undefined || said.length === 0
    ? next
    : appendPublicLog(
        next,
        owner.username,
        owner.playerId,
        `${said.join(' and ')}: the ${owner.civilization?.name ?? 'civilization'} ability for ${techName} goes with the tech${complete ? '' : ' (it is not paid again if the tech is revealed again)'}`,
      )
}
