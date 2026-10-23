/**
 * Draws the toasts from `lib/toasts.ts`: green for done, red for failed, on top of
 * the page wherever the player has scrolled to. A success closes itself after a few
 * seconds, a failure after a longer wait or with the close button. Holding the
 * pointer over a toast, or focus inside it, stops its clock.
 */

import { useEffect, useState } from 'react'

import { TOAST_MS, dismissToast, useToasts } from '../lib/toasts.js'
import type { Toast } from '../lib/toasts.js'
import './ToastRegion.css'

function ToastItem({ toast }: { readonly toast: Toast }): React.JSX.Element {
  const [held, setHeld] = useState(false)
  // The store hands out a fresh object for a repeated message, which restarts the clock.
  useEffect(() => {
    if (held) return undefined
    const timer = setTimeout(() => dismissToast(toast.id), TOAST_MS[toast.kind])
    return () => clearTimeout(timer)
  }, [toast, held])

  return (
    <div
      className={`toast toast-${toast.kind}`}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="toast-text">{toast.text}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => dismissToast(toast.id)}
      >
        ×
      </button>
    </div>
  )
}

/**
 * The two live regions stay mounted when there is nothing to say: a polite one for
 * the successes and an assertive one for the failures. A screen reader announces
 * text that arrives in a region it already knows, but often not a region that
 * appears with its text in it.
 */
export function ToastRegion(): React.JSX.Element {
  const toasts = useToasts()
  return (
    <div className="toast-region" role="region" aria-label="Notifications">
      <div className="toast-live" role="status">
        {toasts
          .filter((toast) => toast.kind === 'ok')
          .map((toast) => (
            <ToastItem key={toast.id} toast={toast} />
          ))}
      </div>
      <div className="toast-live" role="alert">
        {toasts
          .filter((toast) => toast.kind === 'error')
          .map((toast) => (
            <ToastItem key={toast.id} toast={toast} />
          ))}
      </div>
    </div>
  )
}
