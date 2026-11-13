/**
 * The Coins panel: one counter per coin source per player.
 *
 * What is left of the old Player status panel. Every other status value (units,
 * modifiers, investments, government, Trade, Culture) moved to the status sidebar
 * beside the map (#342); the per-source Coins counters are the one thing it does not
 * show yet, so this panel stays until they move over too.
 *
 * The counters are shared bookkeeping that ANY member may edit for ANY player,
 * saved through `api.setPlayerCoin`. Since issue #158 the table only offers a
 * source to a player who actually has it.
 */

import {
  ALWAYS_AVAILABLE_COIN_SOURCES,
  activeWonderOwnerIds,
  COIN_SOURCES,
  socialPolicyCoinSource,
  techCoinSource,
  totalCoins,
} from '@civ/engine'
import type { CoinSourceKey, Government } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerStats, PlayerView } from '../lib/api.js'
import { AssistedActionButton } from './AssistedActions.js'
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
 * Owners with an active, unblocked copy of a wonder. Internet coin limits and
 * Panama Canal bookkeeping follow its explicit owner wherever its marker sits.
 */
function wonderOwners(view: PlayerView, assetId: string): ReadonlySet<string> {
  return activeWonderOwnerIds(view.board.pieces, assetId, view.blockadedPieceIds ?? [])
}

/**
 * Owners of a wonder that an enemy figure blockades (issue #241). Read off the
 * public `blockadedPieceIds`, so it depends on the board alone.
 */
function blockadedWonderOwners(view: PlayerView, assetId: string): ReadonlySet<string> {
  const blockaded = new Set(view.blockadedPieceIds ?? [])
  return new Set(
    view.board.pieces
      .filter((piece) => piece.assetId === assetId && blockaded.has(piece.id))
      .map((piece) => piece.ownerId)
      .filter((owner): owner is string => owner != null),
  )
}

