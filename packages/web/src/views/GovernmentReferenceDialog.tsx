/**
 * The government card reference: every government card with its printed effects.
 * One copy for the status sidebar (its `?`) and the Social policy panel's `?`
 * (through `openGovernmentReference`), so both open the same dialog. Public player
 * aid; it never shows a player's choice.
 */

import type { RefObject } from 'react'

import { GOVERNMENT_CARDS } from '@civ/engine'

import { ReferenceCard } from './ReferenceCard.js'
import { ReferenceDialog } from './ReferenceDialog.js'

interface Props {
  readonly onClose: () => void
  /** The `?` button that opened the dialog; it regains focus on close. */
  readonly returnFocusTo?: RefObject<HTMLElement | null>
}

export function GovernmentReferenceDialog({ onClose, returnFocusTo }: Props): React.JSX.Element {
  return (
    <ReferenceDialog
      titleId="government-reference-title"
      title="Government card reference"
      {...(returnFocusTo === undefined ? {} : { returnFocusTo })}
      onClose={onClose}
    >
      <p className="muted">
        Card effects are shown for reference only; the status dropdown does not enforce them.
      </p>
      <div className="reference-card-grid">
        {GOVERNMENT_CARDS.map((card) => (
          <ReferenceCard
            key={card.government}
            name={card.government}
            image={`/governments/${card.government.toLowerCase()}.jpg`}
            imageAlt={`${card.government} government card`}
          >
            {card.effects.map((effect) => <p key={effect}>{effect}</p>)}
          </ReferenceCard>
        ))}
      </div>
    </ReferenceDialog>
  )
}

/** The window event that opens the government card reference from outside the status sidebar. */
export const OPEN_GOVERNMENT_REFERENCE = 'civ:open-government-reference'

/** Asks the status sidebar to open the same reference its own `?` opens. */
export function openGovernmentReference(): void {
  window.dispatchEvent(new Event(OPEN_GOVERNMENT_REFERENCE))
}
