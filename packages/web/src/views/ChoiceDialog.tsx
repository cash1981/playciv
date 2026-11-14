/**
 * A small modal that asks the player to choose, then OK or Cancel.
 *
 * Used by the tech abilities that need a choice before they are sent (which
 * wonder, which city, which player, which resources). Nothing is sent by
 * opening it; only OK acts, and Cancel, Escape and a click on the backdrop all
 * cancel. It is rendered into `document.body`, so it also works on top of the
 * tech card dialog, and while it is open it owns Escape and Tab so the dialog
 * underneath neither closes nor takes focus.
 */

import { useEffect, useId, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'

import './AssistedActions.css'

interface Props {
  readonly title: string
  readonly okLabel?: string
  readonly okDisabled?: boolean
  readonly onOk: () => void
  readonly onCancel: () => void
  readonly children: ReactNode
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]'

/**
 * What Tab can land on, in order. A radio group is one tab stop (its checked radio, or the first when none is), so the
 * trap and the first focus must use that radio and not whichever one comes first in the document.
 */
function tabbable(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  const isRadio = (element: HTMLElement): element is HTMLInputElement => element instanceof HTMLInputElement && element.type === 'radio'
  const checkedGroups = new Set(all.filter((element) => isRadio(element) && element.checked).map((element) => (element as HTMLInputElement).name))
  const seen = new Set<string>()
  return all.filter((element) => {
    if (!isRadio(element)) return true
    if (checkedGroups.has(element.name)) return element.checked
    if (seen.has(element.name)) return false
    seen.add(element.name)
    return true
  })
}

export function ChoiceDialog({ title, okLabel = 'OK', okDisabled = false, onOk, onCancel, children }: Props): React.JSX.Element {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const okRef = useRef<HTMLButtonElement | null>(null)
  // Kept in a ref so a fresh `onCancel` each render cannot re-run the effect and move focus
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  // The control that had focus when the dialog opened is the one that opened it
  const openerRef = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement)

  useEffect(() => {
    const dialog = dialogRef.current
    const body = dialog?.querySelector('.choice-dialog-body') ?? null
    const first = dialog === null ? undefined : tabbable(dialog).find((element) => body?.contains(element) === true)
    ;(first ?? okRef.current)?.focus({ preventScroll: true })

    // Capture phase on the document: the dialog underneath listens in the bubble phase and never sees these keys
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || dialog === null) return
      const focusable = tabbable(dialog)
      const firstFocusable = focusable[0]
      const lastFocusable = focusable[focusable.length - 1]
      if (firstFocusable === undefined || lastFocusable === undefined) return
      const active = document.activeElement
      if (!dialog.contains(active)) {
        event.preventDefault()
        firstFocusable.focus({ preventScroll: true })
      } else if (event.shiftKey && active === firstFocusable) {
        event.preventDefault()
        lastFocusable.focus({ preventScroll: true })
      } else if (!event.shiftKey && active === lastFocusable) {
        event.preventDefault()
        firstFocusable.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Focus goes back to the button that opened the dialog, when that button is still there
  useEffect(() => {
    return () => {
      const opener = openerRef.current
      // Only a button or link is a real opener: in Safari a clicked button is not focused, and focus must not fall to <body>
      if (opener instanceof HTMLElement && opener.isConnected && opener.matches('button, a, [role="button"]')) opener.focus({ preventScroll: true })
    }
  }, [])

  const stop = (event: MouseEvent): void => event.stopPropagation()

  return createPortal(
    <div className="reference-backdrop" role="presentation" onClick={(event) => { stop(event); onCancel() }}>
      <section ref={dialogRef} className="reference choice-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={stop}>
        <h2 id={titleId}>{title}</h2>
        <div className="choice-dialog-body">{children}</div>
        <div className="choice-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button ref={okRef} type="button" className="primary" disabled={okDisabled} onClick={onOk}>
            {okLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
