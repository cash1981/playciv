/**
 * A per-player status board: one row per player (yourself and every opponent).
 *
 * Replaces the old shared asset spreadsheet. All values shown here are shared
 * bookkeeping that ANY member may edit for ANY player, saved through
 * `api.setPlayerStat` and `api.setPlayerGovernment`.
 */

import { useEffect, useRef, useState } from 'react'

import { GOVERNMENT_CARDS, GOVERNMENTS } from '@civ/engine'
import type { Government } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerStats, PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import type { Run } from './GameView.js'

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}

interface Row {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
  readonly yourTurn: boolean
  readonly civilizationName: string | null
  readonly government: Government
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
  { key: 'mvmt', label: 'Movement' },
  { key: 'combat', label: 'Combat', signed: true },
  { key: 'handSize', label: 'Hand Size' },
]

const INVESTMENT_COLUMNS: readonly StatColumn[] = [
  { key: 'efta', label: 'EftA' },
  { key: 'infra', label: 'Infra' },
  { key: 'mic', label: 'MIC' },
  { key: 'pe', label: 'PE' },
]

const STATUS_GROUPS: readonly { readonly label: string; readonly columns: readonly StatColumn[] }[] = [
  { label: 'Trade, Coins & Culture cards', columns: ACCOUNTING_COLUMNS },
  { label: 'Units', columns: UNIT_COLUMNS },
  { label: 'Modifier', columns: MODIFIER_COLUMNS },
  { label: 'Investments', columns: INVESTMENT_COLUMNS },
]

const COLUMN_COUNT = 3 + ACCOUNTING_COLUMNS.length + UNIT_COLUMNS.length + MODIFIER_COLUMNS.length + INVESTMENT_COLUMNS.length

/** Keys of the first column in each group — used to draw vertical section dividers. */
const GROUP_START_KEYS = new Set(STATUS_GROUPS.map((g) => g.columns[0]!.key))

export function StatusPanel({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element {
  const [showGovernmentReference, setShowGovernmentReference] = useState(false)
  const governmentHelpRef = useRef<HTMLButtonElement | null>(null)
  const governmentCloseRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!showGovernmentReference) return
    governmentCloseRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setShowGovernmentReference(false)
        return
      }
      if (event.key !== 'Tab') return
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="government-reference-title"]')
      if (dialog === null) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showGovernmentReference])

  useEffect(() => {
    if (!showGovernmentReference) governmentHelpRef.current?.focus()
  }, [showGovernmentReference])
  const rows: Row[] = []

  if (view.you !== null) {
    rows.push({
      playerId: view.you.playerId,
      username: view.you.username,
      color: view.you.color,
      yourTurn: view.you.yourTurn,
      civilizationName: view.you.civilization?.name ?? null,
      government: view.you.government,
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
      government: opponent.government,
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
              <th rowSpan={2}>Government</th>
              {STATUS_GROUPS.map((group, i) => (
                <th
                  key={group.label}
                  colSpan={group.columns.length}
                  className={`status-group-heading${i > 0 ? ' status-group-start' : ''}`}
                >
                  {group.label}
                </th>
              ))}
            </tr>
            <tr>
              {STATUS_GROUPS.flatMap((group) => group.columns).map((column) => (
                <th
                  key={column.key}
                  className={GROUP_START_KEYS.has(column.key) ? 'status-group-start' : undefined}
                >
                  {column.label}
                </th>
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
                <td>
                  <span className="government-control">
                    <select
                      className="government-select"
                      aria-label={`${row.username} government`}
                      value={row.government}
                      disabled={busy || readOnly}
                      onChange={(event) =>
                        void run(() =>
                          api.setPlayerGovernment(
                            gameId,
                            row.playerId,
                            event.target.value as Government,
                          ),
                        )
                      }
                    >
                      {GOVERNMENTS.map((government) => (
                        <option key={government} value={government}>{government}</option>
                      ))}
                    </select>
                    <button
                      className="government-help"
                      type="button"
                      ref={governmentHelpRef}
                      aria-label="Show government card reference"
                      title="Show government card reference"
                      onClick={() => setShowGovernmentReference(true)}
                    >
                      ?
                    </button>
                  </span>
                </td>
                {STATUS_GROUPS.flatMap((group) => group.columns).map((column) => (
                  <td
                    key={column.key}
                    className={GROUP_START_KEYS.has(column.key) ? 'status-group-start' : undefined}
                  >
                    <StatCell
                      value={row.stats[column.key]}
                      signed={column.signed === true}
                      disabled={busy || readOnly}
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
      {showGovernmentReference && (
        <div className="government-reference-backdrop" role="presentation" onClick={() => setShowGovernmentReference(false)}>
          <section
            className="government-reference"
            role="dialog"
            aria-modal="true"
            aria-labelledby="government-reference-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="government-reference-heading">
              <h2 id="government-reference-title">Government card reference</h2>
              <button ref={governmentCloseRef} type="button" onClick={() => setShowGovernmentReference(false)}>Close</button>
            </div>
        <p className="muted">
          Card effects are shown for reference only; the status dropdown does not enforce them.
        </p>
        <div className="government-card-grid">
          {GOVERNMENT_CARDS.map((card) => (
            <article className="government-card" key={card.government}>
              <img
                className="government-card-image"
                src={`/governments/${card.government.toLowerCase()}.jpg`}
                alt={`${card.government} government card`}
                loading="lazy"
              />
              <div className="government-card-copy">
                <h3>{card.government}</h3>
                {card.effects.map((effect) => <p key={effect}>{effect}</p>)}
              </div>
            </article>
          ))}
        </div>
          </section>
        </div>
      )}
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
