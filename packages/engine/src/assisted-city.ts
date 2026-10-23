/**
 * Founding a city and sending a scout's square to a city (assisted play, part 13).
 *
 * Both happen in the Start of Turn (base rulebook p. 13 and 26). A new city replaces the
 * scout that stood where it goes; a scout sends its square, and the icons on it, to one
 * city for the whole turn. The engine only knows terrain and buildings of a square, not
 * its trade, culture, coin and resource icons, so sending a square moves production
 * only (the human, 2026-10-23); the rest stays by hand.
 */

import { placeUnchecked, removePiece } from './actions/board.js'
import {
  blocked,
  lastLogId,
  placeBack,
  playerOf,
  rejected,
  withPlayerHand,
} from './assisted-core.js'
import type {
  AssignScoutPayload,
  AssistedActionDefinition,
  AssistedPayload,
  FoundCityPayload,
} from './assisted-core.js'
import { countLinesIn, performAdvance, reverseAdvanceEffect } from './assisted-culture.js'
import { mapCellOf } from './blockade.js'
import { findBoardAsset, mapTop, remainingBoardAssetCount } from './board.js'
import type { BoardPiece } from './board.js'
import { squareLabel } from './build-options.js'
import { cityLimitOf, foundCityCheck, foundingFiguresOf, isOwnFigure, ownCityPieces } from './city-founding.js'
import { cityProductionsOf } from './city-production.js'
import { err, ok } from './result.js'
import { appendLog } from './log.js'
import { SOT_PHASE_REASON, openStartOfTurn, scoutAssignmentsOf } from './sot.js'
import type { GameState, Playerhand, ScoutView } from './state.js'
import { terrainAt } from './terrain.js'

const foundPayloadOf = (payload: AssistedPayload | undefined): FoundCityPayload | undefined =>
  payload !== undefined && 'figurePieceId' in payload && typeof payload.figurePieceId === 'string'
    ? { figurePieceId: payload.figurePieceId }
    : undefined

const assignPayloadOf = (payload: AssistedPayload | undefined): AssignScoutPayload | undefined =>
  payload !== undefined &&
  'scoutPieceId' in payload &&
  typeof payload.scoutPieceId === 'string' &&
  (payload.cityPieceId === null || typeof payload.cityPieceId === 'string')
    ? { scoutPieceId: payload.scoutPieceId, cityPieceId: payload.cityPieceId }
    : undefined

/** The figures that gather a square for a city: scouts, and the English armies (civilization sheet). */
export function gatheringFiguresOf(state: GameState, player: Playerhand): readonly BoardPiece[] {
  return state.board.pieces.filter((piece) => {
    if (!isOwnFigure(state, player, piece) || mapCellOf(state.board, piece) === null) return false
    return piece.assetId.endsWith('scout') || (piece.assetId.endsWith('army') && player.civilization?.name === 'England')
  })
}

// ---------------------------------------------------------------------------
// Found a city
// ---------------------------------------------------------------------------

const ROMANS = 'Romans'
const CITY_STATE_CULTURE = 3

