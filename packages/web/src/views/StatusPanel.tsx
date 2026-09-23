/**
 * A per-player status board: one row per player (yourself and every opponent).
 *
 * Replaces the old shared asset spreadsheet. All values shown here are shared
 * bookkeeping that ANY member may edit for ANY player, saved through
 * `api.setPlayerStat`, `api.setPlayerGovernment` and `api.setPlayerCoin`.
 *
 * The panel has two sections behind a tab bar: **Status** (the table above) and
 * **Coins** (one counter per coin source per player). The Status table's Coins
 * column is the read-only sum of that player's counters. Since issue #158 the
 * Coins table only offers a source to a player who actually has it.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import {
  ALWAYS_AVAILABLE_COIN_SOURCES,
  COIN_SOURCES,
  GOVERNMENT_CARDS,
  GOVERNMENTS,
  isInWondersArea,
  isMovementValue,
  socialPolicyCoinSource,
  techCoinSource,
  totalCoins,
} from '@civ/engine'
import type { CoinSourceKey, Government, PlayerStatKey } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerStats, PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import type { Run } from './GameView.js'
import { PlayerTabs } from './PlayerTabs.js'
import './PlayerTabs.css'
import { ReferenceCard } from './ReferenceCard.js'
import { ReferenceDialog } from './ReferenceDialog.js'

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
  /**
   * Revealed techs and social policies only, for the viewer too (issue #158).
   * The Coins table is shared, so a hidden card must not add a row to it — the
   * public projections are the only safe source for either column.
   */
  readonly revealedTechNames: readonly string[]
  readonly revealedPolicyNames: readonly string[]
}

/**
 * Who owns the copies of one wonder that sit in the shared Wonders area. The
 * Internet's raised coin limits (issue #145) and the Panama Canal coin source
 * (issue #158) both hang off the owner.
 */
function wonderOwners(view: PlayerView, assetId: string): ReadonlySet<string> {
  return new Set(
    view.board.pieces
      .filter((piece) => piece.assetId === assetId && isInWondersArea(view.board, piece))
      .map((piece) => piece.ownerId)
      .filter((owner): owner is string => owner != null),
  )
}

type Section = 'status' | 'coins'

const SECTIONS = [
  { key: 'status', label: 'Status', color: null },
  { key: 'coins', label: 'Coins', color: null },
] as const

type StatColumn = {
  /**
   * A numeric status value, or `coinTotal`, the read-only sum of the player's
   * coin counters (they are a record, edited in the Coins section).
   */
  readonly key: PlayerStatKey | 'coinTotal'
  readonly label: string
  readonly signed?: boolean
  /**
   * Movement (issue #102) is written as an expression (`3+1`) rather than a
   * plain integer; the cell accepts text and validates it accordingly.
   */
  readonly text?: boolean
}

