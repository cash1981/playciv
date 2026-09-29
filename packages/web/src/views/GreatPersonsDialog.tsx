/**
 * Every great person in the game, one tab per type, opened from the site menu.
 * The catalogue is the printed list, identical for every game, so this takes no
 * game state and cannot show anyone's hand.
 */

import { useState } from 'react'
import type { RefObject } from 'react'

import { GREAT_PERSON_REFERENCE } from '@civ/engine'
import type { GreatPersonReference } from '@civ/engine'

import { ReferenceCard } from './ReferenceCard.js'
import { ReferenceDialog } from './ReferenceDialog.js'
import { Tabs } from './Tabs.js'

interface Props {
  readonly onClose: () => void
  readonly returnFocusTo?: RefObject<HTMLElement | null>
}

/** Types in the order they first appear in the sheet, each with its people. */
const GROUPS: readonly { readonly type: string; readonly people: readonly GreatPersonReference[] }[] =
  GREAT_PERSON_REFERENCE.reduce<{ type: string; people: GreatPersonReference[] }[]>((groups, person) => {
    const group = groups.find((candidate) => candidate.type === person.type)
    if (group === undefined) groups.push({ type: person.type, people: [person] })
    else group.people.push(person)
    return groups
  }, [])

export function GreatPersonsDialog({ onClose, returnFocusTo }: Props): React.JSX.Element {
  const [active, setActive] = useState(GROUPS[0]?.type ?? '')
  const group = GROUPS.find((candidate) => candidate.type === active)

  return (
    <ReferenceDialog
      titleId="great-persons-title"
      title="Great persons"
      onClose={onClose}
      {...(returnFocusTo === undefined ? {} : { returnFocusTo })}
    >
      <Tabs
        tabs={GROUPS.map(({ type }) => ({ key: type, label: type }))}
        active={active}
        onSelect={setActive}
      />
      <div className="reference-card-grid">
        {(group?.people ?? []).map((person) => (
          <ReferenceCard key={person.name} name={person.name} image={null} imageAlt="">
            <p>{person.description}</p>
          </ReferenceCard>
        ))}
      </div>
    </ReferenceDialog>
  )
}
