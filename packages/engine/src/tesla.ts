/**
 * Nikola Tesla (issue #301): "Research: You may discard this card when adding a tech of level II, III, or IV to your
 * tech pyramid to place it one level lower in the pyramid than normal."
 *
 * The human (2026-11-03): the tech must still be paid for as its own level. A level III tech costs 16 trade, so a
 * player needs 16 trade to put one in the level II row, even though it sits one row lower. The move itself is the one
 * a player can already make by hand (`setTechSlot`): the row a tech is shown in, while its `level` stays as it is.
 *
 * "Adding" is read as a tech chosen in this Research phase, the same test the trade kept as coins uses
 * (`researchTurns`). The lower row must have a free place: the rows hold 5, 4, 3, 2 and 1 techs from level I to V,
 * and a Great Person placed by Sir Isaac Newton fills a place too.
 */

import { openResearchTurnOf, withTechSlot } from './actions/player.js'
import { withPlayerHand } from './assisted-core.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { GameState, Playerhand } from './state.js'
import type { TechItem } from './item.js'

export const TESLA_NAME = 'Nikola Tesla'

type Row = 1 | 2 | 3 | 4 | 5

/** The trade a tech of each level costs to research (the old client's tooltips): the level I row is the base. */
export const RESEARCH_TRADE: Readonly<Record<Row, number | null>> = { 1: 6, 2: 11, 3: 16, 4: 21, 5: null }

/** How many techs each row of the pyramid holds: 5 at the base, narrowing to 1 at the apex. */
export const PYRAMID_ROW_SIZE: Readonly<Record<Row, number>> = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 }

/** What an undo needs: the tech, the row it was in before (null when it had none of its own) and the row Tesla put it in. */
export interface TeslaEffect {
  readonly techName: string
  readonly from: Row | null
  readonly to: Row
}

/** A tech Tesla can put one row lower now, with the trade it needs and the row it goes to. */
export interface TeslaChoice {
  readonly name: string
  readonly level: Row
  readonly trade: number
  readonly to: Row
}

const rowOf = (tech: TechItem): Row => tech.slot ?? tech.level

/** Places taken in a pyramid row: the techs shown there and the Great Persons placed there. */
function placesTaken(player: Playerhand, row: Row): number {
  return (
    player.techsChosen.filter((tech) => rowOf(tech) === row).length +
    player.pyramidPlacements.filter((placement) => placement.slot === row).length
  )
}

/** Why one tech cannot be lowered, or `undefined` when it can. */
function refusalFor(player: Playerhand, tech: TechItem, researchTurn: number | null): string | undefined {
  if (tech.level < 2 || tech.level > 4) return `${tech.name} is a level ${tech.level} tech. Tesla places a tech of level II, III or IV.`
  if (researchTurn === null || player.researchTurns[tech.name] !== researchTurn) {
    return `${tech.name} was not added to your pyramid in this Research phase.`
  }
  if (tech.slot !== undefined && tech.slot !== tech.level) return `${tech.name} is already in a different row than its level.`
  const trade = RESEARCH_TRADE[tech.level]
  if (trade !== null && player.stats.trade < trade) {
    return `${tech.name} is a level ${tech.level} tech, which needs ${trade} trade to research. You have ${player.stats.trade}.`
  }
  const to = (tech.level - 1) as Row
  if (placesTaken(player, to) >= PYRAMID_ROW_SIZE[to]) {
    return `The level ${to} row of your pyramid is full, so ${tech.name} has no place one level lower.`
  }
  return undefined
}

/** The techs Tesla can place one level lower now. Own view only: a hidden tech is named. */
export function teslaChoicesOf(state: GameState, player: Playerhand): readonly TeslaChoice[] {
  const researchTurn = openResearchTurnOf(state, player)
  return player.techsChosen.flatMap((tech): readonly TeslaChoice[] =>
    refusalFor(player, tech, researchTurn) === undefined
      ? [{ name: tech.name, level: tech.level as Row, trade: RESEARCH_TRADE[tech.level] ?? 0, to: (tech.level - 1) as Row }]
      : [],
  )
}

/** Why Tesla cannot be played now, naming what is wrong with each tech of level II to IV the player has, or `undefined`. */
export function teslaBlock(state: GameState, player: Playerhand): string | undefined {
  if (teslaChoicesOf(state, player).length > 0) return undefined
  const researchTurn = openResearchTurnOf(state, player)
  const candidates = player.techsChosen.filter(
    (tech) => tech.level >= 2 && tech.level <= 4 && researchTurn !== null && player.researchTurns[tech.name] === researchTurn,
  )
  if (candidates.length === 0) {
    return 'Tesla places a tech of level II, III or IV that you have just added to your pyramid in Research.'
  }
  return candidates.map((tech) => refusalFor(player, tech, researchTurn)).filter((reason) => reason !== undefined).join(' ')
}

/** Puts the chosen tech one row lower. `Err` is a sentence for the player. */
export function applyTesla(
  state: GameState,
  player: Playerhand,
  techName: string | undefined,
): Result<{ readonly state: GameState; readonly effect: TeslaEffect; readonly tech: TechItem }, string> {
  if (techName === undefined) return err('Choose the tech to place one level lower.')
  const tech = player.techsChosen.find((candidate) => candidate.name === techName)
  if (tech === undefined) return err('That tech is not in your pyramid.')
  const refusal = refusalFor(player, tech, openResearchTurnOf(state, player))
  if (refusal !== undefined) return err(refusal)
  const to = (tech.level - 1) as Row
  return ok({
    state: withPlayerHand(state, withTechSlot(player, tech.name, to)),
    effect: { techName: tech.name, from: tech.slot ?? null, to },
    tech,
  })
}

/** Why Tesla's move cannot be undone, or `undefined`: the tech must still be where the card put it. */
export function teslaUndoBlock(player: Playerhand, effect: TeslaEffect): string | undefined {
  const tech = player.techsChosen.find((candidate) => candidate.name === effect.techName)
  if (tech === undefined) return `${effect.techName} has left your pyramid, so Nikola Tesla cannot be undone.`
  if (tech.slot !== effect.to) return `${effect.techName} has been moved to another row since. Move it back first.`
  return undefined
}

/** The move taken back: the tech is shown in the row it had before. */
export function undoTesla(state: GameState, player: Playerhand, effect: TeslaEffect): GameState {
  return withPlayerHand(state, withTechSlot(player, effect.techName, effect.from))
}