const ACCOUNTING_COLUMNS: readonly StatColumn[] = [
  { key: 'coinTotal', label: 'Coins' },
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
  { key: 'mvmt', label: 'Movement', text: true },
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
  const [section, setSection] = useState<Section>('status')
  const governmentHelpRef = useRef<HTMLButtonElement | null>(null)
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
      revealedTechNames: view.you.techsChosen
        .filter((tech) => !tech.hidden)
        .map((tech) => tech.name),
      revealedPolicyNames: view.you.socialPolicies
        .filter((policy) => !policy.hidden)
        .map((policy) => policy.name),
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
      revealedTechNames: opponent.revealedTechs.map((tech) => tech.name),
      revealedPolicyNames: opponent.revealedSocialPolicies.map((policy) => policy.name),
    })
  }

  return (
    <CollapsiblePanel id="status" title="Player status">
      <p className="muted" style={{ margin: '0 0 0.5rem' }}>
        These values are shared bookkeeping — anyone in the game can edit them.
        Unit and modifier values start with the standard defaults shown below.
      </p>
      <PlayerTabs
        tabs={SECTIONS}
        active={section}
        onSelect={(key) => setSection(key === 'coins' ? 'coins' : 'status')}
        ariaLabel="Player status sections"
        tabId={(key) => `status-tab-${key}`}
        panelId={(key) => `status-panel-${key}`}
      />
      <div role="tabpanel" id={`status-panel-${section}`} aria-labelledby={`status-tab-${section}`}>
        {section === 'coins' ? (
          <CoinSection
            gameId={gameId}
            rows={rows}
            internetOwners={wonderOwners(view, 'wonders/internet')}
            panamaOwners={wonderOwners(view, 'wonders/panamacanal')}
            busy={busy}
            readOnly={readOnly}
            run={run}
          />
        ) : (
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
                  <tr
                    key={row.playerId}
                    /* Carried as a custom property so the cells' bottom border can
                       take the player's colour; a border set on the row itself would
                       not reach them. */
                    style={
                      row.color === null
                        ? undefined
                        : ({ '--player-color': row.color.toLowerCase() } as CSSProperties)
                    }
                  >
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
                      <span className="card-control">
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
                          className="help-button"
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
                    {STATUS_GROUPS.flatMap((group) => group.columns).map((column) => {
                      const key = column.key
                      return (
                        <td
                          key={key}
                          className={GROUP_START_KEYS.has(key) ? 'status-group-start' : undefined}
                        >
                          {key === 'coinTotal' ? (
                            <span className="stat-total" aria-label={`${row.username} Coins`}>
                              {totalCoins(row.stats.coinSources)}
                            </span>
                          ) : (
                            <StatCell
                              label={`${row.username} ${column.label}`}
                              value={row.stats[key]}
                              signed={column.signed === true}
                              text={column.text === true}
                              disabled={busy || readOnly}
                              onCommit={(value) =>
                                void run(() => api.setPlayerStat(gameId, row.playerId, key, value))
                              }
                            />
                          )}
                        </td>
                      )
                    })}
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
        )}
      </div>
      {showGovernmentReference && (
        <ReferenceDialog
          titleId="government-reference-title"
          title="Government card reference"
          returnFocusTo={governmentHelpRef}
          onClose={() => setShowGovernmentReference(false)}
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
      )}
    </CollapsiblePanel>
  )
}

/**
 * The coin sources a player currently has, from public data only (issue #158):
 * the always-available sources, the eight coin-token techs the player has
 * revealed, Organized Religion, the Democracy government and the Panama Canal
 * wonder in the shared Wonders area. A source that is not here gets no counter
 * in the Coins table.
 */
function availableCoinSources(
  row: Row,
  panamaOwners: ReadonlySet<string>,
): ReadonlySet<CoinSourceKey> {
  const available = new Set<CoinSourceKey>(ALWAYS_AVAILABLE_COIN_SOURCES)
  for (const name of row.revealedTechNames) {
    const key = techCoinSource(name)
    if (key !== undefined) available.add(key)
  }
  for (const name of row.revealedPolicyNames) {
    const key = socialPolicyCoinSource(name)
    if (key !== undefined) available.add(key)
  }
  if (row.government === 'Democracy') available.add('democracyGovernment')
  if (panamaOwners.has(row.playerId)) available.add('panamaCanal')
  return available
}

/**
 * The Coins section: one row per coin source, one column per player, each cell
 * a `− / +` counter capped at the source's limit. Since issue #158 only the
 * sources a player actually has get a cell — every other cell is empty, and a
 * row with no cell at all is not drawn. A counter that still holds coins stays
 * visible even when its source is no longer valid, so a value can never be
 * hidden and impossible to lower. A final Total row repeats each player's sum,
 * the same number the Status table's Coins column shows.
 */
