/**
 * A small bridge between a card form and the board's square picker.
 *
 * A card that needs map squares opens the board picker with `begin` and awaits
 * the picked square (or `null` when cancelled). The provider lives in
 * `GameView`, which owns the board; the card form stays where it is in the hand
 * or the phase tab.
 */

import { createContext, useContext } from 'react'

import type { PickableSquare } from './BoardView.js'

export interface MapPickRequest {
  /** What the cells are for, used by the fallback button names. */
  readonly title: string
  readonly cells: readonly PickableSquare[]
  /** A sentence for one cell's button, in place of the Build picker's "Place …" text. */
  readonly describeCell?: (cell: PickableSquare) => string
}

export interface MapPicker {
  /** Resolves with the picked square, or `null` when the player cancels. */
  readonly begin: (request: MapPickRequest) => Promise<PickableSquare | null>
  /** Cancel an open pick, resolving it with `null`; does nothing when none is open. */
  readonly cancel: () => void
}

export const MapPickerContext = createContext<MapPicker | null>(null)

export const useMapPicker = (): MapPicker | null => useContext(MapPickerContext)
