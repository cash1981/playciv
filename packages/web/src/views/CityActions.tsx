/**
 * The city actions that are not a build (task `assisted-city-actions`): flip the
 * basic buildings to their upgraded form, and the press behind the "Start Building
 * Program" button on a city card.
 *
 * Nothing here is a rule. The families, counts and squares come from the engine's
 * `view.you.upgradeOptions`, the server checks the request again against the fresh
 * state, and Undo is the vote every assisted action has.
 */

import { useRef, useState } from 'react'

import { errorMessage, isUnauthorized } from '../App.js'
import type { PlayerView, UpgradeFamilyOption } from '../lib/api.js'
import { api } from '../lib/api.js'
import { isPressInFlight, pressOnce } from './AssistedActions.js'
import type { Run } from './GameView.js'

/**
 * One press of an assisted city action, with the refusal kept for the caller to
 * show next to its button. The refusal stays out of GameView's banner; `run`
 * still reloads afterwards, which is what brings the fresh options. A second click
 * on a press that is still on its way sends nothing and says nothing. An
 * unauthorized error is left to GameView, which signs the player out, and sets no
 * message. The message lasts until the player presses again or the game moves on
 * (a later successful action, or a co-player's, changes the revision).
 */
export function useCityActionPress(
  run: Run,
  view: PlayerView,
): {
  readonly sending: boolean
  readonly message: string | null
  readonly press: (key: string, send: (requestId: string) => Promise<PlayerView>) => void
} {
  const [sending, setSending] = useState(false)
  const [shown, setShown] = useState<{ readonly text: string; readonly rev: number } | null>(null)
  // The revision after the reload that follows the press, read when the press settles.
  const latestRev = useRef(view.rev)
  latestRev.current = view.rev

  function press(key: string, send: (requestId: string) => Promise<PlayerView>): void {
    if (sending || isPressInFlight(key)) return
    let failure: unknown = null
    const quietRun: Run = (action) =>
      run(async () => {
        try {
          return await action()
        } catch (caught) {
          // GameView signs the player out on this one; it is not a refusal to show.
          if (isUnauthorized(caught)) throw caught
          failure = caught
          return undefined
        }
      })
    setSending(true)
    setShown(null)
    void pressOnce(key, quietRun, send, view).then(() => {
      setSending(false)
      if (failure !== null) setShown({ text: errorMessage(failure), rev: latestRev.current })
    })
  }

  const message = shown !== null && shown.rev === view.rev ? shown.text : null
  return { sending, message, press }
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** "A1", "A1 and C2", "A1, C2 and C3". */
function joinSquares(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`
}

/** "Granary to Aqueduct, 3 buildings at A1, C2 and C3". */
export function familyLine(family: UpgradeFamilyOption): string {
  const squares = joinSquares(family.squares.map((square) => square.label))
  return `${family.label}, ${plural(family.count, 'building')} at ${squares}`
}

/**
 * The Upgrades block of the Cities panel: one line and one button per family the
 * viewer can flip now, and "Upgrade all" when there is more than one. Nothing for
 * a spectator, a replay or a locked game (`readOnly`), and nothing when there is
 * nothing to flip, except a refusal still on show: a co-player may have flipped the
 * pieces, so the reload that follows the press can leave no options. It works in any phase: the engine has no phase gate for it.
 */
export function CityActions({
  gameId,
  view,
  busy,
  readOnly,
  run,
}: {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}): React.JSX.Element | null {
  const { sending, message, press } = useCityActionPress(run, view)
  const options = view.you?.upgradeOptions ?? []
  if (readOnly || view.you === null || (options.length === 0 && message === null)) return null
  const playerId = view.you.playerId
  const rev = view.rev

  function upgrade(family: UpgradeFamilyOption | null): void {
    const key = `${gameId}:${playerId}:upgradeBuildings:${family === null ? 'all' : family.basicAssetId}`
    press(key, (requestId) =>
      api.upgradeBuildings(gameId, requestId, rev, family === null ? undefined : family.basicAssetId),
    )
  }

  return (
    <div className="city-upgrades">
      <h3 className="cities-owner">Upgrades</h3>
      {options.length > 0 && (
        <>
          <p className="muted">Flips your basic buildings to the new form. Undo works like the other actions.</p>
          <ul className="city-upgrade-list">
            {options.map((family) => (
              <li key={family.basicAssetId} className="city-upgrade">
                <span className="city-upgrade-line">{familyLine(family)}</span>
                <button
                  type="button"
                  className="small"
                  disabled={busy || sending}
                  onClick={() => upgrade(family)}
                >
                  {`Upgrade ${family.label} (${family.count})`}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {options.length > 1 && (
        <button type="button" className="small" disabled={busy || sending} onClick={() => upgrade(null)}>
          Upgrade all
        </button>
      )}
      {message !== null && (
        <p role="alert" className="city-error">
          {message}
        </p>
      )}
    </div>
  )
}
