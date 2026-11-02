/**
 * Gustavus Adolphus (issue #301): "kill all units in your battle force (they cannot be saved) and build an equal
 * number of unlocked units for free, immediately adding them to your battle force."
 *
 * The battle force is the living units in the arena and the units still in the battlehand (human, 2026-11-02:
 * "alle units discardes, og man får velge samme antall nye"). The arena units are killed like any other kill, and
 * cannot be saved by Nightingale; the battlehand units go to the discard pile. Each new unit is drawn from the
 * deck of the type the player chose: infantry, mounted, artillery, and aircraft with Flight. The player draws only
 * what they could build, so the units are drawn into the hand and the battlehand.
 */

import type { ArenaUnit } from './battle.js'
import { gustavusForceOf } from './battle-cards.js'
import { drawCandidates, shuffleSheetTwice } from './assisted-culture.js'
import { playerOf, withPlayerHand } from './assisted-core.js'
import { isUnit } from './item.js'
import type { Item, UnitItem } from './item.js'
import type { SheetName } from './sheet-name.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { GameState, Playerhand } from './state.js'

const SHEET_NOUN: Readonly<Partial<Record<SheetName, string>>> = {
  INFANTRY: 'infantry',
  MOUNTED: 'mounted',
  ARTILLERY: 'artillery',
  AIRCRAFT: 'aircraft',
}

/** The unit decks the player may build from: aircraft only once Flight is known. */
export function gustavusSheetsOf(player: Playerhand): readonly SheetName[] {
  const flight = player.techsChosen.some((tech) => tech.name === 'Flight' && !tech.hidden)
  return flight ? ['INFANTRY', 'MOUNTED', 'ARTILLERY', 'AIRCRAFT'] : ['INFANTRY', 'MOUNTED', 'ARTILLERY']
}

/** How many units the card replaces, and the decks it can build from; `null` when the player is in no battle. */
export function gustavusChoiceOf(state: GameState, player: Playerhand): { readonly count: number; readonly sheets: readonly SheetName[] } | null {
  if (state.battle === null) return null
  const force = gustavusForceOf(state.battle, player)
  return { count: force.arena.length + force.hand.length, sheets: gustavusSheetsOf(player) }
}

export interface AppliedGustavus {
  readonly state: GameState
  readonly effect: {
    readonly battleId: string
    readonly killed: readonly string[]
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
  const battle = state.battle
  if (battle === null) return err('Gustavus Adolphus is played in a battle you are fighting.')
  const force = gustavusForceOf(battle, player)
  const count = force.arena.length + force.hand.length
  const allowed = gustavusSheetsOf(player)
  const chosen = (sheets ?? []).filter((sheet): sheet is SheetName => (allowed as readonly string[]).includes(sheet))
  if (sheets === undefined || sheets.length !== count || chosen.length !== count) {
    return err(`Choose the unit type for each of the ${count} units to build: ${allowed.map((sheet) => SHEET_NOUN[sheet]).join(', ')}.`)
  }

  const killed = force.arena.map((unit) => unit.id)
  const discardedIds = new Set(force.hand.map((unit) => unit.id))
  const discarded = force.hand
  let next: GameState = {
    ...state,
    battle: {
      ...battle,
      arena: battle.arena.map(
        (unit): ArenaUnit => (killed.includes(unit.id) ? { ...unit, killed: true, gustavus: true } : unit),
      ),
    },
  }
  next = {
    ...withPlayerHand(next, {
      ...player,
      battlehand: player.battlehand.filter((unit) => !discardedIds.has(unit.id)),
      items: player.items.filter((item) => !discardedIds.has(item.id)),
    }),
  }
  next = { ...next, discardedItems: [...next.discardedItems, ...discarded.map((unit): Item => ({ ...unit, hidden: true }))] }

  const drew: { itemId: string; sheetName: SheetName }[] = []
  const lines: string[] = []
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
    const noun = SHEET_NOUN[sheetName] ?? 'unit'
    lines.push(`Gustavus Adolphus: you built ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} unit, card number ${card.itemNumber}`)
  }

  const units = (n: number): string => `${n} unit${n === 1 ? '' : 's'}`
  const parts = [
    ...(killed.length === 0 ? [] : [`killing ${units(killed.length)} in the arena (they cannot be saved)`]),
    ...(discarded.length === 0 ? [] : [`discarding ${units(discarded.length)} of the battle force`]),
    `building ${units(count)} for free`,
  ]
  return ok({
    state: next,
    effect: { battleId: battle.id, killed, discarded, drew },
    said: `, ${parts.join(', ')}`,
    privateLines: [
      ...(discarded.length === 0 ? [] : [`Gustavus Adolphus: you discarded ${discarded.map((unit) => `${unit.kind} ${unit.itemNumber}`).join(', ')}`]),
      ...lines,
    ],
  })
}

/** Puts back what the card killed, discarded and drew, or says why it cannot (then nothing has changed). */
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
  const unkill = (unit: ArenaUnit): ArenaUnit => {
    if (!effect.killed.includes(unit.id) || unit.gustavus !== true) return unit
    const { gustavus: _gustavus, ...rest } = unit
    return { ...rest, killed: false }
  }
  const battleOf = <B extends { arena: readonly ArenaUnit[]; departedUnits: readonly ArenaUnit[] }>(battle: B): B => ({
    ...battle,
    arena: battle.arena.map(unkill),
    departedUnits: battle.departedUnits.map(unkill),
  })

  let current: GameState = state
  if (current.battle !== null && current.battle.id === effect.battleId) current = { ...current, battle: battleOf(current.battle) }
  const ended = current.endedBattle
  if (ended !== null && ended.battle.id === effect.battleId) {
    current = { ...current, endedBattle: { ...ended, battle: battleOf(ended.battle) } }
  }

  const holder = playerOf(current, player.playerId) ?? player
  const returned = current.discardedItems.filter((item) => restoreIds.has(item.id)).filter(isUnit)
  current = {
    ...withPlayerHand(current, {
      ...holder,
      items: [...holder.items.filter((item) => !drewIds.has(item.id)), ...returned],
      battlehand: [...holder.battlehand.filter((unit) => !drewIds.has(unit.id)), ...returned],
    }),
    discardedItems: current.discardedItems.filter((item) => !restoreIds.has(item.id)),
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
