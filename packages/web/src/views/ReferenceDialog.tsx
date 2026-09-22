/**
 * A card reference in a modal — governments and social policies.
 *
 * Shared so every reference behaves the same: a dimmed backdrop, dialog
 * semantics, a Close button, a Tab focus trap, Escape to close, and focus
 * returned to the control that opened it when the dialog goes away. The caller
 * supplies the title, the intro copy and the cards (`ReferenceCard`).
 *
 * A reference is public player aid: callers pass the whole card catalogue, never
 * a player's hidden choice.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

interface Props {
  /** Names the heading for `aria-labelledby`; must be unique on the page. */
  readonly titleId: string
  readonly title: string
  readonly onClose: () => void
  /** The control that opened the dialog; it regains focus when this unmounts. */
  readonly returnFocusTo?: RefObject<HTMLElement | null>
  readonly children: ReactNode
}

export function ReferenceDialog({
  titleId,
  title,
  onClose,
  returnFocusTo,
  children,
}: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  // Kept in a ref so a fresh `onClose` each render cannot re-run the effect and
  // steal focus back to Close while the dialog is open.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (dialog === null) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Return focus as the dialog goes away, never on mount. `returnFocusTo` is a
  // ref object the caller keeps stable across renders, so this cleanup only
  // runs on close.
  useEffect(() => {
    const target = returnFocusTo
    return () => target?.current?.focus()
  }, [returnFocusTo])

  return (
    <div className="reference-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className="reference"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reference-heading">
          <h2 id={titleId}>{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
