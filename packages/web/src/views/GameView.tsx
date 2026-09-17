/**
 * The game itself. Replaces the game page in old-civ-web.
 *
 * All state arrives as a `PlayerView`, that is the player's own view. The
 * contents of other hands are not in the response, so the client cannot leak
 * them by accident.
 */

import { useCallback, useEffect, useState } from 'react'

import { itemName } from '@civ/engine'
import type { Item, SheetName } from '@civ/engine'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerDto, PlayerView } from '../lib/api.js'

import { BoardView } from './BoardView.js'
import { ItemCard } from './ItemCard.js'
import { LogPanel } from './LogPanel.js'
import { RevealedPanel } from './RevealedPanel.js'
import { StatusPanel } from './StatusPanel.js'
import { TechPanel } from './TechPanel.js'
import { TurnPanel } from './TurnPanel.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'

interface Props {
  readonly gameId: string
  readonly player: PlayerDto
  readonly onUnauthorized: () => void
  readonly onDeleted: () => void
}

/** What can be drawn. Techs are chosen, so they are not listed here. */
const DRAWABLE: readonly { readonly sheet: SheetName; readonly label: string }[] = [
  { sheet: 'CIV', label: 'Civ' },
  { sheet: 'CULTURE_1', label: 'Culture I' },
  { sheet: 'CULTURE_2', label: 'Culture II' },
  { sheet: 'CULTURE_3', label: 'Culture III' },
  { sheet: 'GREAT_PERSON', label: 'Great Person' },
  { sheet: 'INFANTRY', label: 'Infantry' },
  { sheet: 'ARTILLERY', label: 'Artillery' },
  { sheet: 'MOUNTED', label: 'Mounted' },
  { sheet: 'AIRCRAFT', label: 'Aircraft' },
  { sheet: 'HUTS', label: 'Huts' },
  { sheet: 'VILLAGES', label: 'Villages' },
  { sheet: 'TILES', label: 'Tiles' },
  { sheet: 'CITY_STATES', label: 'City-states' },
  { sheet: 'ANCIENT_WONDERS', label: 'Ancient wonder' },
  { sheet: 'MEDIEVAL_WONDERS', label: 'Medieval wonder' },
  { sheet: 'MODERN_WONDERS', label: 'Modern wonder' },
]

export function GameView({ gameId, player, onUnauthorized, onDeleted }: Props): React.JSX.Element {
  const [view, setView] = useState<PlayerView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)

  const reload = useCallback(async () => {
    try {
      setView(await api.game(gameId))
      setError(null)
    } catch (caught) {
      if (isUnauthorized(caught)) return onUnauthorized()
      setError(errorMessage(caught))
    }
  }, [gameId, onUnauthorized])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * Runs an action and takes the new view from the response. Every writing
   * endpoint answers with an updated `PlayerView`, so no extra fetch is needed.
   */
  const run = useCallback(
    async (action: () => Promise<PlayerView | unknown>) => {
      setBusy(true)
      setError(null)
      try {
        const result = await action()
        if (result !== undefined && result !== null && typeof result === 'object' && 'you' in result) {
          setView(result as PlayerView)
        } else {
          await reload()
        }
        setReloadCount((count) => count + 1)
      } catch (caught) {
        if (isUnauthorized(caught)) return onUnauthorized()
        setError(errorMessage(caught))
      } finally {
        setBusy(false)
      }
    },
    [reload, onUnauthorized],
  )

  if (view === null) {
    return (
      <>
        {error !== null && <div className="error">{error}</div>}
        <p className="muted">Loading the game …</p>
      </>
    )
  }

  const you = view.you
  const yourTurn = you?.yourTurn === true

  /**
   * The public log, flattened for the board's replay view. Private entries
   * carry `privateLog` as well, but the board shows only what everyone can see.
   */
  const boardLog = view.log
    .map((entry) => ({ id: entry.id, message: entry.publicLog }))
    .filter((entry) => entry.message !== '')

  return (
    <>
      <div className="panel">
        <div className="row">
          <h1 style={{ margin: 0 }}>{view.name}</h1>
          {!view.active && <span className="tag">ended</span>}
          {view.winner !== null && <span className="tag revealed">{view.winner} won</span>}
          {you?.civilization != null && (
            <span className="tag revealed">{you.civilization.name}</span>
          )}
          {you?.color != null && (
            <span className="tag">
              <span className="swatch" style={{ background: you.color.toLowerCase() }} />{' '}
              {you.color}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {yourTurn ? (
            <span className="tag turn">Your turn</span>
          ) : (
            <span className="muted">
              {view.opponents.find((opponent) => opponent.yourTurn)?.username ?? 'nobody'}’s turn
            </span>
          )}
        </div>

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button disabled={busy || !yourTurn} onClick={() => void run(() => api.endTurn(gameId))}>
            End turn
          </button>
          <button disabled={busy || yourTurn} onClick={() => void run(() => api.takeTurn(gameId))}>
            Take the turn
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="danger"
            disabled={busy || !view.active}
            onClick={() => void run(() => api.withdraw(gameId))}
          >
            Withdraw
          </button>
          {(you?.gameCreator === true || player.role === 'admin') && (
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Delete this game permanently?')) {
                  void run(async () => {
                    await api.deleteGame(gameId)
                    onDeleted()
                  })
                }
              }}
            >
              Delete game
            </button>
          )}
        </div>
      </div>

      {error !== null && <div className="error">{error}</div>}

      {/* The board sits above everything else */}
      <BoardView
        gameId={gameId}
        board={view.board}
        numOfPlayers={view.numOfPlayers}
        areas={view.boardAreas}
        busy={busy}
        run={run}
        log={boardLog}
      />

      <div className="panel-stack">
        <DrawPanel gameId={gameId} busy={busy} yourTurn={yourTurn} run={run} view={view} />
        <HandPanel gameId={gameId} busy={busy} run={run} view={view} />
        <BattlePanel gameId={gameId} busy={busy} run={run} view={view} />
        <TechPanel gameId={gameId} busy={busy} run={run} view={view} reloadCount={reloadCount} />
        <TurnPanel gameId={gameId} busy={busy} run={run} reloadCount={reloadCount} />
        <StatusPanel gameId={gameId} view={view} busy={busy} run={run} />
        <RevealedPanel gameId={gameId} reloadCount={reloadCount} />
        <LogPanel
          gameId={gameId}
          busy={busy}
          run={run}
          player={player}
          reloadCount={reloadCount}
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

