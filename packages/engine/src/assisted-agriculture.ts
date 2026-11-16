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
 * Buildings and wonders on the growing square are destroyed, Great Persons return to reserve, and friendly figures move
 * together to the neighbouring outskirts square the player chooses. Zulu hut exploration remains manual.
 */

import { flipPieceUnchecked, movePieceUnchecked } from './actions/board.js'
import { blocked, restoreSupplyBlock } from './assisted-core.js'
import { putReplacedBack, removeReplaced, reservedUndoBlock } from './assisted-replace.js'
import { techAbility } from './assisted-tech-abilities.js'
import { cityCenterCells, mapCellOf } from './blockade.js'
import type { BoardPiece } from './board.js'
import { findBoardAsset } from './board.js'
import { brandenburgForbiddenFor } from './brandenburg.js'
import { squareLabel } from './build-options.js'
import { stackingLimitOf } from './great-person-effects.js'
import { GROW_DIRECTIONS, growableCapital, isGrowDirection, metropolisFigureTargets, metropolisGrowthsOf } from './metropolis.js'
import type { GrowDirection, MetropolisGrowth } from './metropolis.js'
import { figuresAt } from './movement.js'
import { err, ok } from './result.js'
import { capitalOf } from './sot.js'
import type { GameState, Playerhand } from './state.js'