export const foundCity: AssistedActionDefinition = {
  kind: 'foundCity',
  techName: null,
  label: 'Found a city',
  button: false,
  usageKey: null,
  phase: 'SOT',
  group: 'Cities',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (openStartOfTurn(state, player) === undefined) return blocked('wrong-phase', SOT_PHASE_REASON)
    if (foundingFiguresOf(state, player).length === 0) {
      return blocked('unavailable', 'You have no scout on the map to found a city with.')
    }
    return { status: 'ready', reason: 'A scout that stands where the city goes is spent on it.' }
  },

  apply(state, player, context) {
    const fail = (reason: string) => err(rejected('foundCity', blocked('unavailable', reason)))
    const payload = foundPayloadOf(context.payload)
    if (payload === undefined) return fail('Choose the scout that stands where the city goes.')
    if (openStartOfTurn(state, player) === undefined) {
      return err(rejected('foundCity', blocked('wrong-phase', SOT_PHASE_REASON)))
    }
    const figure = foundingFiguresOf(state, player).find((candidate) => candidate.id === payload.figurePieceId)
    if (figure === undefined) return fail('That figure is not yours, or it is not on the map.')
    const check = foundCityCheck(state, player, figure)
    if (!check.ok || check.cell === null) return fail(check.reasons.join(' '))
    const { cell, square } = check

    const colour = player.color?.toLowerCase()
    const assetId = colour === undefined ? undefined : `cities/${colour}city2`
    const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
    if (assetId === undefined || asset === undefined) return fail('You have no city marker to place.')
    // The palette does not limit city markers; the number of cities is what limits them
    if ((remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers) ?? Infinity) <= 0) {
      return fail('All your city markers are on the board.')
    }
    const at = context.at === undefined ? {} : { at: context.at }

    // The figure is spent
    const removedFigure = removePiece(state, { playerId: player.playerId, pieceId: figure.id, ...at })
    const figureEntry = removedFigure.ok ? removedFigure.value.board.history.at(-1) : undefined
    if (!removedFigure.ok || figureEntry === undefined) return fail('The scout could not be taken off the map.')
    let working = removedFigure.value

    // A city-state on the square is destroyed (W&W p. 9): +3 culture
    const cityState = working.board.pieces.find((piece) => {
      const where = piece.category === 'citystate' ? mapCellOf(working.board, piece) : null
      return where !== null && where.column === cell.column && where.row === cell.row
    })
    let destroyed: { readonly piece: BoardPiece; readonly historyId: string } | null = null
    if (cityState !== undefined) {
      const removed = removePiece(working, { playerId: player.playerId, pieceId: cityState.id, ...at })
      const entry = removed.ok ? removed.value.board.history.at(-1) : undefined
      if (!removed.ok || entry === undefined) return fail('The city-state could not be taken off the map.')
      working = removed.value
      destroyed = { piece: cityState, historyId: entry.id }
    }

    // The city marker, unwalled side up, in the middle of the square
    const centreX = (cell.column + 0.5) * state.board.squareSize
    const centreY = mapTop(state.board) + (cell.row + 0.5) * state.board.squareSize
    const placed = placeUnchecked(working, {
      playerId: player.playerId,
      assetId,
      x: Math.round(centreX - asset.width / 2),
      y: Math.round(centreY - asset.height / 2),
      ...at,
    })
    const cityEntry = placed?.board.history.at(-1)
    if (placed === undefined || cityEntry === undefined || cityEntry.change.kind !== 'place') {
      return fail('The city could not be placed.')
    }
    const cityPiece = cityEntry.change.piece
    working = placed

    const culture = destroyed === null ? 0 : CITY_STATE_CULTURE
    if (culture > 0) {
      const holder = playerOf(working, player.playerId) ?? player
      working = withPlayerHand(working, { ...holder, stats: { ...holder.stats, culture: holder.stats.culture + culture } })
    }

    // The new city counts towards the number of social policies a civilization may adopt
    const cities = ownCityPieces(working, player).length
    const holder = playerOf(working, player.playerId) ?? player
    const policyNote = holder.socialPolicies.length < cities ? ', and may now adopt another social policy' : ''
    const withFigure = figure.assetId.endsWith('army') ? 'an army' : 'a scout'
    const lineIds = [figureEntry.id, cityEntry.id, destroyed?.historyId]
    const founded = appendLog(working, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} founded a city on ${square} with ${withFigure}` +
        (destroyed === null ? '' : `, destroying the city-state there (+${CITY_STATE_CULTURE} culture)`) +
        (check.zuluHuts.length === 0 ? '' : `, next to a hut they may explore (${check.zuluHuts.join(', ')})`) +
        policyNote,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const logId = lastLogId(founded)
    let result = countLinesIn(founded, lineIds)

    // The Romans advance one space for free each time they build a city (civilization sheet)
    let advance = null as ReturnType<typeof performAdvance> | null
    if (player.civilization?.name === ROMANS) {
      advance = performAdvance(result, playerOf(result, player.playerId) ?? player, { requestId: context.requestId, at: context.at }, { free: true, tagLog: false })
      if (!advance.ok) {
        const reason = advance.error.kind === 'ASSISTED_ACTION_REJECTED' ? advance.error.reason : ''
        // At the end of the track, or without a marker, there is nothing to advance
        if (!/Culture Victory space|leader marker is not on/.test(reason)) return advance
        advance = null
      } else {
        result = advance.value.state
      }
    }

    return ok({
      state: result,
      effect: {
        kind: 'foundCity',
        figure,
        figureHistoryId: figureEntry.id,
        cityPieceId: cityPiece.id,
        position: { x: cityPiece.x, y: cityPiece.y },
        historyId: cityEntry.id,
        square: { column: cell.column, row: cell.row, label: square },
        cityState: destroyed,
        culture,
        advance: advance !== null && advance.ok ? advance.value.effect : null,
      },
      logId,
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'foundCity') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const blockedBy = (reason: string) => err({ kind: 'ASSISTED_UNDO_BLOCKED' as const, logId: record.logId, reason })
    const city = state.board.pieces.find((piece) => piece.id === effect.cityPieceId)
    if (city === undefined) return blockedBy(`The city on ${effect.square.label} is no longer on the board.`)
    if (city.x !== effect.position.x || city.y !== effect.position.y) {
      return blockedBy(`The city on ${effect.square.label} has been moved. Move it back first.`)
    }
    if (state.board.pieces.some((piece) => piece.id === effect.figure.id)) {
      return blockedBy('The scout is on the board again, so the city cannot be undone.')
    }

    let working = state
    let current = player
    // The free advance goes first: it can refuse (the marker has moved on)
    if (effect.advance !== null) {
      const reversed = reverseAdvanceEffect(working, current, record, effect.advance, at)
      if (!reversed.ok) return reversed
      working = reversed.value.state
      current = playerOf(working, player.playerId) ?? player
    }
    const removed = removePiece(working, { playerId: player.playerId, pieceId: effect.cityPieceId, ...(at === null ? {} : { at }) })
    if (!removed.ok) return blockedBy('The city could not be taken off the board.')
    working = removed.value
    if (effect.cityState !== null) working = placeBack(working, current, effect.cityState.piece, at)
    working = placeBack(working, current, effect.figure, at)
    const back = playerOf(working, player.playerId) ?? current
    working = withPlayerHand(working, {
      ...back,
      stats: { ...back.stats, culture: Math.max(0, back.stats.culture - effect.culture) },
    })
    return ok({
      state: working,
      text:
        `${player.username}'s city on ${effect.square.label} was undone: the scout is back` +
        (effect.cityState === null ? '' : ' and the city-state stands again') +
        (effect.advance === null ? '' : ', and the free advance was taken back'),
    })
  },
}

