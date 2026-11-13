/**
 * Atomic Theory (issue #327, slice 2): "Nuke — City Management: take an extra action with each of your cities. Nuke —
 * Movement: nuke a non-capital city. The city, along with all buildings, wonders, figures and great people in its
 * outskirts, is destroyed." Paid with Uranium through the shared layer, so Marie Curie's substitution applies.
 *
 * Two modes in one action, one use a turn (a confirmed repeat lifts it):
 * - `extraActions` (City Management): every city of the player may take one more city action. The allowance is not stored: it
 *   is derived from the applied record (`atomicExtraActionFor` in `assisted-core.ts`), so the undo vote removes it.
 * - `nuke` (Movement, `cityPieceId`): the city and what stood in its outskirts are removed through the board actions, each as
 *   its own history entry, and the undo vote puts every piece back exactly as it stood. Which cities qualify is `atomic-theory.ts`.
 */

import { removePiece } from './actions/board.js'
import { nukeTargetsFor } from './atomic-theory.js'
import type { NukeTarget } from './atomic-theory.js'
import { blocked, cityActionCountsThisTurn, openCityManagementTurn, placeBack, playerOf } from './assisted-core.js'
import { techAbility } from './assisted-tech-abilities.js'
import { cityCenterCells, cityFootprintsOf } from './blockade.js'
import { joinList } from './assisted-resources.js'
import { err, ok } from './result.js'
import { openPhaseOf } from './sot.js'
import type { GameState } from './state.js'

const NOT_NOW = 'Atomic Theory is used in your open City Management phase (an extra action with each city) or your open Movement phase (a nuke).'

type Plan = { readonly mode: 'extraActions' } | { readonly mode: 'nuke'; readonly target: NukeTarget }

export const atomicTheory = techAbility<'atomicTheory', Plan>({
  kind: 'atomicTheory',
  techName: 'Atomic Theory',
  effectKind: 'atomicTheory',
  phase: 'ANY',
  buttonText: 'Use Atomic Theory (Uranium: an extra city action, or nuke a city)',
  payment: { kind: 'one', resource: 'Uranium' },

  block(state, player) {
    return openCityManagementTurn(state, player) !== undefined || openPhaseOf(state, player.playerId) === 'MOVEMENT'
      ? undefined
      : blocked('wrong-phase', NOT_NOW)
  },

  plan(state, player, payload) {
    const mode = payload['mode']
    if (mode === 'extraActions') {
      if (openCityManagementTurn(state, player) === undefined) return err('An extra action with each city is taken in your open City Management phase.')
      if (player.color === null || cityFootprintsOf(state, player.color.toLowerCase()).length === 0) return err('You have no city on the map to take an extra action with.')
      return ok({ mode })
    }
    if (mode !== 'nuke') return err('Choose extra actions or nuke.')
    if (openPhaseOf(state, player.playerId) !== 'MOVEMENT') return err('A nuke is used in your open Movement phase.')
    const id = payload['cityPieceId']
    const target = typeof id === 'string' ? nukeTargetsFor(state, player.playerId).find((candidate) => candidate.pieceId === id) : undefined
    if (target === undefined) {
      return err('Choose a city of another player that is not their capital (a capital marker or a metropolis). You cannot nuke your own city.')
    }
    return ok({ mode, target })
  },

  act(state, player, plan, spent, context) {
    if (plan.mode === 'extraActions') {
      return ok({
        state,
        said: ', so each of their cities may take one more city action this turn',
        effect: { kind: 'atomicTheory', mode: 'extraActions', spent },
      })
    }
    // The city goes last: figures, great persons, wonders and buildings around it first, then its markers
    const { target } = plan
    const ids = [...target.destroyed.map((item) => item.pieceId), target.pieceId]
    let current = state
    const removed: { piece: GameState['board']['pieces'][number]; historyId: string }[] = []
    for (const pieceId of ids) {
      const piece = current.board.pieces.find((candidate) => candidate.id === pieceId)
      if (piece === undefined) return err('A piece of the city is no longer on the board.')
      const result = removePiece(current, { playerId: player.playerId, pieceId, ...(context.at === undefined ? {} : { at: context.at }) })
      const entry = result.ok ? result.value.board.history.at(-1) : undefined
      if (!result.ok || entry === undefined) return err(`${piece.label} could not be taken off the board.`)
      current = result.value
      removed.push({ piece, historyId: entry.id })
    }
    const around = target.destroyed.map((item) => `${item.label}${item.square === null ? '' : ` (${item.square})`}`)
    return ok({
      state: current,
      said:
        `, nuking ${target.label} of ${target.ownerUsername}: the city is destroyed` +
        (around.length === 0 ? ', and nothing else stood in its outskirts' : ` along with ${joinList(around)}`),
      // The removals were recorded before the line existed: count it in, as every board change of an action does
      historyIds: removed.map((entry) => entry.historyId),
      effect: {
        kind: 'atomicTheory',
        mode: 'nuke',
        spent,
        cityPieceId: target.pieceId,
        cityLabel: target.label,
        ownerId: target.ownerId,
        removed,
      },
    })
  },

  undo(state, player, effect, _record, at) {
    if (effect.mode === 'extraActions') {
      // A city that has taken its extra action leaves the allowance in use: take that action back first
      const counts = cityActionCountsThisTurn(state, player)
      if ([...counts.values()].some((count) => count >= 2)) {
        return err('A city has already taken a second action this turn. Undo that action first, then Atomic Theory.')
      }
      return ok({ state, said: ' and the extra city actions are no longer allowed' })
    }
    if (effect.removed.some((entry) => state.board.pieces.some((piece) => piece.id === entry.piece.id))) {
      return err('A piece of the destroyed city is on the board again, so the nuke cannot be taken back.')
    }
    // Only a city is checked: a city that now stands on a centre square of the destroyed one (a new city, or the city
    // of another player) would be stacked on, which a restore must not do. Other overlaps (a figure or building that
    // has moved in) are not checked (limitations.md)
    const destroyed = effect.removed.find((entry) => entry.piece.id === effect.cityPieceId)?.piece
    if (destroyed !== undefined) {
      const wanted = new Set((cityCenterCells(state.board, destroyed) ?? []).map((cell) => `${cell.column},${cell.row}`))
      const occupied = state.board.pieces.some(
        (piece) => piece.category === 'city' && (cityCenterCells(state.board, piece) ?? []).some((cell) => wanted.has(`${cell.column},${cell.row}`)),
      )
      if (occupied) return err('A city now stands where the destroyed city was, so the nuke cannot be taken back.')
    }
    // Back in the reverse of the order they were taken off, each exactly as it stood
    let current = state
    for (const entry of [...effect.removed].reverse()) current = placeBack(current, playerOf(current, player.playerId) ?? player, entry.piece, at)
    return ok({ state: current, said: ` and ${effect.cityLabel} was put back with everything that stood around it` })
  },
})