function CoinSection({
  gameId,
  rows,
  internetOwners,
  panamaOwners,
  busy,
  readOnly,
  run,
}: {
  readonly gameId: string
  readonly rows: readonly Row[]
  readonly internetOwners: ReadonlySet<string>
  readonly panamaOwners: ReadonlySet<string>
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}): React.JSX.Element {
  const disabled = busy || readOnly
  const available = new Map(
    rows.map((row) => [row.playerId, availableCoinSources(row, panamaOwners)] as const),
  )
  const renders = (row: Row, key: CoinSourceKey): boolean =>
    available.get(row.playerId)?.has(key) === true || row.stats.coinSources[key] > 0
  const sources = COIN_SOURCES.filter((source) => rows.some((row) => renders(row, source.key)))
  return (
    <div className="scroll-x">
      <table className="status-table coin-table">
        <thead>
          <tr>
            <th>Coin source</th>
            {rows.map((row) => (
              <th key={row.playerId}>
                <span className="row" style={{ justifyContent: 'flex-start' }}>
                  {row.color !== null && (
                    <span className="swatch" style={{ background: row.color.toLowerCase() }} />
                  )}
                  {row.username}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.key}>
              <th scope="row">
                <span className="coin-source">
                  <span>{source.label}</span>
                  {source.help !== '' && <span className="muted">{source.help}</span>}
                </span>
              </th>
              {rows.map((row) => (
                <td key={row.playerId}>
                  {renders(row, source.key) && (
                    <CoinCounter
                      label={`${row.username} ${source.label}`}
                      value={row.stats.coinSources[source.key]}
                      max={
                        source.max !== null &&
                        ['codeOfLaws', 'pottery', 'democracy', 'printingPress'].includes(source.key) &&
                        internetOwners.has(row.playerId)
                          ? source.max + 2
                          : source.max
                      }
                      disabled={disabled}
                      onChange={(value) =>
                        void run(() => api.setPlayerCoin(gameId, row.playerId, source.key, value))
                      }
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={1} className="muted">
                Nobody has joined yet.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {rows.map((row) => (
              <td
                key={row.playerId}
                className="coin-total"
                aria-label={`${row.username} coin total`}
              >
                {totalCoins(row.stats.coinSources)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/**
 * One player's counter for one source. The value is a number between zero and
 * the source's limit; `+` and `−` are disabled at the ends so an out-of-range
 * value cannot be sent, and the engine refuses one anyway.
 */
function CoinCounter({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  readonly label: string
  readonly value: number
  readonly max: number | null
  readonly disabled: boolean
  readonly onChange: (value: number) => void
}): React.JSX.Element {
  const atMax = max !== null && value >= max
  return (
    <span className="coin-counter">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled || value <= 0}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="coin-value" aria-label={label}>
        {value}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled || atMax}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </span>
  )
}

/**
 * An inline editable stat. Most are integers (Combat may be negative);
 * Movement (issue #102) is text, an expression like `3+1`. Commits on blur or
 * Enter, and only when the value actually changed, so concurrent edits are not
 * clobbered. Invalid input reverts rather than saving.
 */
function StatCell({
  label,
  value,
  signed = false,
  text = false,
  disabled,
  onCommit,
}: {
  readonly label: string
  readonly value: number | string
  readonly signed?: boolean
  readonly text?: boolean
  readonly disabled: boolean
  readonly onCommit: (value: number | string) => void
}): React.JSX.Element {
  const displayValue =
    typeof value === 'string' ? value : signed && value >= 0 ? `+${value}` : String(value)
  const [draft, setDraft] = useState(displayValue)

  useEffect(() => {
    setDraft(displayValue)
  }, [displayValue])

  function commit(): void {
    const trimmed = draft.trim()
    if (text) {
      // Movement: `3`, `3+1` and `2+1+1` are allowed; a typo reverts.
      if (!isMovementValue(trimmed)) {
        setDraft(displayValue)
        return
      }
      if (trimmed !== value) onCommit(trimmed)
      return
    }
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
      aria-label={label}
      inputMode={text ? 'text' : 'decimal'}
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