export function CoinsPanel({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element {
  const rows: Row[] = []

  if (view.you !== null) {
    rows.push({
      playerId: view.you.playerId,
      username: view.you.username,
      color: view.you.color,
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
      civilizationName: opponent.civilization?.name ?? null,
      government: opponent.government,
      stats: opponent.stats,
      revealedTechNames: opponent.revealedTechs.map((tech) => tech.name),
      revealedPolicyNames: opponent.revealedSocialPolicies.map((policy) => policy.name),
    })
  }

  return (
    <CollapsiblePanel id="coins" title="Coins">
      <p className="muted" style={{ margin: '0 0 0.5rem' }}>
        These counters are shared bookkeeping — anyone in the game can edit them.
        Bank, Adam Smith and Great People are calculated automatically.
      </p>
      <CoinSection
        gameId={gameId}
        rows={rows}
        view={view}
        currentPlayerId={view.you?.playerId ?? null}
        internetOwners={wonderOwners(view, 'wonders/internet')}
        panamaOwners={wonderOwners(view, 'wonders/panamacanal')}
        panamaBlockaded={blockadedWonderOwners(view, 'wonders/panamacanal')}
        busy={busy}
        readOnly={readOnly}
        run={run}
      />
    </CollapsiblePanel>
  )
}

/**
 * The coin sources a player currently has, from public data only (issue #158):
 * the always-available sources, the revealed coin-token techs, Organized
 * Religion, the Democracy government and an active Panama Canal wonder. A
 * source that is not here gets no counter
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
 * The Coins table: one row per coin source, one column per player, each cell
 * a `− / +` counter capped at the source's limit. Since issue #158 only the
 * sources a player actually has get a cell — every other cell is empty, and a
 * row with no cell at all is not drawn. A counter that still holds coins stays
 * visible even when its source is no longer valid, so a value can never be
 * hidden and impossible to lower. A final Total row repeats each player's sum,
 * the same number the sidebar shows as Coins. Bank, Adam Smith and
 * Great People are derived from public state, so they show numbers without
 * counter buttons.
 */
function CoinSection({
  gameId,
  rows,
  view,
  currentPlayerId,
  internetOwners,
  panamaOwners,
  panamaBlockaded,
  busy,
  readOnly,
  run,
}: {
  readonly gameId: string
  readonly rows: readonly Row[]
  /** The viewer's `availableActions` decide the purchase buttons (#260). */
  readonly view: PlayerView
  readonly currentPlayerId: string | null
  readonly internetOwners: ReadonlySet<string>
  readonly panamaOwners: ReadonlySet<string>
  /** Owners whose Panama Canal is blockaded: the engine shows its coins as 0 until it is released. */
  readonly panamaBlockaded: ReadonlySet<string>
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
}): React.JSX.Element {
  const disabled = busy || readOnly
  const available = new Map(
    rows.map((row) => [row.playerId, availableCoinSources(row, panamaOwners)] as const),
  )
  const renders = (row: Row, key: CoinSourceKey): boolean =>
    available.get(row.playerId)?.has(key) === true ||
    row.stats.coinSources[key] > 0 ||
    (key === 'panamaCanal' && panamaBlockaded.has(row.playerId))
  const sources = COIN_SOURCES.filter((source) => rows.some((row) => renders(row, source.key)))
  return (
    <div className="scroll-x">
      <table className="status-table coin-table">
        <thead>
          <tr>
            <th>Coin source</th>
            {rows.map((row) => (
              <th key={row.playerId} className="status-group-start">
                <span className="row" style={{ justifyContent: 'flex-start' }}>
                  {row.color !== null && (
                    <span className="swatch" style={{ background: row.color.toLowerCase() }} />
                  )}
                  {row.civilizationName ?? row.username}
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
                  {source.help.length > 0 && <span className="muted">{source.help}</span>}
                </span>
              </th>
              {rows.map((row) => (
                <td key={row.playerId} className="status-group-start">
                  {renders(row, source.key) && (source.key === 'bank' || source.key === 'greatPeople' || source.key === 'adamSmith') && (
                    // Derived from the tokens on the board (issue #241), so no buttons.
                    <span className="coin-counter">
                      <span className="coin-value" aria-label={`${row.username} ${source.label}`}>
                        {row.stats.coinSources[source.key]}
                      </span>
                    </span>
                  )}
                  {renders(row, source.key) && source.key === 'panamaCanal' && panamaBlockaded.has(row.playerId) && (
                    // The coins stay on the card but are not counted while it is blockaded
                    // (FAQ 2.0 p. 4), so the cell reads 0 whatever number is stored.
                    <span className="coin-counter">
                      <span className="coin-value" aria-label={`${row.username} ${source.label}`}>
                        0
                      </span>
                      <span
                        className="tag blockaded"
                        title="The Panama Canal is blockaded by an enemy figure: its coins are not counted until it is released"
                      >
                        blockaded
                      </span>
                    </span>
                  )}
                  {renders(row, source.key) &&
                    source.key !== 'greatPeople' &&
                    source.key !== 'adamSmith' &&
                    source.key !== 'bank' &&
                    !(source.key === 'panamaCanal' && panamaBlockaded.has(row.playerId)) && (
                    <>
                    <CoinCounter
                      label={`${row.username} ${source.label}`}
                      value={row.stats.coinSources[source.key]}
                      max={
                        source.max !== null &&
                        ['codeOfLaws', 'pottery', 'democracy', 'printingPress', 'education'].includes(source.key) &&
                        internetOwners.has(row.playerId)
                          ? source.max + 2
                          : source.max
                      }
                      disabled={disabled}
                      onChange={(value) =>
                        void run(() => api.setPlayerCoin(gameId, row.playerId, source.key, value))
                      }
                    />
                    {(source.key === 'democracy' || source.key === 'printingPress') &&
                      row.playerId === currentPlayerId && row.revealedTechNames.includes(
                        source.key === 'democracy' ? 'Democracy' : 'Printing Press',
                      ) && (
                        <AssistedActionButton
                          action={source.key}
                          gameId={gameId}
                          view={view}
                          busy={busy}
                          readOnly={readOnly}
                          run={run}
                          detail="blocked"
                          className="button secondary"
                        >
                          {source.key === 'democracy' ? 'Spend 6 trade' : 'Spend 5 culture'}
                        </AssistedActionButton>
                      )}
                    </>
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
                className="coin-total status-group-start"
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
