/**
 * "Choose the action to cancel in the log": playing Mark Twain, Jousting Tourney,
 * Primetime TV or Bread and Circuses, or using Writing, Civil Service or Mass Media, starts this mode, and the log then offers a red Cancel button
 * on each action the card can cancel. One small store, like `toasts.ts`, so the
 * card and the log panel need no shared parent state.
 */

import { useSyncExternalStore } from 'react'

import type { ResourcePaymentChoice } from '@civ/engine'

/** A card of the hand (`itemId`), or a tech that cancels with a Spy (`tech` and the `payment` chosen for it). */
export interface CancelPick {
  readonly name: string
  readonly itemId?: string
  readonly tech?: string
  readonly payment?: ResourcePaymentChoice
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
