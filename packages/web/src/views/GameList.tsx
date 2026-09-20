/**
 * The front page's game list: old-civ-web's `list.html` split into an
 * **Active games** and a **Finished games** tab, each a sortable, paged table.
 *
 * The old Active Games tab was a `dir-paginate` list (30 per page) with a
 * search box and a "Show my games" checkbox; the Finished Games tab was an
 * ng-table (10 per page) sortable by Created / Name / Number of players. Both
 * tabs are sortable here and both page 10 at a time, per the human's request.
 *
 * Deliberate differences from the old client (see `decisions.md`):
 * - "Show my games" is a real filter on membership (`youAreIn`), not the old
 *   trick of typing the username into the free-text search.
 * - Both tables default to Name ascending, the order the server returns, not
 *   the old finished table's no-op `totalWins desc`.
 * - `#` is the row's position in the whole filtered/sorted list, not the old
 *   active table's page-local `$index`.
 */

import { useState } from 'react'

import type { PlayerDto, PublicGameSummary } from '../lib/api.js'
import { formatTimestamp } from '../lib/formatTimestamp.js'
import { SortableTable } from './SortableTable.js'
import type { SortableColumn } from './SortableTable.js'
import { Tabs } from './Tabs.js'

type Tab = 'active' | 'finished'

const TABS: readonly { readonly key: Tab; readonly label: string }[] = [
  { key: 'active', label: 'Active games' },
  { key: 'finished', label: 'Finished games' },
]

interface Props {
  readonly games: readonly PublicGameSummary[]
  readonly player: PlayerDto | null
  readonly busy: boolean
  readonly onOpenGame: (gameId: string) => void
  readonly onJoin: (gameId: string) => void
}

/** Case-insensitive substring over the name, the type and every player. */
function matchesQuery(game: PublicGameSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return (
    game.name.toLowerCase().includes(needle) ||
    game.gameType.toLowerCase().includes(needle) ||
    game.players.some((player) => player.username.toLowerCase().includes(needle))
  )
}

function actionCell(
  game: PublicGameSummary,
  player: PlayerDto | null,
  busy: boolean,
  onOpenGame: (gameId: string) => void,
  onJoin: (gameId: string) => void,
): React.ReactNode {
  const full = game.players.length >= game.numOfPlayers

  if (player !== null) {
    if (game.youAreIn) {
      return (
        <button type="button" className="small" onClick={() => onOpenGame(game.id)}>
          Open
        </button>
      )
    }
    if (game.active && !full) {
      return (
        <button
          type="button"
          className="small"
          disabled={busy}
          onClick={() => onJoin(game.id)}
        >
          Join
        </button>
      )
    }
    if (game.active) {
      return (
        <button type="button" className="small" disabled>
          Full
        </button>
      )
    }
    return null
  }

  // The old client only offered Join to a signed-in user; keep the current
  // "sign in to join" hint rather than a button that cannot work.
  return game.active && !full ? <span className="muted">Sign in to join</span> : null
}

interface ColumnOptions {
  readonly withAction: boolean
  readonly player: PlayerDto | null
  readonly busy: boolean
  readonly onOpenGame: (gameId: string) => void
  readonly onJoin: (gameId: string) => void
}

/** The old column order: #, Created, Name, Type, Number of players, Players, Action. */
function columnsFor(options: ColumnOptions): readonly SortableColumn<PublicGameSummary>[] {
  const columns: SortableColumn<PublicGameSummary>[] = [
    {
      key: 'index',
      header: '#',
      render: (_game, index) => index + 1,
    },
    {
      key: 'created',
      header: 'Created',
      // A migrated game has no timestamp, so it sorts under the empty string
      // and renders a blank cell (`formatTimestamp` returns '').
      sortValue: (game) => game.createdAt ?? '',
      render: (game) => formatTimestamp(game.createdAt),
    },
    {
      key: 'name',
      header: 'Name',
      sortValue: (game) => game.name,
      render: (game) => (
        <a
          href={`/game/${encodeURIComponent(game.id)}`}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return
            }
            event.preventDefault()
            options.onOpenGame(game.id)
          }}
        >
          {game.name}
        </a>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortValue: (game) => game.gameType,
      render: (game) => game.gameType,
    },
    {
      key: 'players-count',
      header: 'Number of players',
      sortValue: (game) => game.numOfPlayers,
      render: (game) => game.numOfPlayers,
    },
    {
      key: 'players',
      header: 'Players',
      render: (game) =>
        game.players.map((entry) => (
          <span key={entry.username}>
            {entry.username}
            <br />
          </span>
        )),
    },
  ]

  if (options.withAction) {
    columns.push({
      key: 'action',
      header: 'Action',
      render: (game) =>
        actionCell(game, options.player, options.busy, options.onOpenGame, options.onJoin),
    })
  }

  return columns
}

export function GameList({ games, player, busy, onOpenGame, onJoin }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('active')
  const [query, setQuery] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)

  const matching = games.filter(
    (game) => matchesQuery(game, query) && (!onlyMine || game.youAreIn),
  )
  const active = matching.filter((game) => game.active)
  const finished = matching.filter((game) => !game.active)
  // The old caption's total did not react to the free-text filter; keep it a
  // fixed count of the finished games.
  const finishedTotal = games.reduce((count, game) => (game.active ? count : count + 1), 0)

  const activeColumns = columnsFor({ withAction: true, player, busy, onOpenGame, onJoin })
  const finishedColumns = columnsFor({ withAction: false, player, busy, onOpenGame, onJoin })

  return (
    <div className="game-list">
      <div className="games-filter">
        <input
          type="search"
          aria-label="Search games"
          placeholder="Search games"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {player !== null && (
          <label>
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(event) => setOnlyMine(event.target.checked)}
            />{' '}
            Show my games
          </label>
        )}
      </div>

      <Tabs tabs={TABS} active={tab} onSelect={setTab} />

      {tab === 'active' ? (
        <SortableTable
          rows={active}
          columns={activeColumns}
          rowKey={(game) => game.id}
          initialSortKey="name"
          emptyMessage="No active games."
        />
      ) : (
        <>
          <p className="games-caption">Total number of games finished: {finishedTotal}</p>
          <SortableTable
            rows={finished}
            columns={finishedColumns}
            rowKey={(game) => game.id}
            initialSortKey="name"
            emptyMessage="No finished games."
          />
        </>
      )}
    </div>
  )
}
