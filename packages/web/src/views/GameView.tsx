/**
 * The game itself. Replaces the game page in old-civ-web.
 *
 * All state arrives as a `PlayerView`, that is the player's own view. The
 * contents of other hands are not in the response, so the client cannot leak
 * them by accident.
 */

import { useCallback, useEffect, useState } from 'react'

import { itemName, revealAll } from '@civ/engine'
import type { Item, SheetName } from '@civ/engine'

import { errorMessage, isUnauthorized } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerDto, PlayerView } from '../lib/api.js'

import { BoardView } from './BoardView.js'
import { LogPanel } from './LogPanel.js'
import { TechPanel } from './TechPanel.js'
import { TurnPanel } from './TurnPanel.js'

interface Props {
  readonly gameId: string
  readonly player: PlayerDto
  readonly onUnauthorized: () => void
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

export function GameView({ gameId, player, onUnauthorized }: Props): React.JSX.Element {
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
          <button
            className="danger"
            disabled={busy || !view.active || you?.gameCreator !== true}
            onClick={() => {
              const winner = window.prompt('Username of the winner (empty for no winner)') ?? ''
              void run(() => api.endGame(gameId, winner === '' ? undefined : winner))
            }}
          >
            End the game
          </button>
        </div>
      </div>

      {error !== null && <div className="error">{error}</div>}

      {/* The board sits above everything else */}
      <BoardView
        gameId={gameId}
        board={view.board}
        areas={view.boardAreas}
        busy={busy}
        run={run}
        log={boardLog}
      />

      <div className="grid">
        <DrawPanel gameId={gameId} busy={busy} yourTurn={yourTurn} run={run} view={view} />
        <HandPanel gameId={gameId} busy={busy} run={run} view={view} />
        <BattlePanel gameId={gameId} busy={busy} run={run} view={view} />
        <TechPanel gameId={gameId} busy={busy} run={run} view={view} reloadCount={reloadCount} />
        <TurnPanel gameId={gameId} busy={busy} run={run} reloadCount={reloadCount} />
        <OpponentPanel view={view} />
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

type Run = (action: () => Promise<PlayerView | unknown>) => Promise<void>

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
    <section className="panel">
      <h2>Draw</h2>
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
    </section>
  )
}

function HandPanel({ gameId, busy, run, view }: PanelProps): React.JSX.Element {
  const items = view.you?.items ?? []
  const opponents = view.opponents

  return (
    <section className="panel">
      <h2>Your hand ({items.length})</h2>
      {items.length === 0 && <p className="muted">Empty.</p>}
      <ul className="list scroll">
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
    </section>
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
    <li>
      <span>{revealAll(item)}</span>
      <span className={item.hidden ? 'tag hidden' : 'tag revealed'}>
        {item.hidden ? 'hidden' : 'revealed'}
      </span>
      <span className="muted">#{item.itemNumber}</span>
      <span style={{ flex: 1 }} />
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
    </li>
  )
}

function BattlePanel({ gameId, busy, run, view }: PanelProps): React.JSX.Element {
  const [count, setCount] = useState(3)
  const battlehand = view.you?.battlehand ?? []
  const barbarians = view.you?.barbarians ?? []

  return (
    <section className="panel">
      <h2>Battle</h2>

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
      <ul className="list">
        {battlehand.map((unit) => (
          <li key={unit.id}>{revealAll(unit)}</li>
        ))}
        {battlehand.length === 0 && <li className="muted">Empty.</li>}
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
      <ul className="list">
        {barbarians.map((unit) => (
          <li key={unit.id}>{revealAll(unit)}</li>
        ))}
      </ul>
    </section>
  )
}

function OpponentPanel({ view }: { readonly view: PlayerView }): React.JSX.Element {
  return (
    <section className="panel">
      <h2>Opponents</h2>
      <ul className="list">
        {view.opponents.map((opponent) => (
          <li key={opponent.playerId}>
            {opponent.color != null && (
              <span className="swatch" style={{ background: opponent.color.toLowerCase() }} />
            )}
            <strong>{opponent.username}</strong>
            {opponent.yourTurn && <span className="tag turn">turn</span>}
            {opponent.civilization != null && (
              <span className="tag revealed">{opponent.civilization.name}</span>
            )}
            {/* Counts, not contents — the projection gives nothing more */}
            <span className="muted">
              {opponent.numberOfItemsInHand} cards · {opponent.numberOfTechsChosen} techs ·{' '}
              {opponent.numberOfSocialPolicies} policies
            </span>
          </li>
        ))}
        {view.opponents.length === 0 && <li className="muted">Nobody else has joined yet.</li>}
      </ul>
      <p className="muted" style={{ marginBottom: 0 }}>
        Deck: {view.numberOfItemsInDeck} cards · discarded: {view.numberOfDiscardedItems}
      </p>
    </section>
  )
}
