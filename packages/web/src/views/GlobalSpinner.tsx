/**
 * The spinner that tells the player something is happening (issue #225).
 *
 * It sits over the whole page, so it also covers the board and the touch
 * screen. It never takes clicks itself: the buttons that matter are already
 * disabled while an action runs. It waits a moment before it appears, so a
 * fast action does not flash it, and it stays up at least a moment once shown,
 * so a slow one does not make it blink.
 */

import { useEffect, useState } from 'react'

import { useIsBusy } from '../lib/activity.js'
import './GlobalSpinner.css'

/** Quicker than this and the action feels instant, so no spinner. */
export const SPINNER_DELAY_MS = 200

/** Once shown, stay at least this long, so it reads as a spinner and not a flicker. */
export const SPINNER_MIN_VISIBLE_MS = 500

export function GlobalSpinner(): React.JSX.Element {
  const busy = useIsBusy()
  const [visible, setVisible] = useState(false)
  const [shownAt, setShownAt] = useState(0)

  useEffect(() => {
    if (busy && !visible) {
      const timer = setTimeout(() => {
        setShownAt(Date.now())
        setVisible(true)
      }, SPINNER_DELAY_MS)
      return () => clearTimeout(timer)
    }
    if (!busy && visible) {
      const remaining = Math.max(0, SPINNER_MIN_VISIBLE_MS - (Date.now() - shownAt))
      const timer = setTimeout(() => setVisible(false), remaining)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [busy, visible, shownAt])

  // The status region stays mounted, so a screen reader announces the text
  // when it appears instead of missing a region that was added with it.
  return (
    <div className="global-spinner" data-active={visible} role="status">
      {visible ? (
        <>
          <span className="global-spinner-ring" aria-hidden="true" />
          <span className="global-spinner-label">Working…</span>
        </>
      ) : null}
    </div>
  )
}
