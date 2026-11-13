/**
 * Gunpowder (issue #327): "Any 2 — City Management: obsolete an ancient or medieval wonder, or destroy a building of your
 * choice."
 *
 * The payment is the first "Any N" (`spendAnyResources`): the player names the resources to pay, as a preference: one it does
 * not hold is paid by any other token, and only what tokens cannot cover by a culture card. Then one of two modes (human,
 * 2026-11-13), both through the board actions so the board history records them and the undo vote takes them back:
 * - `obsolete` (`wonderPieceId`): an ANCIENT or MEDIEVAL wonder that a player owns and that is not disabled is marked disabled,
 *   as Monarchy does (`disableWonder`); modern wonders are not eligible.
 * - `destroy` (`buildingPieceId`): any building on a map square, whoever's, the player's own included, is removed from the
 *   board. The undo puts it back exactly, unless the piece is on the board again or another building or wonder now stands on
 *   its square.
 * Nothing is spent when the chosen target is not eligible.
 */

import { removePiece } from './actions/board.js'
import { blocked, placeBack } from './assisted-core.js'
import { disableWonder, enableWonder, techAbility } from './assisted-tech-abilities.js'
import { destroyableBuildingsOf } from './destroy-buildings.js'
import type { DestroyableBuilding } from './destroy-buildings.js'
import { mapCellOf } from './blockade.js'
import { obsoletableWondersOf } from './obsolete-wonders.js'
import type { ObsoletableWonder } from './obsolete-wonders.js'
import { err, ok } from './result.js'
import type { WonderEra } from './wonder-data.js'

export const GUNPOWDER_NAME = 'Gunpowder'
export const GUNPOWDER_COST = 2

/** The eras whose wonders Gunpowder may obsolete. */
export const GUNPOWDER_ERAS: readonly WonderEra[] = ['Ancient', 'Medieval']

const NOTHING_TO_DO = 'There is no ancient or medieval wonder owned by a player to obsolete and no building on the map to destroy, so Gunpowder has nothing to do.'
const NO_WONDER = 'No ancient or medieval wonder is owned by a player, so there is none to obsolete.'
const NO_BUILDING = 'No building stands on the map, so there is none to destroy.'

type Plan =
  | { readonly mode: 'obsolete'; readonly wonder: ObsoletableWonder }
  | { readonly mode: 'destroy'; readonly building: DestroyableBuilding }

export const gunpowder = techAbility<'gunpowder', Plan>({
  kind: 'gunpowder',
  techName: GUNPOWDER_NAME,
  effectKind: 'gunpowder',
  phase: 'CM',
  buttonText: `Use ${GUNPOWDER_NAME} (any ${GUNPOWDER_COST} resources)`,
  payment: { kind: 'any', count: GUNPOWDER_COST },

  // Not usable with nothing to obsolete and nothing to destroy; with only one of them the warning says which
  block(state) {
    const none = obsoletableWondersOf(state.board, state.players, GUNPOWDER_ERAS).length === 0
    return none && destroyableBuildingsOf(state, state.players).length === 0 ? blocked('unavailable', NOTHING_TO_DO) : undefined
  },

  warn(state) {
    const cautions = [
      ...(obsoletableWondersOf(state.board, state.players, GUNPOWDER_ERAS).length === 0 ? [NO_WONDER] : []),
      ...(destroyableBuildingsOf(state, state.players).length === 0 ? [NO_BUILDING] : []),
    ]
    return cautions.length === 0 ? undefined : cautions.join(' ')
  },

  plan(state, _player, payload) {
    const mode = payload['mode']
    if (mode === 'obsolete') {
      const id = payload['wonderPieceId']
      const wonder = typeof id === 'string' ? obsoletableWondersOf(state.board, state.players, GUNPOWDER_ERAS).find((candidate) => candidate.pieceId === id) : undefined
      return wonder === undefined
        ? err('Choose an ancient or medieval wonder that a player owns and that is not disabled yet. Nothing was spent.')
        : ok({ mode, wonder })
    }
    if (mode !== 'destroy') return err('Choose obsolete or destroy.')
    const id = payload['buildingPieceId']
    const building = typeof id === 'string' ? destroyableBuildingsOf(state, state.players).find((candidate) => candidate.pieceId === id) : undefined
    return building === undefined ? err('Choose a building on the map. Nothing was spent.') : ok({ mode, building })
  },

  act(state, player, plan, spent, context) {
    if (plan.mode === 'obsolete') {
      const disabled = disableWonder(state, player, plan.wonder, context.at)
      if (!disabled.ok) return err(disabled.error)
      return ok({
        state: disabled.value.state,
        said: `, obsoleting ${plan.wonder.label} of ${plan.wonder.ownerUsername}: the wonder is disabled`,
        historyIds: [disabled.value.disabled.historyId],
        effect: { kind: 'gunpowder', spent, mode: 'obsolete', wonder: disabled.value.disabled },
      })
    }
    const { building } = plan
    const piece = state.board.pieces.find((candidate) => candidate.id === building.pieceId)
    if (piece === undefined) return err('The building is no longer on the board.')
    const removed = removePiece(state, { playerId: player.playerId, pieceId: piece.id, ...(context.at === undefined ? {} : { at: context.at }) })
    const entry = removed.ok ? removed.value.board.history.at(-1) : undefined
    if (!removed.ok || entry === undefined) return err(`${building.label} could not be taken off the board.`)
    return ok({
      state: removed.value,
      said:
        `, destroying ${building.label} on ${building.square}` +
        (building.ownerUsername === null ? ' (in no player\'s outskirts)' : ` (in ${building.ownerUsername}'s outskirts)`),
      historyIds: [entry.id],
      effect: { kind: 'gunpowder', spent, mode: 'destroy', building: { piece, label: building.label, square: building.square, historyId: entry.id } },
    })
  },

  undo(state, player, effect, _record, at) {
    if (effect.mode === 'obsolete') {
      if (effect.wonder === undefined) return ok({ state, said: '; no wonder was recorded, so nothing is changed' })
      const enabled = enableWonder(state, player, effect.wonder, at)
      return enabled.ok ? ok({ state: enabled.value.state, said: ` and ${enabled.value.said}` }) : err(enabled.error)
    }
    const building = effect.building
    if (building === undefined) return ok({ state, said: '; no building was recorded, so nothing is changed' })
    if (state.board.pieces.some((piece) => piece.id === building.piece.id)) {
      return err(`${building.label} is on the board again, so the destruction cannot be taken back.`)
    }
    // Another building or a wonder on the same square would be stacked on: a square holds one
    const where = mapCellOf(state.board, building.piece)
    const taken = where !== null && state.board.pieces.some((piece) => {
      if (piece.category !== 'building' && piece.category !== 'wonder') return false
      const cell = mapCellOf(state.board, piece)
      return cell !== null && cell.column === where.column && cell.row === where.row
    })
    if (taken) return err(`Another building or wonder now stands on ${building.square}, so ${building.label} cannot be put back.`)
    return ok({ state: placeBack(state, player, building.piece, at), said: ` and ${building.label} was put back on ${building.square}` })
  },
})
