/**
 * The other players' cities, read only (tasks `city-production` and
 * `cities-in-actions`): the production figure and its arithmetic, nothing to press.
 *
 * The viewer's own cities are in "Your actions" (`YourCities.tsx`), where the
 * controls are. A player sees this panel only when an opponent has a city on the
 * map; a spectator has no cities of their own, so it lists every city.
 */

import type { PlayerView } from '../lib/api.js'
import { CityCard } from './CityCard.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'

export function CitiesPanel({ view }: { readonly view: PlayerView }): React.JSX.Element | null {
  const groups = view.opponents
    .map((opponent) => ({ opponent, cities: opponent.cities ?? [] }))
    .filter((group) => group.cities.length > 0)
  const count = groups.reduce((total, group) => total + group.cities.length, 0)
  const spectator = view.you === null
  // A player's own cities are in Your actions, so with no opponent city there is nothing to show here.
  if (count === 0 && !spectator) return null

  return (
    <CollapsiblePanel
      id="cities"
      title={spectator ? `Cities (${count})` : `Opponents' cities (${count})`}
      defaultOpen={false}
    >
      <p className="muted">Cities that are not on the map are not listed.</p>
      {count === 0 && <p className="muted">No cities on the map.</p>}

      {groups.map(({ opponent, cities }) => (
        <div key={opponent.playerId} className="cities-group">
          <h3 className="cities-owner">{opponent.username}</h3>
          <ul className="cities-list">
            {cities.map((city) => (
              <CityCard key={city.pieceId} city={city} />
            ))}
          </ul>
        </div>
      ))}
    </CollapsiblePanel>
  )
}
