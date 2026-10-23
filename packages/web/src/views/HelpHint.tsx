/**
 * A small `?` button for the help text that must not clutter the action panel.
 *
 * The text lives in the same reference dialog governments and social policies use,
 * so it is reachable by keyboard, Escape closes it, and focus returns to the button.
 */

import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ReferenceDialog } from './ReferenceDialog.js'

interface Props {
  /** What the help is about: the dialog title and the button's accessible name. */
  readonly label: string
  readonly children: ReactNode
}

export function HelpHint({ label, children }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()

  return (
    <>
      <button
        type="button"
        className="help-button"
        ref={buttonRef}
        aria-label={`Help: ${label}`}
        title={`Help: ${label}`}
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open && (
        <ReferenceDialog
          titleId={`help-${titleId}`}
          title={label}
          returnFocusTo={buttonRef}
          onClose={() => setOpen(false)}
        >
          {children}
        </ReferenceDialog>
      )}
    </>
  )
}
