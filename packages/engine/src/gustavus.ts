/**
 * Gustavus Adolphus (issue #301): "kill all units in your battle force and build an equal number of unlocked units
 * for free, immediately adding them to your battle force."
 *
 * The human (2026-11-02): it happens before the battle starts; you only discard the units you have drawn, to draw new
 * ones of other types, as many as you discarded. So the battle force is the battlehand: the units drawn for the
 * battle and not yet placed in an arena. They go to the discard pile, and one new unit card is drawn into the hand
 * and the battlehand for each, from the deck of the type the player chose (infantry, mounted, artillery, and aircraft
 * with Flight). The arena is not touched, so no battle need be on.
 */

import { playerSideOf } from './battle-cards.js'
import { drawCandidates, shuffleSheetTwice } from './assisted-culture.js'
import { playerOf, withPlayerHand } from './assisted-core.js'
import { isUnit, itemName } from './item.js'
import type { Item, UnitItem } from './item.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { SheetName } from './sheet-name.js'
import type { GameState, Playerhand } from './state.js'

const SHEET_NOUN: Readonly<Partial<Record<SheetName, string>>> = {
  INFANTRY: 'infantry',
  MOUNTED: 'mounted',
  ARTILLERY: 'artillery',
  AIRCRAFT: 'aircraft',
}

/** The type of a unit, as the public log gives it: "Artillery", without the card's numbers. */
const typeName = (unit: UnitItem): string => `${unit.kind.charAt(0).toUpperCase()}${unit.kind.slice(1)}`

/** The unit decks the player may build from: aircraft only once Flight is known. */
export function gustavusSheetsOf(player: Playerhand): readonly SheetName[] {
  const flight = player.techsChosen.some((tech) => tech.name === 'Flight' && !tech.hidden)
  return flight ? ['INFANTRY', 'MOUNTED', 'ARTILLERY', 'AIRCRAFT'] : ['INFANTRY', 'MOUNTED', 'ARTILLERY']
}

/**
 * The battle force Gustavus replaces: the units drawn for a battle and not placed in the arena, as they are in the
 * hand. A battlehand entry whose card has left the hand (discarded by hand, which leaves the entry) is not one.
 */
export const gustavusForceOf = (player: Playerhand): readonly UnitItem[] =>
  player.battlehand.flatMap((entry): readonly UnitItem[] => {
    const held = player.items.find((item) => item.id === entry.id)
    return held !== undefined && isUnit(held) && !held.inBattle && !entry.inBattle ? [held] : []
  })

/** How many units the card replaces and the decks it can build from. */
export function gustavusChoiceOf(player: Playerhand): { readonly count: number; readonly sheets: readonly SheetName[] } {
  return { count: gustavusForceOf(player).length, sheets: gustavusSheetsOf(player) }
}

/** Why the player cannot play Gustavus now, or `undefined`: he needs units drawn, and in a battle that is the player's own. */
export function gustavusBlock(state: GameState, player: Playerhand): string | undefined {
  if (gustavusForceOf(player).length === 0) return 'You have no units drawn for a battle to discard.'
  if (state.battle !== null && playerSideOf(state.battle, player.playerId) === null) return 'You are not fighting in this battle.'
  return undefined
}

export interface AppliedGustavus {
  readonly state: GameState
  readonly effect: {
    readonly discarded: readonly UnitItem[]
    readonly drew: readonly { readonly itemId: string; readonly sheetName: SheetName }[]
  }
  readonly said: string
  readonly privateLines: readonly string[]
}

