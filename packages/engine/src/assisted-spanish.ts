/**
 * The Spanish civilization ability: "when they discover an unexplored map tile, may immediately build a basic
 * (non-upgraded) building in any city for free, even if not unlocked". Each tile explored gives one credit
 * (`exploreSquare`, kept as in `spanish-credit.ts`); this action spends it on a basic building the player picks
 * with the same city, square and building choice as A. P. Giannini's free building.
 *
 * Differences from Giannini: the building need not be unlocked, only a basic form is offered, and nothing is
 * paid, produced or counted as a city action. The normal limit of one limited (star) building per city applies,
 * as Build does it (a second one stands only on the first one's square and replaces it).
 *
 * Undo: the building comes off and what it replaced goes back; the credit comes back with it, because a credit
 * is a grant minus the applied records. Only the vote on the log line undoes it (the board Undo skips it), and
 * the board Undo of the exploration is refused while the credit is spent.
 */

import { blocked, lastLogId, playerOf } from './assisted-core.js'
import type { AssistedActionDefinition } from './assisted-core.js'
import { countLinesIn } from './assisted-culture.js'
import { placeFreeBuilding, reverseFreeBuilding, withArticle } from './assisted-free-building.js'
import { replacingText } from './assisted-replace.js'
import { SPANISH } from './actions/player.js'
import { basicBuildingChoicesOf } from './build-options.js'
import { appendLog } from './log.js'
import { ok } from './result.js'
import { SPANISH_BUILDING_KIND, spanishCreditsOf, spanishUsedBy } from './spanish-credit.js'
import type { GameState, Playerhand } from './state.js'

const ABILITY = 'the Spanish'

/** Why the free building cannot be built now, or `undefined` when it can. The player's own credit and squares only. */
export function spanishBuildBlock(state: GameState, player: Playerhand) {
  if (player.civilization?.name !== SPANISH) return blocked('not-owned', 'Only the Spanish build a free building for a tile they explore.')
  if (spanishCreditsOf(state, player.playerId) <= 0) {
    return blocked('unavailable', 'You have no free building left. Every map tile you explore gives one.')
  }
  return undefined
}

export const spanishBuild: AssistedActionDefinition = {
  kind: SPANISH_BUILDING_KIND,
  techName: null,
  label: 'Free building (Spanish)',
  button: false,
  usageKey: null,
  phase: 'ANY',
  group: 'Civilization',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const refused = spanishBuildBlock(state, player)
    if (refused !== undefined) return refused
    const left = spanishCreditsOf(state, playerId)
    if (basicBuildingChoicesOf(state, player).length === 0) {
      return blocked(
        'unavailable',
        `No basic building has an empty legal square in the outskirts of your cities. Your free building is kept (${left} left).`,
      )
    }
    const total = left + spanishUsedBy(state, playerId)
    return { status: 'ready', reason: `Build one basic building in one of your cities for free, unlocked or not (${left} of ${total} left).` }
  },

  apply(state, player, context) {
    const placed = placeFreeBuilding(
      state,
      player,
      context,
      SPANISH_BUILDING_KIND,
      basicBuildingChoicesOf,
      () => spanishBuildBlock(state, player),
      'it must be a basic building (not an upgraded one), on an empty legal square in the outskirts of one of your cities, with some left in the supply.',
    )
    if (!placed.ok) return placed
    const { name, where } = placed.value
    const logged = appendLog(placed.value.state, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} built ${withArticle(name)} on ${where} for free as ${ABILITY}${replacingText(placed.value.replaces)}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const logId = lastLogId(logged)
    // This record is not in the list yet: it will have used one more credit
    const left = spanishCreditsOf(logged, player.playerId) - 1
    const withPrivate = appendLog(logged, {
      username: player.username,
      privateLog: `${player.username} used 1 free building as ${ABILITY}, ${Math.max(0, left)} free buildings left`,
      createdAt: context.at ?? null,
    })
    return ok({ state: countLinesIn(withPrivate, placed.value.historyIds), effect: placed.value.effect, logId })
  },

  reverse(state, player, record, at) {
    return reverseFreeBuilding(state, player, record, at ?? null, {
      source: ABILITY,
      again: 'the free building was given back',
    })
  },
}

export const SPANISH_ACTIONS: readonly AssistedActionDefinition[] = [spanishBuild]