type Plan = { readonly growth: MetropolisGrowth; readonly figureTarget?: { readonly column: number; readonly row: number } }

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
    const figures = figuresAt(state.board, player, growth.cell)
    if (figures.length === 0) {
      return payload['figureTarget'] === undefined ? ok({ growth }) : err('There are no figures on the growing square to move.')
    }
    const capital = growableCapital(state, player)
    if (capital === undefined) return err('You have no capital marker on the map.')
    const targets = metropolisFigureTargets(state.board, player, capital, growth.cell, stackingLimitOf(state, player), brandenburgForbiddenFor(state, player.playerId))
    const target = payload['figureTarget']
    if (typeof target !== 'object' || target === null || !('column' in target) || !('row' in target)) {
      return err('Choose a neighbouring outskirts square for all your figures on the growing square.')
    }
    const figureTarget = targets.find((cell) => cell.column === target.column && cell.row === target.row)
    if (figureTarget === undefined) return err('That square cannot hold all the figures displaced by the metropolis.')
    return ok({ growth, figureTarget })
  },

  act(state, player, plan, spent, context) {
    const { growth } = plan
    const capital = growableCapital(state, player)
    if (capital === undefined) return err('You have no capital marker on the map.')
    let current = state
    const overbuilt: { piece: BoardPiece; historyId: string; reserved: boolean }[] = []
    const figures: { piece: BoardPiece; to: { x: number; y: number }; historyId: string }[] = []
    const stamp = context.at === undefined ? {} : { at: context.at }
    for (const piece of growth.overbuilt) {
      if (piece.category !== 'building' && piece.category !== 'wonder' && piece.category !== 'greatperson') continue
      const replaced = removeReplaced(current, player, {
        ...growth.cell, label: growth.square,
        replaces: { assetId: piece.assetId, label: piece.label, kind: piece.category },
      }, stamp)
      if (!replaced.ok) return err(replaced.error)
      current = replaced.value.state
      overbuilt.push({ piece: replaced.value.piece, historyId: replaced.value.historyId, reserved: replaced.value.reserved })
    }
    if (plan.figureTarget !== undefined) {
      for (const piece of figuresAt(state.board, player, growth.cell)) {
        const x = piece.x + (plan.figureTarget.column - growth.cell.column) * state.board.squareSize
        const y = piece.y + (plan.figureTarget.row - growth.cell.row) * state.board.squareSize
        const moved = movePieceUnchecked(current, { playerId: player.playerId, pieceId: piece.id, x, y, snap: false, ...stamp })
        const entry = moved?.board.history.at(-1)
        const placed = moved?.board.pieces.find((other) => other.id === piece.id)
        if (moved === undefined || entry === undefined || placed === undefined) return err('A displaced figure could not be moved.')
        current = moved
        figures.push({ piece, to: { x: placed.x, y: placed.y }, historyId: entry.id })
      }
    }
    const flipped = flipPieceUnchecked(current, {
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
        (growth.zuluHuts.length === 0 ? '' : `, with a hut in the new outskirts they may explore (${growth.zuluHuts.join(', ')})`) +
        overbuilt.map((entry) => `, ${entry.reserved ? 'returning' : 'destroying'} ${entry.piece.label}${entry.reserved ? ' to reserve' : ''}`).join('') +
        (plan.figureTarget === undefined ? '' : `, moving ${figures.length} friendly ${figures.length === 1 ? 'figure' : 'figures'} to ${squareLabel(plan.figureTarget)}`),
      historyIds: [...overbuilt.map((entry) => entry.historyId), ...figures.map((entry) => entry.historyId), entry.id],
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
        overbuilt,
        figures,
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
    const overbuilt = effect.overbuilt ?? []
    const figures = effect.figures ?? []
    for (const entry of overbuilt) {
      if (entry.reserved) {
        const block = reservedUndoBlock(state, player.playerId, { reserved: entry })
        if (block !== undefined) return err(block)
      } else if (state.board.pieces.some((piece) => piece.id === entry.piece.id)) {
        return err(`${entry.piece.label} is on the board again. Remove it before undoing Agriculture.`)
      }
    }
    for (const move of figures) {
      const piece = state.board.pieces.find((candidate) => candidate.id === move.piece.id)
      if (piece === undefined || piece.x !== move.to.x || piece.y !== move.to.y ||
          piece.assetId !== move.piece.assetId || piece.rotation !== move.piece.rotation ||
          piece.width !== move.piece.width || piece.height !== move.piece.height ||
          piece.movement?.turn !== move.piece.movement?.turn || piece.movement?.used !== move.piece.movement?.used ||
          piece.movement?.locked !== move.piece.movement?.locked || piece.movement?.reason !== move.piece.movement?.reason) {
        return err('A displaced figure has moved or changed its movement. Undo that first.')
      }
    }
    const second = cityCenterCells(state.board, city)?.find((cell) => squareLabel(cell) === effect.square)
    if (second !== undefined && (overbuilt.length > 0 || figures.length > 0) && state.board.pieces.some((piece) => {
      if (piece.id === city.id) return false
      if (piece.category === 'city') {
        return (cityCenterCells(state.board, piece) ?? []).some((cell) => cell.column === second.column && cell.row === second.row)
      }
      const at = mapCellOf(state.board, piece)
      return at !== null && at.column === second.column && at.row === second.row &&
        (piece.category === 'building' || piece.category === 'wonder' || piece.category === 'greatperson' ||
          piece.category === 'citystate' || piece.category === 'figure')
    })) {
      return err('The growing square is occupied now. Clear it before undoing Agriculture.')
    }
    const supply = restoreSupplyBlock(state, overbuilt.filter((entry) => !entry.reserved).map((entry) => entry.piece))
    if (supply !== undefined) return err(supply)
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
    let current = restored
    for (const move of [...figures].reverse()) {
      const moved = movePieceUnchecked(current, {
        playerId: player.playerId, pieceId: move.piece.id, x: move.piece.x, y: move.piece.y, snap: false,
        ...(at === null ? {} : { at }),
      })
      if (moved === undefined) return err('A displaced figure could not be put back.')
      current = moved
    }
    for (const entry of [...overbuilt].reverse()) {
      current = putReplacedBack(current, player, entry.reserved ? { reserved: entry } : { replaced: entry }, at)
    }
    return ok({
      state: current,
      said: `, and the capital marker was put back on ${effect.capitalSquare}${from.assetId.includes('walled') ? ' with its walls' : ''}` +
        (overbuilt.length === 0 && figures.length === 0 ? '' : ', with the overbuilt pieces and displaced figures restored'),
    })
  },
})
