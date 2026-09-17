/**
 * A per-player status board: one row per player (yourself and every
 * opponent), built only from what a `PlayerView` already exposes today.
 *
 * Read-only skeleton for issue #43. Editable stats (coins, trade, culture,
 * victory points) and derived fields (culture level, city/building counts)
 * are not in the engine yet, so they are left as a placeholder below rather
 * than guessed at.
 */

import type { PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'

interface Props {
  readonly view: PlayerView
}

interface Row {
  readonly key: string
  readonly username: string
  readonly color: string | null
  readonly yourTurn: boolean
  readonly civilizationName: string | null
  readonly techsChosen: number
  readonly socialPolicies: number
  readonly cardsInHand: number
  readonly battlehand: number
  readonly barbarians: number
}

export function StatusPanel({ view }: Props): React.JSX.Element {
  const rows: Row[] = []

  if (view.you !== null) {
    rows.push({
      key: view.you.playerId,
      username: view.you.username,
      color: view.you.color,
      yourTurn: view.you.yourTurn,
      civilizationName: view.you.civilization?.name ?? null,
      techsChosen: view.you.techsChosen.length,
      socialPolicies: view.you.socialPolicies.length,
      cardsInHand: view.you.items.length,
      battlehand: view.you.battlehand.length,
      barbarians: view.you.barbarians.length,
    })
  }

  for (const opponent of view.opponents) {
    rows.push({
      key: opponent.playerId,
      username: opponent.username,
      color: opponent.color,
      yourTurn: opponent.yourTurn,
      civilizationName: opponent.civilization?.name ?? null,
      techsChosen: opponent.numberOfTechsChosen,
      socialPolicies: opponent.numberOfSocialPolicies,
      cardsInHand: opponent.numberOfItemsInHand,
      battlehand: opponent.battlehand.length,
      barbarians: opponent.numberOfBarbarians,
    })
  }

  return (
    <CollapsiblePanel id="status" title="Player status">
      <table className="status-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Civilization</th>
            <th>Techs</th>
            <th>Policies</th>
            <th>Hand</th>
            <th>Battlehand</th>
            <th>Barbarians</th>
            {/* Editable stats (coins/trade/culture/victory points) and derived fields (culture level, city/building counts) are added in issue #43 integration, once the engine exposes them. */}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <span className="row" style={{ justifyContent: 'flex-start' }}>
                  {row.color !== null && (
                    <span className="swatch" style={{ background: row.color.toLowerCase() }} />
                  )}
                  <strong>{row.username}</strong>
                  {row.yourTurn && <span className="tag turn">turn</span>}
                </span>
              </td>
              <td>
                {row.civilizationName !== null ? (
                  <span className="tag revealed">{row.civilizationName}</span>
                ) : (
                  <span className="muted">hidden</span>
                )}
              </td>
              <td>{row.techsChosen}</td>
              <td>{row.socialPolicies}</td>
              <td>{row.cardsInHand}</td>
              <td>{row.battlehand}</td>
              <td>{row.barbarians}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                Nobody has joined yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </CollapsiblePanel>
  )
}
