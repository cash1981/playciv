/**
 * Selve spillet. Erstatter game-siden i old-civ-web.
 *
 * All tilstand hentes som `PlayerView`, altså spillerens eget syn. Innholdet i
 * andres hender finnes ikke i svaret, så klienten kan ikke lekke det ved uhell.
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

/** Det man kan trekke. Teknologier velges og står derfor ikke her. */
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
   * Kjører en handling og setter det nye synet fra svaret. Alle skrivende
   * endepunkter svarer med oppdatert `PlayerView`, så det trengs ingen ny
   * henting.
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
        <p className="muted">Laster spillet …</p>
      </>
    )
  }

  const you = view.you
  const yourTurn = you?.yourTurn === true

  return (
    <>
      <div className="panel">
        <div className="row">
          <h1 style={{ margin: 0 }}>{view.name}</h1>
          {!view.active && <span className="tag">avsluttet</span>}
          {view.winner !== null && <span className="tag revealed">{view.winner} vant</span>}
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
            <span className="tag turn">Din tur</span>
          ) : (
            <span className="muted">
              {view.opponents.find((opponent) => opponent.yourTurn)?.username ?? 'ingen'} sin tur
            </span>
          )}
        </div>

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button disabled={busy || !yourTurn} onClick={() => void run(() => api.endTurn(gameId))}>
            Avslutt tur
          </button>
          <button disabled={busy || yourTurn} onClick={() => void run(() => api.takeTurn(gameId))}>
            Ta turen
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="danger"
            disabled={busy || !view.active}
            onClick={() => void run(() => api.withdraw(gameId))}
          >
            Trekk deg
          </button>
          <button
            className="danger"
            disabled={busy || !view.active || you?.gameCreator !== true}
            onClick={() => {
              const winner = window.prompt('Brukernavn på vinneren (tomt = ingen vinner)') ?? ''
              void run(() => api.endGame(gameId, winner === '' ? undefined : winner))
            }}
          >
            Avslutt spillet
          </button>
        </div>
      </div>

      {error !== null && <div className="error">{error}</div>}

      {/* Brettet ligger over alt annet, som bedt om */}
      <BoardView gameId={gameId} board={view.board} busy={busy} run={run} />

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
      <h2>Trekk</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {yourTurn ? 'Det er din tur.' : 'Du kan bare trekke når det er din tur.'}
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
      <h2>Hånden din ({items.length})</h2>
      {items.length === 0 && <p className="muted">Tom.</p>}
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
        {item.hidden ? 'skjult' : 'avslørt'}
      </span>
      <span className="muted">#{item.itemNumber}</span>
      <span style={{ flex: 1 }} />
      {item.hidden && (
        <button
          className="small"
          disabled={busy}
          onClick={() => void run(() => api.revealItem(gameId, item.sheetName, item.itemNumber))}
        >
          Avslør
        </button>
      )}
      <button
        className="small"
        disabled={busy}
        onClick={() =>
          void run(() => api.discardItem(gameId, item.sheetName, item.itemNumber, itemName(item)))
        }
      >
        Kast
      </button>
      <button
        className="small"
        disabled={busy}
        onClick={() => void run(() => api.itemBackToDeck(gameId, item.sheetName, itemName(item)))}
      >
        Til stokken
      </button>
      <select
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        style={{ width: 'auto' }}
      >
        <option value="">gi til …</option>
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
        Gi
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
      <h2>Kamp</h2>

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
          Trekk battlehand
        </button>
        <button
          disabled={busy || battlehand.length === 0}
          onClick={() => void run(() => api.revealBattlehand(gameId))}
        >
          Avslør
        </button>
        <button disabled={busy} onClick={() => void run(() => api.endBattle(gameId))}>
          Avslutt kamp
        </button>
      </div>

      <h3 style={{ marginTop: '0.8rem' }}>Battlehand ({battlehand.length})</h3>
      <ul className="list">
        {battlehand.map((unit) => (
          <li key={unit.id}>{revealAll(unit)}</li>
        ))}
        {battlehand.length === 0 && <li className="muted">Tom.</li>}
      </ul>

      <h3 style={{ marginTop: '0.8rem' }}>Barbarer ({barbarians.length})</h3>
      <div className="row">
        <button
          disabled={busy || barbarians.length > 0}
          onClick={() => void run(() => api.drawBarbarians(gameId))}
        >
          Trekk 3
        </button>
        <button
          disabled={busy || barbarians.length === 0}
          onClick={() => void run(() => api.discardBarbarians(gameId))}
        >
          Kast
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
      <h2>Motspillere</h2>
      <ul className="list">
        {view.opponents.map((opponent) => (
          <li key={opponent.playerId}>
            {opponent.color != null && (
              <span className="swatch" style={{ background: opponent.color.toLowerCase() }} />
            )}
            <strong>{opponent.username}</strong>
            {opponent.yourTurn && <span className="tag turn">tur</span>}
            {opponent.civilization != null && (
              <span className="tag revealed">{opponent.civilization.name}</span>
            )}
            {/* Antall, ikke innhold — motorens projeksjon gir ikke mer */}
            <span className="muted">
              {opponent.numberOfItemsInHand} kort · {opponent.numberOfTechsChosen} tech ·{' '}
              {opponent.numberOfSocialPolicies} politikk
            </span>
          </li>
        ))}
        {view.opponents.length === 0 && <li className="muted">Ingen andre har blitt med ennå.</li>}
      </ul>
      <p className="muted" style={{ marginBottom: 0 }}>
        Stokken: {view.numberOfItemsInDeck} kort · kastet: {view.numberOfDiscardedItems}
      </p>
    </section>
  )
}
