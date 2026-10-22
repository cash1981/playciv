/**
 * "Your cities", the section of "Your actions" with everything the viewer does to
 * their own cities (task `cities-in-actions`): the Upgrades block, then one card
 * per city on the map with its production figure, Build, Start Building Program
 * and the field to set production by hand.
 *
 * It lived in the collapsed Cities panel at the bottom of the page, where players
 * did not find it. The Cities panel now lists the other players' cities only.
 */

import { useId } from 'react'

import type { PlayerView } from '../lib/api.js'
import type { BuildFlow } from './buildFlow.js'
import { CityActions } from './CityActions.js'
import { CityCard } from './CityCard.js'
import type { Run } from './GameView.js'

export function YourCities({
  gameId,
  view,
  busy,
  readOnly,
  run,
  build,
}: {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** The Build flow GameView shares with the board. Without it the cards have no Build button. */
  readonly build?: BuildFlow | undefined
}): React.JSX.Element | null {
  const headingId = useId()
  const you = view.you
  if (you === null) return null
  const own = you.cities ?? []

  return (
    <section className="cities-group" aria-labelledby={headingId}>
      <h3 id={headingId} className="cities-owner">
        Your cities
      </h3>

      <CityActions gameId={gameId} view={view} busy={busy} readOnly={readOnly} run={run} />

      {own.length === 0 ? (
        <p className="muted">No cities of yours on the map yet.</p>
      ) : (
        <ul className="cities-list">
          {own.map((city) => (
            <CityCard
              key={city.pieceId}
              city={city}
              own={{
                gameId,
                view,
                busy,
                readOnly,
                run,
                buildOptions: you.buildOptions?.find((options) => options.cityPieceId === city.pieceId),
                cityActions: you.cityActions?.find((actions) => actions.cityPieceId === city.pieceId),
                build,
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
