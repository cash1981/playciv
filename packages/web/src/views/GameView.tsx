/**
 * The game itself. Replaces the game page in old-civ-web.
 *
 * All state arrives as a `PlayerView`, that is the player's own view. The
 * contents of other hands are not in the response, so the client cannot leak
 * them by accident.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { itemName } from '@civ/engine'
import type { ArenaUnit, BattleSideId, BattleSideSummary, Item, SheetName } from '@civ/engine'

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
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => {
    try { return localStorage.getItem('civ.autoRefresh') === 'true' } catch { return false }
  })

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
    try { localStorage.setItem('civ.autoRefresh', String(autoRefresh)) } catch {}
    if (!autoRefresh) return
    const id = setInterval(() => { void reload() }, 30_000)
    return () => clearInterval(id)
  }, [autoRefresh, reload])

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
          <button
            className={'small' + (autoRefresh ? ' revealed' : '')}
            onClick={() => setAutoRefresh((v) => !v)}
            title="Auto-refresh every 30 seconds"
          >
            {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
          </button>
          {yourTurn ? (
            <span className="tag turn">Your turn</span>
          ) : (
            <span className="muted">
              {view.opponents.find((opponent) => opponent.yourTurn)?.username ?? 'nobody'}'s turn
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

interface PendingPlacement {
  readonly unitId: string
  readonly side: BattleSideId
  readonly position: number
  readonly attack: number
  readonly health: number
}

function BattlePanel({ gameId, busy, run, view }: PanelProps): React.JSX.Element {
  const [count, setCount] = useState(3)
  const battlehand = view.you?.battlehand ?? []
  const barbarians = view.you?.barbarians ?? []
  const battle = view.battle
  const battleSummary = view.battleSummary ?? []
  const rev = view.rev ?? 0
  const myId = view.you?.playerId ?? ''

  const [opponentId, setOpponentId] = useState('')
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingPlacement | null>(null)

  const dragUnit = draggingUnitId !== null
    ? (battlehand.find((u) => u.id === draggingUnitId) ?? barbarians.find((u) => u.id === draggingUnitId) ?? null)
    : null

  function handleDragStart(unitId: string): void {
    setDraggingUnitId(unitId)
  }

  function handleDropOnArena(side: BattleSideId, position: number): void {
    if (draggingUnitId === null) return
    const unit = battlehand.find((u) => u.id === draggingUnitId) ?? barbarians.find((u) => u.id === draggingUnitId)
    setPending({
      unitId: draggingUnitId,
      side,
      position,
      attack: unit?.attack ?? 0,
      health: unit?.health ?? 0,
    })
    setDraggingUnitId(null)
  }

  function handleClickPlaceInArena(unitId: string, side: BattleSideId, position: number): void {
    const unit = battlehand.find((u) => u.id === unitId) ?? barbarians.find((u) => u.id === unitId)
    setPending({
      unitId,
      side,
      position,
      attack: unit?.attack ?? 0,
      health: unit?.health ?? 0,
    })
  }

  const attackerUnits = battle?.arena.filter((u) => u.side === 'attacker') ?? []
  const defenderUnits = battle?.arena.filter((u) => u.side === 'defender') ?? []
  const maxPositions = Math.max(
    attackerUnits.reduce((m, u) => Math.max(m, u.position), -1),
    defenderUnits.reduce((m, u) => Math.max(m, u.position), -1),
    -1,
  )

  // Which side am I on?
  const mySideInBattle: BattleSideId | null = battle
    ? battle.attacker.playerId === myId
      ? 'attacker'
      : battle.defender.playerId === myId
        ? 'defender'
        : null
    : null

  const attackerSummary: BattleSideSummary | undefined = battleSummary.find((s) => s.side === 'attacker')
  const defenderSummary: BattleSideSummary | undefined = battleSummary.find((s) => s.side === 'defender')

  const allOpponents = [
    { id: 'barbarians', username: 'Barbarians' },
    ...view.opponents.map((o) => ({ id: o.playerId, username: o.username })),
  ]

  return (
    <CollapsiblePanel id="battle" title="Battle">

      {/* — Hand management — */}
      <div className="row">
        <input
          type="number" min={1} max={20} value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          style={{ width: '5rem' }}
        />
        <button disabled={busy} onClick={() => void run(() => api.drawBattlehand(gameId, count))}>
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
          <ItemCard
            key={unit.id}
            item={unit}
            draggable={battle !== null}
            onDragStart={() => handleDragStart(unit.id)}
          >
            {battle !== null && mySideInBattle !== null && (
              <button
                className="small"
                disabled={busy || unit.inBattle}
                onClick={() => handleClickPlaceInArena(unit.id, mySideInBattle, maxPositions + 1)}
              >
                {unit.inBattle ? 'In arena' : 'Place →'}
              </button>
            )}
          </ItemCard>
        ))}
      </ul>

      {/* — Barbarians — */}
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
          <ItemCard
            key={unit.id}
            item={unit}
            draggable={battle !== null}
            onDragStart={() => handleDragStart(unit.id)}
          >
            {battle !== null && (
              <button
                className="small"
                disabled={busy || unit.inBattle}
                onClick={() => handleClickPlaceInArena(unit.id, 'defender', maxPositions + 1)}
              >
                {unit.inBattle ? 'In arena' : 'Place →'}
              </button>
            )}
          </ItemCard>
        ))}
      </ul>

      {/* — Initiate battle — */}
      {battle === null && (
        <div style={{ marginTop: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Start a battle</h3>
          <div className="row">
            <select
              value={opponentId}
              onChange={(e) => setOpponentId(e.target.value)}
              style={{ width: 'auto' }}
            >
              <option value="">Opponent …</option>
              {allOpponents.map((o) => (
                <option key={o.id} value={o.id}>{o.username}</option>
              ))}
            </select>
            <button
              disabled={busy || opponentId === ''}
              onClick={() => void run(() => api.initiateBattle(gameId, opponentId, rev))}
            >
              Start battle
            </button>
          </div>
        </div>
      )}

      {/* — Arena — */}
      {battle !== null && (
        <div style={{ marginTop: '1rem' }}>
          <div className="row" style={{ alignItems: 'center', gap: '1rem' }}>
            <h3 style={{ margin: 0 }}>Arena</h3>
            <span className={`tag${battle.turn === 'attacker' ? ' turn' : ''}`}>
              {attackerSummary?.label ?? 'Attacker'} {battle.turn === 'attacker' ? '← turn' : ''}
            </span>
            <span className={`tag${battle.turn === 'defender' ? ' turn' : ''}`}>
              {defenderSummary?.label ?? 'Defender'} {battle.turn === 'defender' ? '← turn' : ''}
            </span>
            <span style={{ flex: 1 }} />
            <button
              className="small"
              disabled={busy}
              onClick={() => void run(() => api.endBattleTurn(gameId, rev))}
            >
              End turn
            </button>
            <button
              className="small danger"
              disabled={busy}
              onClick={() => void run(() => api.endBattleArena(gameId, rev))}
            >
              End battle
            </button>
          </div>

          {/* Summary bar */}
          {battleSummary.length > 0 && (
            <div className="row battle-summary">
              {battleSummary.map((s) => (
                <div key={s.side} className="battle-summary-side">
                  <strong>{s.label}</strong>
                  <span>{s.unitCount} unit{s.unitCount !== 1 ? 's' : ''}</span>
                  <span>ATK {s.totalAttack}{s.combatBonus > 0 ? ` (+${s.combatBonus})` : ''}</span>
                  <span>HP {s.totalHealth}</span>
                </div>
              ))}
            </div>
          )}

          {/* Arena grid: two columns */}
          <div className="arena-grid">
            <ArenaColumn
              label={attackerSummary?.label ?? 'Attacker'}
              side="attacker"
              units={attackerUnits}
              maxPositions={maxPositions}
              gameId={gameId}
              busy={busy}
              rev={rev}
              run={run}
              draggingUnitId={draggingUnitId}
              onDropUnit={handleDropOnArena}
            />
            <ArenaColumn
              label={defenderSummary?.label ?? 'Defender'}
              side="defender"
              units={defenderUnits}
              maxPositions={maxPositions}
              gameId={gameId}
              busy={busy}
              rev={rev}
              run={run}
              draggingUnitId={draggingUnitId}
              onDropUnit={handleDropOnArena}
            />
          </div>

          {/* Pending placement confirmation */}
          {pending !== null && (
            <div className="arena-placement-form">
              <strong>
                Place {dragUnit?.id !== undefined ? 'unit' : 'unit'} on {pending.side} front #{pending.position}
              </strong>
              <div className="row" style={{ marginTop: '0.4rem' }}>
                <label>
                  ATK
                  <input
                    type="number" min={0} value={pending.attack}
                    onChange={(e) => setPending({ ...pending, attack: Number(e.target.value) })}
                    style={{ width: '4rem', marginLeft: '0.3rem' }}
                  />
                </label>
                <label>
                  HP
                  <input
                    type="number" min={0} value={pending.health}
                    onChange={(e) => setPending({ ...pending, health: Number(e.target.value) })}
                    style={{ width: '4rem', marginLeft: '0.3rem' }}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() => {
                    const p = pending
                    setPending(null)
                    void run(() =>
                      api.placeUnitInArena(gameId, p.unitId, p.side, p.position, p.attack, p.health, rev)
                    )
                  }}
                >
                  Confirm
                </button>
                <button onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </CollapsiblePanel>
  )
}

interface ArenaColumnProps {
  readonly label: string
  readonly side: BattleSideId
  readonly units: readonly ArenaUnit[]
  readonly maxPositions: number
  readonly gameId: string
  readonly busy: boolean
  readonly rev: number
  readonly run: Run
  readonly draggingUnitId: string | null
  readonly onDropUnit: (side: BattleSideId, position: number) => void
}

function ArenaColumn({
  label, side, units, maxPositions, gameId, busy, rev, run, draggingUnitId, onDropUnit,
}: ArenaColumnProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState<number | null>(null)

  const positions = Array.from({ length: maxPositions + 2 }, (_, i) => i)

  return (
    <div className="arena-column">
      <h4 className="arena-column-label">{label}</h4>
      {positions.map((pos) => {
        const unit = units.find((u) => u.position === pos) ?? null
        const isDragOver = dragOver === pos && draggingUnitId !== null
        return (
          <div
            key={pos}
            className={`arena-slot${isDragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(pos) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={() => { setDragOver(null); onDropUnit(side, pos) }}
          >
            {unit !== null ? (
              <ArenaUnitCard unit={unit} gameId={gameId} busy={busy} rev={rev} run={run} />
            ) : (
              <div className="arena-slot-empty">
                {isDragOver ? 'Drop here' : `Front ${pos}`}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface ArenaUnitCardProps {
  readonly unit: ArenaUnit
  readonly gameId: string
  readonly busy: boolean
  readonly rev: number
  readonly run: Run
}

function ArenaUnitCard({ unit, gameId, busy, rev, run }: ArenaUnitCardProps): React.JSX.Element {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function commitStat(key: 'attack' | 'health', value: number): void {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void run(() => api.setArenaUnitStat(gameId, unit.id, key, value, rev))
    }, 600)
  }

  return (
    <div className="arena-unit-card">
      <ItemCard item={unit.unit} />
      <div className="row" style={{ marginTop: '0.3rem' }}>
        <label>
          ATK
          <input
            type="number" min={0} defaultValue={unit.attack}
            onChange={(e) => commitStat('attack', Number(e.target.value))}
            style={{ width: '3.5rem', marginLeft: '0.3rem' }}
          />
        </label>
        <label>
          HP
          <input
            type="number" min={0} defaultValue={unit.health}
            onChange={(e) => commitStat('health', Number(e.target.value))}
            style={{ width: '3.5rem', marginLeft: '0.3rem' }}
          />
        </label>
      </div>
      <button
        className="small danger"
        disabled={busy}
        style={{ marginTop: '0.3rem', width: '100%' }}
        onClick={() => void run(() => api.killArenaUnit(gameId, unit.id, rev))}
      >
        Kill
      </button>
    </div>
  )
}

