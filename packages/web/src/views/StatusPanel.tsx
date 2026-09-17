/**
 * A per-player status board: one row per player (yourself and every opponent).
 *
 * Replaces the old shared asset spreadsheet. All values shown here are shared
 * bookkeeping that ANY member may edit for ANY player, saved through
 * `api.setPlayerStat`.
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
}

type StatColumn = {
  readonly key: keyof PlayerStats
  readonly label: string
  readonly signed?: boolean
}

const ACCOUNTING_COLUMNS: readonly StatColumn[] = [
  { key: 'coins', label: 'Coins' },
  { key: 'trade', label: 'Trade' },
  { key: 'culture', label: 'Culture' },
]

const UNIT_COLUMNS: readonly StatColumn[] = [
  { key: 'infantry', label: 'Infantry' },
  { key: 'artillery', label: 'Artillery' },
  { key: 'mounted', label: 'Mounted' },
]

const MODIFIER_COLUMNS: readonly StatColumn[] = [
  { key: 'stacking', label: 'Stacking' },
  { key: 'mvmt', label: 'Mvmt' },
  { key: 'combat', label: 'Combat', signed: true },
  { key: 'handSize', label: 'Hand Size' },
]

const EFTA_COLUMNS: readonly StatColumn[] = [
  { key: 'efta', label: 'EftA' },
  { key: 'infra', label: 'Infra' },
  { key: 'mic', label: 'MIC' },
  { key: 'pe', label: 'PE' },
]

const STATUS_GROUPS: readonly { readonly label: string; readonly columns: readonly StatColumn[] }[] = [
  { label: 'Coins, Trade & Culture', columns: ACCOUNTING_COLUMNS },
  { label: 'Units and Cards', columns: UNIT_COLUMNS },
  { label: 'Default values', columns: MODIFIER_COLUMNS },
  { label: 'Technology & Infrastructure', columns: EFTA_COLUMNS },
]

const COLUMN_COUNT = 2 + ACCOUNTING_COLUMNS.length + UNIT_COLUMNS.length + MODIFIER_COLUMNS.length + EFTA_COLUMNS.length

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
    })
  }

  return (
    <CollapsiblePanel id="status" title="Player status">
      <p className="muted" style={{ margin: '0 0 0.5rem' }}>
        These values are shared bookkeeping — anyone in the game can edit them.
        Unit and modifier values start with the standard defaults shown below.
      </p>
      <div className="scroll-x">
        <table className="status-table">
          <thead>
            <tr>
              <th rowSpan={2}>Player</th>
              <th rowSpan={2}>Civilization</th>
              {STATUS_GROUPS.map((group) => (
                <th key={group.label} colSpan={group.columns.length} className="status-group-heading">
                  {group.label}
                </th>
              ))}
            </tr>
            <tr>
              {STATUS_GROUPS.flatMap((group) => group.columns).map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
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
                {STATUS_GROUPS.flatMap((group) => group.columns).map((column) => (
                  <td key={column.key}>
                    <StatCell
                      value={row.stats[column.key]}
                      signed={column.signed === true}
                      disabled={busy}
                      onCommit={(value) =>
                        void run(() => api.setPlayerStat(gameId, row.playerId, column.key, value))
                      }
                    />
                  </td>
                ))}
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
 * An inline editable integer. Combat may be negative; other values are
 * non-negative. Commits on blur or Enter, and only when the value actually
 * changed, so concurrent edits are not clobbered.
 */
function StatCell({
  value,
  signed = false,
  disabled,
  onCommit,
}: {
  readonly value: number
  readonly signed?: boolean
  readonly disabled: boolean
  readonly onCommit: (value: number) => void
}): React.JSX.Element {
  const displayValue = signed && value >= 0 ? `+${value}` : String(value)
  const [draft, setDraft] = useState(displayValue)

  useEffect(() => {
    setDraft(displayValue)
  }, [displayValue])

  function commit(): void {
    const trimmed = draft.trim()
    const parsed = Number(trimmed)
    // Empty or partial input (e.g. "" or "-") must revert, not save 0.
    if (trimmed === '' || !Number.isInteger(parsed) || (!signed && parsed < 0)) {
      setDraft(displayValue)
      return
    }
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <input
      className="stat-input"
      type="text"
      inputMode="decimal"
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
