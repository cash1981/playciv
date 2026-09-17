/**
 * A per-player status board: one row per player (yourself and every opponent).
 *
 * Replaces the old shared asset spreadsheet (issue #43). Most columns are
 * derived automatically from the game state; the four stat columns (coins,
 * trade, culture, victory points) are shared bookkeeping that ANY member may
 * edit for ANY player, saved through `api.setPlayerStat`.
 */

import { useEffect, useState } from 'react'

import { api } from '../lib/api.js'
import type { PlayerStats, PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import type { Run } from './GameView.js'

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly run: Run
}

interface Row {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
  readonly yourTurn: boolean
  readonly civilizationName: string | null
  readonly stats: PlayerStats
  readonly cultureLevel: number | null
  readonly cities: number
  readonly buildings: number
  readonly techsChosen: number
  readonly socialPolicies: number
  readonly cardsInHand: number
  readonly battlehand: number
  readonly barbarians: number
}

/** The four editable stats, in display order, with their column headers. */
const STAT_COLUMNS: readonly { readonly key: keyof PlayerStats; readonly label: string }[] = [
  { key: 'coins', label: 'Coins' },
  { key: 'trade', label: 'Trade' },
  { key: 'culture', label: 'Culture' },
  { key: 'victoryPoints', label: 'VP' },
]

// Player + Civilization, the editable stats, then the six derived/count columns
// (culture level, cities, buildings, techs, policies, hand, battlehand, barbarians).
const COLUMN_COUNT = 2 + STAT_COLUMNS.length + 8

export function StatusPanel({ gameId, view, busy, run }: Props): React.JSX.Element {
  const rows: Row[] = []

  if (view.you !== null) {
    rows.push({
      playerId: view.you.playerId,
      username: view.you.username,
      color: view.you.color,
      yourTurn: view.you.yourTurn,
      civilizationName: view.you.civilization?.name ?? null,
      stats: view.you.stats,
      cultureLevel: view.you.cultureMarkerLevel,
      cities: view.you.cityCount,
      buildings: view.you.buildingCount,
      techsChosen: view.you.techsChosen.length,
      socialPolicies: view.you.socialPolicies.length,
      cardsInHand: view.you.items.length,
      battlehand: view.you.battlehand.length,
      barbarians: view.you.barbarians.length,
    })
  }

  for (const opponent of view.opponents) {
    rows.push({
      playerId: opponent.playerId,
      username: opponent.username,
      color: opponent.color,
      yourTurn: opponent.yourTurn,
      civilizationName: opponent.civilization?.name ?? null,
      stats: opponent.stats,
      cultureLevel: opponent.cultureMarkerLevel,
      cities: opponent.cityCount,
      buildings: opponent.buildingCount,
      techsChosen: opponent.numberOfTechsChosen,
      socialPolicies: opponent.numberOfSocialPolicies,
      cardsInHand: opponent.numberOfItemsInHand,
      battlehand: opponent.battlehand.length,
      barbarians: opponent.numberOfBarbarians,
    })
  }

  return (
    <CollapsiblePanel id="status" title="Player status">
      <p className="muted" style={{ margin: '0 0 0.5rem' }}>
        Coins, trade, culture and victory points are shared bookkeeping — anyone in
        the game can edit them. Everything else is read from the game.
      </p>
      <div className="scroll-x">
        <table className="status-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Civilization</th>
              {STAT_COLUMNS.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              <th title="Culture-track marker position">Culture lvl</th>
              <th>Cities</th>
              <th>Buildings</th>
              <th>Techs</th>
              <th>Policies</th>
              <th>Hand</th>
              <th>Battlehand</th>
              <th>Barbarians</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.playerId}>
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
                {STAT_COLUMNS.map((column) => (
                  <td key={column.key}>
                    <StatCell
                      value={row.stats[column.key]}
                      disabled={busy}
                      onCommit={(value) =>
                        void run(() => api.setPlayerStat(gameId, row.playerId, column.key, value))
                      }
                    />
                  </td>
                ))}
                <td>{row.cultureLevel ?? <span className="muted">—</span>}</td>
                <td>{row.cities}</td>
                <td>{row.buildings}</td>
                <td>{row.techsChosen}</td>
                <td>{row.socialPolicies}</td>
                <td>{row.cardsInHand}</td>
                <td>{row.battlehand}</td>
                <td>{row.barbarians}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMN_COUNT} className="muted">
                  Nobody has joined yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </CollapsiblePanel>
  )
}

/**
 * An inline editable non-negative integer. Commits on blur or Enter, and only
 * when the value actually changed, so another player's concurrent edits (which
 * arrive as a new `value` prop) are not clobbered.
 */
function StatCell({
  value,
  disabled,
  onCommit,
}: {
  readonly value: number
  readonly disabled: boolean
  readonly onCommit: (value: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  function commit(): void {
    const trimmed = draft.trim()
    const parsed = Number(trimmed)
    // Empty or partial input (e.g. "" or "-") must revert, not save 0.
    if (trimmed === '' || !Number.isInteger(parsed) || parsed < 0) {
      setDraft(String(value))
      return
    }
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <input
      className="stat-input"
      type="number"
      min={0}
      step={1}
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}
