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
    <li
      className={`toast toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
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
    </li>
  )
}

export function ToastRegion(): React.JSX.Element | null {
  const toasts = useToasts()
  if (toasts.length === 0) return null
  return (
    <ul className="toast-region" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </ul>
  )
}