// ---------------------------------------------------------------------------
// Send a scout's square to a city
// ---------------------------------------------------------------------------

export const assignScout: AssistedActionDefinition = {
  kind: 'assignScout',
  techName: null,
  label: 'Send a scout’s square to a city',
  button: false,
  usageKey: null,
  phase: 'SOT',
  group: 'Scouts',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (openStartOfTurn(state, player) === undefined) return blocked('wrong-phase', SOT_PHASE_REASON)
    if (gatheringFiguresOf(state, player).length === 0) return blocked('unavailable', 'You have no scout on the map.')
    if (ownCityPieces(state, player).length === 0) return blocked('unavailable', 'You have no city on the map to send a square to.')
    return { status: 'ready', reason: 'Choose the city each scout sends its square to this turn.' }
  },

  apply(state, player, context) {
    const fail = (reason: string) => err(rejected('assignScout', blocked('unavailable', reason)))
    const payload = assignPayloadOf(context.payload)
    if (payload === undefined) return fail('Choose the scout and the city.')
    if (openStartOfTurn(state, player) === undefined) {
      return err(rejected('assignScout', blocked('wrong-phase', SOT_PHASE_REASON)))
    }
    const scout = gatheringFiguresOf(state, player).find((candidate) => candidate.id === payload.scoutPieceId)
    if (scout === undefined) return fail('That figure is not one of your scouts on the map.')
    const cell = mapCellOf(state.board, scout)
    if (cell === null) return fail('That scout is not on the map.')
    let cityLabel: string | null = null
    if (payload.cityPieceId !== null) {
      const city = cityProductionsOf(state, player).find((candidate) => candidate.pieceId === payload.cityPieceId)
      if (city === undefined) return fail('That is not one of your cities on the map.')
      cityLabel = city.label
    }
    const square = squareLabel(cell)
    const logged = appendLog(state, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        cityLabel === null
          ? `${player.username} stopped sending the square of the scout on ${square} to a city`
          : `${player.username} sent the square of the scout on ${square} to ${cityLabel}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: {
        kind: 'assignScout',
        scoutPieceId: scout.id,
        cityPieceId: payload.cityPieceId,
        column: cell.column,
        row: cell.row,
        square,
        cityLabel,
      },
      logId: lastLogId(logged),
    })
  },

  // The assignment is read from the records, so undoing the record is all there is to it
  reverse(state, player, record) {
    const effect = record.effect
    if (effect.kind !== 'assignScout') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    return ok({
      state,
      text:
        effect.cityLabel === null
          ? `${player.username}'s change for the scout on ${effect.square} was undone`
          : `${player.username}'s sending of the scout's square on ${effect.square} to ${effect.cityLabel} was undone`,
    })
  },
}

