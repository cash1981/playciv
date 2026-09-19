/**
 * The game itself. Replaces the game page in old-civ-web.
 *
 * All state arrives as a `PlayerView`, that is the player's own view. The
 * contents of other hands are not in the response, so the client cannot leak
 * them by accident.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { isUnit, itemName } from '@civ/engine'
import type { ArenaUnit, BattleSideId, BattleSideSummary, Item, SheetName } from '@civ/engine'

import { errorMessage, isUnauthorized } from '../App.js'
import { ApiError, api } from '../lib/api.js'
import type { PlayerDto, PlayerView } from '../lib/api.js'

import { BoardView } from './BoardView.js'
import { ChatPanel } from './ChatPanel.js'
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
        // On conflict: reload so rev is fresh before the next action
        if (caught instanceof ApiError && caught.status === 409) {
          await reload()
        }
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
          reloadCount={reloadCount}
        />
        <ChatPanel
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
  // A unit already placed in the arena is shown there, not in the hand — once
  // it is on the field it should disappear from the source list so it is
  // clear which units are still available to place (issue #68).
  const availableBattlehand = battlehand.filter((u) => !u.inBattle)
  const availableBarbarians = barbarians.filter((u) => !u.inBattle)
  // Whether the standalone (non-arena) "end battle" clean-up has anything to
  // do — clearing inBattle can only matter if a unit somehow still has it set
  // outside of an active arena (issue #68: this button stayed enabled with
  // nothing to end).
  const hasStandaloneInBattleUnit = (view.you?.items ?? []).some((item) => isUnit(item) && item.inBattle)
  const battle = view.battle
  const battleSummary = view.battleSummary ?? []
  const rev = view.rev ?? 0
  const myId = view.you?.playerId ?? ''

  const [opponentId, setOpponentId] = useState('')
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null)
  const [draggingArenaUnitId, setDraggingArenaUnitId] = useState<string | null>(null)

  function handleDragStart(unitId: string): void {
    setDraggingUnitId(unitId)
  }

  function handleArenaDragStart(e: React.DragEvent<HTMLLIElement>, arenaUnitId: string): void {
    e.dataTransfer.setData('text/plain', arenaUnitId)
    setDraggingArenaUnitId(arenaUnitId)
  }

  function placeInArena(unitId: string, side: BattleSideId, position: number): void {
    const unit = battlehand.find((u) => u.id === unitId) ?? barbarians.find((u) => u.id === unitId)
    if (unit === undefined) return
    void run(() => api.placeUnitInArena(gameId, unitId, side, position, unit.attack, unit.health, rev))
  }

  function handleDropOnArena(side: BattleSideId, position: number): void {
    if (draggingArenaUnitId !== null) {
      const arenaUnitId = draggingArenaUnitId
      setDraggingArenaUnitId(null)
      void run(() => api.moveArenaUnit(gameId, arenaUnitId, position, rev))
      return
    }
    if (draggingUnitId === null) return
    placeInArena(draggingUnitId, side, position)
    setDraggingUnitId(null)
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

  // Next free position on my side (for click-to-place fallback)
  const myNextPosition = mySideInBattle === 'attacker'
    ? attackerUnits.reduce((m, u) => Math.max(m, u.position), -1) + 1
    : defenderUnits.reduce((m, u) => Math.max(m, u.position), -1) + 1

  const attackerSummary: BattleSideSummary | undefined = battleSummary.find((s) => s.side === 'attacker')
  const defenderSummary: BattleSideSummary | undefined = battleSummary.find((s) => s.side === 'defender')

  const allOpponents = [
    { id: 'barbarians', username: 'Barbarians' },
    ...view.opponents.map((o) => ({ id: o.playerId, username: o.username })),
  ]

  return (
    <CollapsiblePanel id="battle" title="Battle" defaultOpen={false}>

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
        {battle === null && hasStandaloneInBattleUnit && (
          <button disabled={busy} onClick={() => void run(() => api.endBattle(gameId))}>
            End battle
          </button>
        )}
      </div>

      <h3 style={{ marginTop: '0.8rem' }}>Battlehand ({availableBattlehand.length})</h3>
      {availableBattlehand.length === 0 && <p className="muted">Empty.</p>}
      <ul className="card-grid small">
        {availableBattlehand.map((unit) => (
          <ItemCard
            key={unit.id}
            item={unit}
            draggable={battle !== null}
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', unit.id); handleDragStart(unit.id) }}
          >
            {battle !== null && mySideInBattle !== null &&
              !(battle.defender.kind === 'barbarians' && battle.defender.playerId === myId) && (
              <button
                className="small"
                disabled={busy}
                onClick={() => placeInArena(unit.id, mySideInBattle, myNextPosition)}
              >
                Place →
              </button>
            )}
          </ItemCard>
        ))}
      </ul>

      {/* — Barbarians — */}
      <h3 style={{ marginTop: '0.8rem' }}>Barbarians ({availableBarbarians.length})</h3>
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
        {availableBarbarians.map((unit) => (
          <ItemCard
            key={unit.id}
            item={unit}
            draggable={battle !== null}
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', unit.id); handleDragStart(unit.id) }}
          >
            {battle !== null && battle.defender.kind === 'barbarians' && battle.defender.playerId === myId && (
              <button
                className="small"
                disabled={busy}
                onClick={() => placeInArena(unit.id, 'defender', myNextPosition)}
              >
                Place →
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
            {mySideInBattle !== null && (
              <button
                className="small"
                disabled={busy}
                onClick={() => void run(() => api.endBattleTurn(gameId, rev))}
              >
                End turn
              </button>
            )}
            {mySideInBattle !== null && (
              <button
                className="small danger"
                disabled={busy}
                onClick={() => void run(() => api.endBattleArena(gameId, rev))}
              >
                End battle
              </button>
            )}
          </div>

          {/* Summary bar */}
          {battleSummary.length > 0 && (
            <div className="row battle-summary">
              {battleSummary.map((s) => (
                <div key={s.side} className="battle-summary-side">
                  <strong>{s.label}</strong>
                  <span>{s.unitCount} unit{s.unitCount !== 1 ? 's' : ''}</span>
                  <span>ATK {s.totalAttack}{s.combatBonus !== 0 ? ` (${s.combatBonus > 0 ? '+' : ''}${s.combatBonus})` : ''}</span>
                  <span>HP {s.totalHealth}</span>
                </div>
              ))}
            </div>
          )}

          {/* Arena: one shared frame, two rows */}
          <div className="arena-frame">
            <ArenaRow
              label={attackerSummary?.label ?? 'Attacker'}
              side="attacker"
              units={attackerUnits}
              maxPositions={maxPositions}
              gameId={gameId}
              busy={busy}
              rev={rev}
              run={run}
              draggingUnitId={draggingUnitId}
              draggingArenaUnitId={draggingArenaUnitId}
              onArenaDragStart={handleArenaDragStart}
              onDropUnit={handleDropOnArena}
              canManage={mySideInBattle !== null}
              isOwnSide={mySideInBattle === 'attacker'}
            />
            <ArenaRow
              label={defenderSummary?.label ?? 'Defender'}
              side="defender"
              units={defenderUnits}
              maxPositions={maxPositions}
              gameId={gameId}
              busy={busy}
              rev={rev}
              run={run}
              draggingUnitId={draggingUnitId}
              draggingArenaUnitId={draggingArenaUnitId}
              onArenaDragStart={handleArenaDragStart}
              onDropUnit={handleDropOnArena}
              canManage={mySideInBattle !== null}
              isOwnSide={mySideInBattle === 'defender'}
            />
          </div>
        </div>
      )}
    </CollapsiblePanel>
  )
}

interface ArenaRowProps {
  readonly label: string
  readonly side: BattleSideId
  readonly units: readonly ArenaUnit[]
  readonly maxPositions: number
  readonly gameId: string
  readonly busy: boolean
  readonly rev: number
  readonly run: Run
  readonly draggingUnitId: string | null
  readonly draggingArenaUnitId: string | null
  readonly onArenaDragStart: (e: React.DragEvent<HTMLLIElement>, arenaUnitId: string) => void
  readonly onDropUnit: (side: BattleSideId, position: number) => void
  readonly canManage: boolean
  /** Whether the viewer controls this side — gates moving/returning units. */
  readonly isOwnSide: boolean
}

function ArenaRow({
  label, side, units, maxPositions, gameId, busy, rev, run,
  draggingUnitId, draggingArenaUnitId, onArenaDragStart, onDropUnit, canManage, isOwnSide,
}: ArenaRowProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState<number | null>(null)

  const positions = Array.from({ length: maxPositions + 2 }, (_, i) => i)

  return (
    <div className="arena-row">
      <h4 className="arena-row-label">{label}</h4>
      <div className="arena-row-slots">
        {positions.map((pos) => {
          const unit = units.find((u) => u.position === pos) ?? null
          const isDragOver = dragOver === pos && (draggingUnitId !== null || draggingArenaUnitId !== null)
          return (
            <div
              key={pos}
              className={`arena-slot${isDragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(pos) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => { setDragOver(null); onDropUnit(side, pos) }}
            >
              {unit !== null ? (
                <ArenaUnitCard
                  unit={unit}
                  gameId={gameId}
                  busy={busy}
                  rev={rev}
                  run={run}
                  canManage={canManage}
                  canMove={isOwnSide}
                  onDragStart={(e) => onArenaDragStart(e, unit.id)}
                />
              ) : (
                <div className="arena-slot-empty">
                  {isDragOver ? 'Drop here' : `#${pos}`}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface ArenaUnitCardProps {
  readonly unit: ArenaUnit
  readonly gameId: string
  readonly busy: boolean
  readonly rev: number
  readonly run: Run
  readonly canManage: boolean
  /** Whether the viewer controls this unit's side — gates move/return. */
  readonly canMove: boolean
  readonly onDragStart: (e: React.DragEvent<HTMLLIElement>) => void
}

function ArenaUnitCard({
  unit, gameId, busy, rev, run, canManage, canMove, onDragStart,
}: ArenaUnitCardProps): React.JSX.Element {
  const [attack, setAttack] = useState(unit.attack)
  const [health, setHealth] = useState(unit.health)
  const attackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync when the server sends a fresh value
  useEffect(() => { setAttack(unit.attack) }, [unit.attack])
  useEffect(() => { setHealth(unit.health) }, [unit.health])

  // Cancel pending timers on unmount
  useEffect(() => {
    return () => {
      if (attackTimerRef.current !== null) clearTimeout(attackTimerRef.current)
      if (healthTimerRef.current !== null) clearTimeout(healthTimerRef.current)
    }
  }, [])

  function commitStat(key: 'attack' | 'health', value: number): void {
    const timerRef = key === 'attack' ? attackTimerRef : healthTimerRef
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void run(() => api.setArenaUnitStat(gameId, unit.id, key, value, rev))
    }, 600)
  }

  // The card's own name/number label is otherwise frozen at the printed
  // values from the moment it was placed — show the live attack/health
  // instead, so rotating (or editing the stat fields) visibly changes what
  // the card says it is (issue #71).
  const displayUnit = { ...unit.unit, attack: unit.attack, health: unit.health }

  return (
    <div className={`arena-unit-card${unit.killed ? ' killed' : ''}`}>
      <ItemCard
        item={displayUnit}
        rotation={unit.rotation}
        draggable={canMove}
        onDragStart={onDragStart}
      />
      {unit.killed && <span className="tag discarded">DEAD</span>}
      <button
        className="small"
        disabled={busy}
        style={{ width: '100%' }}
        title="Rotate — cycle which unit level reads right-side up"
        onClick={() => void run(() => api.rotateArenaUnit(gameId, unit.id, rev))}
      >
        ⟲ Rotate
      </button>
      <label>
        ATK
        <input
          type="number" min={0} value={attack}
          onChange={(e) => { const v = Number(e.target.value); setAttack(v); commitStat('attack', v) }}
        />
      </label>
      <label>
        HP
        <input
          type="number" min={0} value={health}
          onChange={(e) => { const v = Number(e.target.value); setHealth(v); commitStat('health', v) }}
        />
      </label>
      {canManage && (
        <button
          className="small danger"
          disabled={busy}
          style={{ marginTop: '0.2rem', width: '100%' }}
          onClick={() => void run(() => api.killArenaUnit(gameId, unit.id, rev))}
        >
          {unit.killed ? 'Undo kill' : 'Kill'}
        </button>
      )}
      {canMove && (
        <button
          className="small"
          disabled={busy}
          style={{ marginTop: '0.2rem', width: '100%' }}
          title="Return to hand — undoes placing this unit"
          onClick={() => void run(() => api.returnArenaUnitToHand(gameId, unit.id, rev))}
        >
          × Return to hand
        </button>
      )}
    </div>
  )
}

