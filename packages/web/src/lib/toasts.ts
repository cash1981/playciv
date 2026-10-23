/**
 * The toasts: short messages that confirm an action or report that it failed.
 *
 * One small store, like `activity.ts`, so any view can call `showToast` without a
 * provider and `ToastRegion` (mounted once, in `main.tsx`) draws them. A success
 * goes away on its own after a few seconds; a failure stays longer, because it
 * asks the player to do something. The text is whatever the caller passes in. The
 * caller owns what is safe to show: this module never reads the game.
 */

import { useSyncExternalStore } from 'react'

export type ToastKind = 'ok' | 'error'

export interface Toast {
  readonly id: number
  readonly kind: ToastKind
  readonly text: string
}

/** How long a toast stays, when nothing is holding it. */
export const TOAST_MS: Readonly<Record<ToastKind, number>> = { ok: 4000, error: 8000 }

/** At most this many at once; the oldest goes first, so a burst cannot cover the page. */
export const MAX_TOASTS = 4

let toasts: readonly Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * Shows a toast and returns its id. The same text again refreshes the one on screen
 * instead of stacking a second copy.
 */
export function showToast(kind: ToastKind, text: string): number {
  const message = text.trim()
  if (message === '') return -1
  const same = toasts.find((toast) => toast.kind === kind && toast.text === message)
  if (same !== undefined) {
    // A new object with the same id restarts its timer in the region.
    toasts = toasts.map((toast) => (toast === same ? { ...same } : toast))
    emit()
    return same.id
  }
  const toast: Toast = { id: nextId++, kind, text: message }
  toasts = [...toasts, toast].slice(-MAX_TOASTS)
  emit()
  return toast.id
}

export function dismissToast(id: number): void {
  if (!toasts.some((toast) => toast.id === id)) return
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

/** Removes every toast. For leaving a game and for tests. */
export function clearToasts(): void {
  if (toasts.length === 0) return
  toasts = []
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts)
}