// ---------------------------------------------------------------------------
// The scouts as the Start of Turn tab shows them
// ---------------------------------------------------------------------------

/** Every figure of the viewer that can found a city or send its square, with the answer for each. */
export function scoutViewsOf(state: GameState, player: Playerhand): readonly ScoutView[] {
  const assignments = new Map(scoutAssignmentsOf(state, player).map((assignment) => [assignment.scoutPieceId, assignment.cityPieceId]))
  const founding = new Set(foundingFiguresOf(state, player).map((piece) => piece.id))
  const gathering = new Set(gatheringFiguresOf(state, player).map((piece) => piece.id))
  const figures = state.board.pieces.filter((piece) => founding.has(piece.id) || gathering.has(piece.id))
  return figures.flatMap((piece): readonly ScoutView[] => {
    const cell = mapCellOf(state.board, piece)
    if (cell === null) return []
    const check = foundCityCheck(state, player, piece)
    return [
      {
        pieceId: piece.id,
        square: squareLabel(cell),
        terrain: terrainAt(
          state.board,
          (cell.column + 0.5) * state.board.squareSize,
          mapTop(state.board) + (cell.row + 0.5) * state.board.squareSize,
        ),
        figure: piece.assetId.endsWith('army') ? 'army' : 'scout',
        assignedTo: assignments.get(piece.id) ?? null,
        canSend: gathering.has(piece.id),
        found: {
          ok: founding.has(piece.id) && check.ok,
          reasons: founding.has(piece.id) ? check.reasons : ['Only a scout can found a city (an army can under the Republic).'],
          zuluHuts: check.zuluHuts,
        },
      },
    ]
  })
}

/** Cities left to found: the limit minus the cities there are. */
export const cityLimitView = (state: GameState, player: Playerhand): { readonly have: number; readonly max: number } => ({
  have: ownCityPieces(state, player).length,
  max: cityLimitOf(player),
})

export const CITY_ACTIONS: readonly AssistedActionDefinition[] = [foundCity, assignScout]
