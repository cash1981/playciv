import type { OpaquePlayerhand, PublicHandCounts } from '@civ/engine'

import { CollapsiblePanel } from './CollapsiblePanel.js'

interface Props {
  readonly opponents: readonly OpaquePlayerhand[]
}

const CATEGORIES: readonly { readonly key: keyof PublicHandCounts; readonly label: string }[] = [
  { key: 'cultureCards', label: 'Culture cards' },
  { key: 'huts', label: 'Huts' },
  { key: 'villages', label: 'Villages' },
  { key: 'greatPersons', label: 'Great people' },
  { key: 'units', label: 'Units' },
]

export function OpponentHandPanel({ opponents }: Props): React.JSX.Element {
  return (
    <CollapsiblePanel id="opponent-hands" title="Other players' hands">
      {opponents.map((opponent) => (
        <section className="opponent-hand" key={opponent.playerId} aria-label={`${opponent.username}'s hand`}>
          <h3>{opponent.username}</h3>
          {CATEGORIES.map(({ key, label }) => {
            const count = opponent.publicHand[key]
            if (count === 0) return null
            return (
              <div className="opponent-hand-category" key={key}>
                <h4>{label} ({count})</h4>
                <ul className="opponent-hand-cards" aria-label={label}>
                  {Array.from({ length: count }, (_, index) => (
                    <li className="opponent-hand-card" key={index} aria-label="Face-down card" />
                  ))}
                </ul>
              </div>
            )
          })}
          {CATEGORIES.every(({ key }) => opponent.publicHand[key] === 0) && <p className="muted">No cards in these categories.</p>}
        </section>
      ))}
    </CollapsiblePanel>
  )
}
