/**
 * Agriculture (issue #354): "Immediately grow your capital into a metropolis." Costs nothing, and is not tied to a phase,
 * as the card says "immediately" (ruling 128: also in another player's Start of Turn, when a culture card taught it).
 *
 * The player names the side of the capital the second city square lies on (north, west, east or south); only a legal one is
 * accepted (`metropolis.ts` has the rules and the reasons). The capital marker is then turned over to the metropolis marker,
 * walled when the capital was, as one board history entry: the same piece, so a Building Program marker, a typed production, a
 * scout's assignment and every other record that names the city still do, and what stands on the capital's square stays.
 * "Once per game" is not a counter: the capital marker is gone afterwards (`capitalOf` falls back to the metropolis, which
 * only a capital grows into), so there is nothing left to offer. The undo vote turns the marker back, walls included, while
 * the metropolis is still on the board as the action left it and no city action was taken with it since.
 *
 * Not carried out (limitations.md): moving a friendly figure off the new square, overbuilding a building, wonder or Great
 * Person on it, exploring a Zulu hut in the new outskirts. A direction where one of them would be needed is not offered.
 */

import { flipPieceUnchecked } from './actions/board.js'
import { blocked } from './assisted-core.js'
import { techAbility } from './assisted-tech-abilities.js'
import { cityCenterCells, mapCellOf } from './blockade.js'
import { findBoardAsset } from './board.js'
import { squareLabel } from './build-options.js'
import { GROW_DIRECTIONS, growableCapital, isGrowDirection, metropolisGrowthsOf } from './metropolis.js'
import type { GrowDirection, MetropolisGrowth } from './metropolis.js'
import { err, ok } from './result.js'
import { capitalOf } from './sot.js'
import type { GameState, Playerhand } from './state.js'

type Plan = { readonly growth: MetropolisGrowth }

const DIRECTION_NAMES: Readonly<Record<GrowDirection, string>> = { north: 'North', west: 'West', east: 'East', south: 'South' }

/** The reason there is nothing to grow, or the four growths when there is a capital marker. */
function growthsOf(state: GameState, player: Playerhand): { readonly capitalLabel: string; readonly growths: readonly MetropolisGrowth[] } | string {
  const capital = growableCapital(state, player)
  if (capital === undefined) {
    return capitalOf(state, player) === undefined
      ? 'You have no capital on the map to grow.'
      : 'Your capital is already a metropolis.'
  }
  return { capitalLabel: capital.label, growths: metropolisGrowthsOf(state, player, capital) }
}

