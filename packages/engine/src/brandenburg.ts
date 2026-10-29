/**
 * Brandenburg Gate's outskirts rule (issue #302, unofficial rules 209 to 214).
 *
 * No figure may end a move in the outskirts of the player who has the Brandenburg
 * Gate, except that player's own figures. The city centre is not outskirts
 * (rule 211) and city-states that player holds count as part of them (rule 210).
 * It covers every move: normal travel, Galileo, Hannibal, Steam Power and the
 * movement culture cards (rules 212 and 213). The rule is preventive, so the
 * engine simply never offers such an ending square.
 *
 * The wonder protects the outskirts of every city of its holder (the human's reading,
 * 2026-10-29), and the city-states the holder controls (rule 210). A wonder that is
 * disabled, or blockaded by an enemy figure on its own square (rule 214), has no
 * effect. Communism's Spy exception to the rule is not modelled.
 *
 * Nothing is saved: the squares are derived from the board and the players, so
 * they are public and follow every board undo.
 */

import { cityFootprintsOf, cityStateHolderColour, isBlockaded, mapCellOf } from './blockade.js'
import type { Cell } from './blockade.js'
import { isMapCell } from './board.js'
import type { GameState } from './state.js'

export const BRANDENBURG_GATE_ASSET = 'wonders/brandenburggate'

/** One Brandenburg Gate holder and the squares their gate keeps clear. */
export interface BrandenburgZone {
  readonly ownerId: string
  readonly cells: readonly Cell[]
}

const keyOf = (cell: Cell): string => `${cell.column},${cell.row}`

/**
 * The outskirts each Brandenburg Gate protects, one zone per holder whose wonder
 * is in effect. Empty when nobody has the wonder.
 */
export function brandenburgZonesOf(state: Pick<GameState, 'board' | 'players'>): readonly BrandenburgZone[] {
  const zones: BrandenburgZone[] = []
  for (const gate of state.board.pieces) {
    if (gate.assetId !== BRANDENBURG_GATE_ASSET) continue
    if (gate.ownerId === undefined || gate.ownerId === null || gate.disabled === true) continue
    // A map square only: a gate still in the wonder market has no outskirts to guard
    if (mapCellOf(state.board, gate) === null) continue
    if (isBlockaded(state, gate)) continue
    const holder = state.players.find((player) => player.playerId === gate.ownerId)
    const colour = holder?.color?.toLowerCase()
    if (holder === undefined || colour === undefined) continue

    const footprints = cityFootprintsOf(state, colour)
    const guarded = footprints
    const cells = new Map<string, Cell>()
    for (const footprint of guarded) {
      for (const cell of footprint.outskirts) {
        if (isMapCell(state.board, cell.column, cell.row)) cells.set(keyOf(cell), cell)
      }
    }
    for (const piece of state.board.pieces) {
      if (piece.category !== 'citystate') continue
      const at = mapCellOf(state.board, piece)
      if (at !== null && cityStateHolderColour(state, piece) === colour) cells.set(keyOf(at), at)
    }
    // A holder's centre squares are never outskirts, even where another city's ring reaches them
    for (const footprint of footprints) for (const centre of footprint.centers) cells.delete(keyOf(centre))
    zones.push({ ownerId: holder.playerId, cells: [...cells.values()] })
  }
  return zones
}

/**
 * The squares a figure of `moverId` may not end a move on because of someone
 * else's Brandenburg Gate. The holder's own figures are not restricted.
 */
export function brandenburgForbiddenCells(
  // A view from a server older than this client has no zones: nothing is forbidden then
  zones: readonly BrandenburgZone[] = [],
  moverId: string,
): readonly Cell[] {
  const cells = new Map<string, Cell>()
  for (const zone of zones) {
    if (zone.ownerId === moverId) continue
    for (const cell of zone.cells) cells.set(keyOf(cell), cell)
  }
  return [...cells.values()]
}

/** The same, straight from the state. */
export const brandenburgForbiddenFor = (
  state: Pick<GameState, 'board' | 'players'>,
  moverId: string,
): readonly Cell[] => brandenburgForbiddenCells(brandenburgZonesOf(state), moverId)
