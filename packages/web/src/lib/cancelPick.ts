/**
 * "Choose the action to cancel in the log": playing Mark Twain, Jousting Tourney,
 * Primetime TV or Bread and Circuses starts this mode, and the log then offers a red Cancel button
 * on each action the card can cancel. One small store, like `toasts.ts`, so the
 * card and the log panel need no shared parent state.
 */

import { useSyncExternalStore } from 'react'

export interface CancelPick {
  readonly itemId: string
  readonly name: string
}

let pick: CancelPick | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function startCancelPick(next: CancelPick): void {
  pick = next
  emit()
}

export function stopCancelPick(): void {
  if (pick === null) return
  pick = null
  emit()
}

/** The current mode without subscribing; for code that is not a component. */
export const getCancelPick = (): CancelPick | null => pick

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useCancelPick(): CancelPick | null {
  return useSyncExternalStore(subscribe, () => pick, () => pick)
}