export const agriculture = techAbility<'agriculture', Plan>({
  kind: 'agriculture',
  techName: 'Agriculture',
  effectKind: 'agriculture',
  phase: 'ANY',
  group: 'Cities',
  buttonText: 'Grow your capital into a metropolis',
  payment: { kind: 'none' },
  blockBeforeUsed: true,

  block(state, player) {
    const found = growthsOf(state, player)
    if (typeof found === 'string') return blocked('unavailable', found)
    if (found.growths.some((growth) => growth.ok)) return undefined
    return blocked(
      'unavailable',
      'Your capital cannot grow now: ' +
        found.growths.map((growth) => `${DIRECTION_NAMES[growth.direction]} (${growth.square}): ${growth.reasons.join(' ')}`).join(' '),
    )
  },

  plan(state, player, payload) {
    const found = growthsOf(state, player)
    if (typeof found === 'string') return err(found)
    const direction = payload['direction']
    if (!isGrowDirection(direction)) return err(`Choose the side the metropolis grows on: ${GROW_DIRECTIONS.join(', ')}.`)
    const growth = found.growths.find((candidate) => candidate.direction === direction)
    if (growth === undefined) return err('The capital cannot grow there.')
    if (!growth.ok) return err(`The capital cannot grow ${direction}: ${growth.reasons.join(' ')}`)
    return ok({ growth })
  },

  act(state, player, plan, spent, context) {
    const { growth } = plan
    const capital = growableCapital(state, player)
    if (capital === undefined) return err('You have no capital marker on the map.')
    const flipped = flipPieceUnchecked(state, {
      playerId: player.playerId,
      pieceId: capital.id,
      assetId: growth.assetId,
      centre: growth.centre,
      rotation: growth.rotation,
      ...(context.at === undefined ? {} : { at: context.at }),
    })
    const entry = flipped?.board.history.at(-1)
    const city = flipped?.board.pieces.find((piece) => piece.id === capital.id)
    if (flipped === undefined || entry === undefined || entry.change.kind !== 'flip' || city === undefined) {
      return err('The capital marker could not be turned over to the metropolis marker.')
    }
    // The marker must lie on the capital's square and the second one, whatever the layout said
    const centres = cityCenterCells(flipped.board, city) ?? []
    if (centres.length !== 2 || !centres.some((cell) => cell.column === growth.cell.column && cell.row === growth.cell.row)) {
      return err('The metropolis would not lie on the squares chosen.')
    }
    const home = mapCellOf(state.board, capital)
    const homeSquare = home === null ? '' : squareLabel(home)
    const walled = growth.assetId.includes('walled')
    return ok({
      state: flipped,
      said:
        `grew their capital on ${homeSquare} into a metropolis: ${homeSquare} and ${growth.square} to the ${growth.direction} are its two city squares` +
        (walled ? ', and the walls stay' : '') +
        (growth.zuluHuts.length === 0 ? '' : `, with a hut in the new outskirts they may explore (${growth.zuluHuts.join(', ')})`),
      historyIds: [entry.id],
      effect: {
        kind: 'agriculture',
        spent,
        cityPieceId: capital.id,
        capitalSquare: homeSquare,
        direction: growth.direction,
        square: growth.square,
        from: entry.change.from,
        to: entry.change.to,
        historyId: entry.id,
      },
    })
  },

  undo(state, player, effect, record, at) {
    const city = state.board.pieces.find((piece) => piece.id === effect.cityPieceId)
    if (city === undefined) return err('The metropolis is no longer on the board, so the capital cannot be put back.')
    const { to, from } = effect
    if (city.assetId !== to.assetId) {
      return err(`The marker is not the metropolis as the action left it (it shows ${city.label} now), so the capital cannot be put back. Undo what changed it first.`)
    }
    if (city.x !== to.x || city.y !== to.y || city.rotation !== (to.rotation ?? city.rotation)) {
      return err('The metropolis has been moved or turned. Move it back first.')
    }
    // Something done with the city after it grew (a build in its new outskirts, a Devote, a harvest) goes first
    const after = state.assistedActions.slice(state.assistedActions.findIndex((other) => other.id === record.id) + 1)
    const later = after.find(
      (other) =>
        other.status === 'applied' &&
        other.kind !== 'assignScout' &&
        (('cityPieceId' in other.effect && other.effect.cityPieceId === effect.cityPieceId) ||
          (other.effect.kind === 'playCard' && other.effect.garcia?.cities.some((entry) => entry.cityPieceId === effect.cityPieceId) === true)),
    )
    if (later !== undefined) {
      return err(`The metropolis was used after it grew (${later.kind}). Undo that first.`)
    }
    const restored = flipPieceUnchecked(state, {
      playerId: player.playerId,
      pieceId: effect.cityPieceId,
      assetId: from.assetId,
      centre: { x: from.x + from.width / 2, y: from.y + from.height / 2 },
      rotation: from.rotation ?? city.rotation,
      ...(at === null ? {} : { at }),
    })
    if (restored === undefined || findBoardAsset(from.assetId) === undefined) {
      return err('The capital marker could not be put back.')
    }
    return ok({
      state: restored,
      said: `, and the capital marker was put back on ${effect.capitalSquare}${from.assetId.includes('walled') ? ' with its walls' : ''}`,
    })
  },
})
