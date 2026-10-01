/**
 * What the app is busy doing, in one place (issue #225).
 *
 * Anything that changes data tells this module when it starts and when it is
 * done; the global spinner shows while at least one such thing is running.
 * `request()` reports every write on its own, and a view that keeps a longer
 * "busy" state (a write followed by a reload) reports that state with
 * `useActivity`, so the spinner does not blink off between the two steps.
 *
 * Reads that run in the background, such as the poll for a new revision, are
 * deliberately not reported: a spinner that comes and goes every ten seconds
 * would be noise.
 */

import { useEffect, useSyncExternalStore } from 'react'

let running = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Marks one piece of work as started. Call the returned function once when it is done. */
export function beginActivity(): () => void {
  let finished = false
  running += 1
  emit()
  return () => {
    // A second call must not take away somebody else's count.
    if (finished) return
    finished = true
    running -= 1
    emit()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** True while any reported work is running. */
export function useIsBusy(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => running > 0,
    () => false,
  )
}

/** Reports `active` as work for as long as it is true and the caller is mounted. */
export function useActivity(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined
    return beginActivity()
  }, [active])
}