/** Carries the card out, or says in a sentence why it cannot be (then nothing has changed). */
export function applyGustavus(
  state: GameState,
  player: Playerhand,
  sheets: readonly string[] | undefined,
): Result<AppliedGustavus, string> {
  const discarded = gustavusForceOf(player)
  const count = discarded.length
  const allowed = gustavusSheetsOf(player)
  const chosen = (sheets ?? []).filter((sheet): sheet is SheetName => (allowed as readonly string[]).includes(sheet))
  if (sheets === undefined || sheets.length !== count || chosen.length !== count) {
    return err(`Choose the unit type for each of the ${count} units to build: ${allowed.map((sheet) => SHEET_NOUN[sheet]).join(', ')}.`)
  }

  const discardedIds = new Set(discarded.map((unit) => unit.id))
  let next: GameState = withPlayerHand(state, {
    ...player,
    battlehand: player.battlehand.filter((unit) => !discardedIds.has(unit.id)),
    items: player.items.filter((item) => !discardedIds.has(item.id)),
  })
  next = { ...next, discardedItems: [...next.discardedItems, ...discarded.map((unit): Item => ({ ...unit, hidden: true }))] }

  const drew: { itemId: string; sheetName: SheetName }[] = []
  const built: UnitItem[] = []
  for (const sheetName of chosen) {
    const drawn = drawCandidates(next, sheetName, 1)
    const first = drawn.ok ? drawn.value.items[0] : undefined
    if (!drawn.ok || first === undefined || !isUnit(first)) {
      return err(`No ${SHEET_NOUN[sheetName]} unit cards are left in the deck or the discard pile.`)
    }
    const card: UnitItem = { ...first, ownerId: player.playerId, hidden: true }
    const holder = playerOf(drawn.value.state, player.playerId) ?? player
    next = withPlayerHand(drawn.value.state, {
      ...holder,
      items: [...holder.items, card],
      battlehand: [...holder.battlehand, card],
    })
    drew.push({ itemId: card.id, sheetName })
    built.push(card)
  }

  return ok({
    state: next,
    effect: { discarded, drew },
    // Only the type is public: the numbers give the strength and health, which stay in the player's own log
    said: `, discarding ${discarded.map(typeName).join(', ')} from the battle force and building ${built.map(typeName).join(', ')} for free`,
    privateLines: [
      `Gustavus Adolphus: you discarded ${discarded.map(itemName).join(', ')}`,
      ...built.map((unit) => `Gustavus Adolphus: you built ${itemName(unit)}`),
    ],
  })
}

/** Puts back what the card discarded and drew, or says why it cannot (then nothing has changed). */
export function undoGustavus(
  state: GameState,
  player: Playerhand,
  effect: AppliedGustavus['effect'],
): Result<GameState, string> {
  const drewCards = effect.drew.map((drew) => player.items.find((item) => item.id === drew.itemId))
  if (drewCards.some((card) => card === undefined || (isUnit(card) && card.inBattle))) {
    return err('A unit card Gustavus Adolphus built is no longer free in the hand (it is in the arena or gone), so it cannot be undone.')
  }
  // A new unit that fought, in this battle or in the one End battle set aside, is no longer the card's to take back
  const fought = [state.battle, state.endedBattle?.battle ?? null].flatMap((battle) =>
    battle === null ? [] : [...battle.arena, ...battle.departedUnits].map((unit) => unit.unit.id),
  )
  if (effect.drew.some((drew) => fought.includes(drew.itemId))) {
    return err('A unit Gustavus Adolphus built has been in the arena, so it cannot be undone.')
  }
  if (effect.discarded.some((unit) => !state.discardedItems.some((item) => item.id === unit.id))) {
    return err('A unit card Gustavus Adolphus discarded is no longer in the discard pile, so it cannot be undone.')
  }

  const drewIds = new Set(effect.drew.map((drew) => drew.itemId))
  const restoreIds = new Set(effect.discarded.map((unit) => unit.id))
  const holder = playerOf(state, player.playerId) ?? player
  // The units as they were before the play, not the discard pile's facedown copies
  const returned = effect.discarded
  let current: GameState = {
    ...withPlayerHand(state, {
      ...holder,
      items: [...holder.items.filter((item) => !drewIds.has(item.id)), ...returned],
      battlehand: [...holder.battlehand.filter((unit) => !drewIds.has(unit.id)), ...returned],
    }),
    discardedItems: state.discardedItems.filter((item) => !restoreIds.has(item.id)),
  }
  current = {
    ...current,
    items: [
      ...current.items,
      ...drewCards.flatMap((card) => (card === undefined ? [] : [{ ...card, hidden: true, ownerId: null }])),
    ],
  }
  for (const sheetName of new Set(effect.drew.map((drew) => drew.sheetName))) {
    current = shuffleSheetTwice(current, sheetName)
  }
  return ok(current)
}