export type Run = (action: () => Promise<PlayerView | unknown>) => Promise<void>

interface PanelProps {
  readonly gameId: string
  readonly busy: boolean
  readonly run: Run
  readonly view: PlayerView
}

function DrawPanel({
  gameId,
  busy,
  yourTurn,
  run,
}: PanelProps & { readonly yourTurn: boolean }): React.JSX.Element {
  return (
    <CollapsiblePanel id="draw" title="Draw">
      <p className="muted" style={{ marginTop: 0 }}>
        {yourTurn ? 'It is your turn.' : 'You can only draw on your own turn.'}
      </p>
      <div className="row">
        {DRAWABLE.map(({ sheet, label }) => (
          <button
            key={sheet}
            className="small"
            disabled={busy || !yourTurn}
            onClick={() => void run(() => api.draw(gameId, sheet))}
          >
            {label}
          </button>
        ))}
      </div>
    </CollapsiblePanel>
  )
}

function HandPanel({ gameId, busy, run, view }: PanelProps): React.JSX.Element {
  const items = view.you?.items ?? []
  const opponents = view.opponents

  return (
    <CollapsiblePanel id="hand" title={`Your hand (${items.length})`}>
      {items.length === 0 && <p className="muted">Empty.</p>}
      <ul className="card-grid scroll">
        {items.map((item) => (
          <HandItem
            key={item.id}
            item={item}
            gameId={gameId}
            busy={busy}
            run={run}
            opponents={opponents}
          />
        ))}
      </ul>
    </CollapsiblePanel>
  )
}

function HandItem({
  item,
  gameId,
  busy,
  run,
  opponents,
}: {
  readonly item: Item
  readonly gameId: string
  readonly busy: boolean
  readonly run: Run
  readonly opponents: PlayerView['opponents']
}): React.JSX.Element {
  const [target, setTarget] = useState('')

  return (
    <ItemCard item={item}>
      <span className={item.hidden ? 'tag hidden' : 'tag revealed'}>
        {item.hidden ? 'only you' : 'published'}
      </span>
      {item.hidden && (
        <button
          className="small"
          disabled={busy}
          onClick={() => void run(() => api.revealItem(gameId, item.sheetName, item.itemNumber))}
        >
          Reveal
        </button>
      )}
      <button
        className="small"
        disabled={busy}
        onClick={() =>
          void run(() => api.discardItem(gameId, item.sheetName, item.itemNumber, itemName(item)))
        }
      >
        Discard
      </button>
      <button
        className="small"
        disabled={busy}
        onClick={() => void run(() => api.itemBackToDeck(gameId, item.sheetName, itemName(item)))}
      >
        Back to deck
      </button>
      <select
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        style={{ width: 'auto' }}
      >
        <option value="">give to …</option>
        {opponents.map((opponent) => (
          <option key={opponent.playerId} value={opponent.playerId}>
            {opponent.username}
          </option>
        ))}
      </select>
      <button
        className="small"
        disabled={busy || target === ''}
        onClick={() =>
          void run(() =>
            api.tradeItem(gameId, item.sheetName, item.itemNumber, itemName(item), target),
          )
        }
      >
        Give
      </button>
    </ItemCard>
  )
}

function BattlePanel({ gameId, busy, run, view }: PanelProps): React.JSX.Element {
  const [count, setCount] = useState(3)
  const battlehand = view.you?.battlehand ?? []
  const barbarians = view.you?.barbarians ?? []

  return (
    <CollapsiblePanel id="battle" title="Battle">

      <div className="row">
        <input
          type="number"
          min={1}
          max={20}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
          style={{ width: '5rem' }}
        />
        <button
          disabled={busy}
          onClick={() => void run(() => api.drawBattlehand(gameId, count))}
        >
          Draw battlehand
        </button>
        <button
          disabled={busy || battlehand.length === 0}
          onClick={() => void run(() => api.revealBattlehand(gameId))}
        >
          Reveal
        </button>
        <button disabled={busy} onClick={() => void run(() => api.endBattle(gameId))}>
          End battle
        </button>
      </div>

      <h3 style={{ marginTop: '0.8rem' }}>Battlehand ({battlehand.length})</h3>
      {battlehand.length === 0 && <p className="muted">Empty.</p>}
      <ul className="card-grid small">
        {battlehand.map((unit) => (
          <ItemCard key={unit.id} item={unit} />
        ))}
      </ul>

      <h3 style={{ marginTop: '0.8rem' }}>Barbarians ({barbarians.length})</h3>
      <div className="row">
        <button
          disabled={busy || barbarians.length > 0}
          onClick={() => void run(() => api.drawBarbarians(gameId))}
        >
          Draw 3
        </button>
        <button
          disabled={busy || barbarians.length === 0}
          onClick={() => void run(() => api.discardBarbarians(gameId))}
        >
          Discard
        </button>
      </div>
      <ul className="card-grid small">
        {barbarians.map((unit) => (
          <ItemCard key={unit.id} item={unit} />
        ))}
      </ul>
    </CollapsiblePanel>
  )
}

