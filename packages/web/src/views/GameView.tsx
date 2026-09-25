/**
 * The game itself. Replaces the game page in old-civ-web.
 *
 * All state arrives as a `PlayerView`, that is the player's own view. The
 * contents of other hands are not in the response, so the client cannot leak
 * them by accident.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { isTradable, isUnit, itemName, itemType, TURN_PHASE_LABEL } from '@civ/engine'
import type { ArenaUnit, BattleSideId, BattleSideSummary, Item, SheetName } from '@civ/engine'

import { errorMessage, isUnauthorized } from '../App.js'
import { ApiError, api } from '../lib/api.js'
import type { GameRevisionSummary, GameRevisionView, LootCategory, PlayerDto, PlayerView } from '../lib/api.js'

import { BoardView } from './BoardView.js'
import { ChatPanel } from './ChatPanel.js'
import { ItemCard } from './ItemCard.js'
import { LogPanel } from './LogPanel.js'
import type { GameMenuActions } from './Navigation.js'
import { OpponentHandPanel } from './OpponentHandPanel.js'
import { RevealedPanel } from './RevealedPanel.js'
import { SocialPolicyPanel } from './SocialPolicyPanel.js'
import { StatusPanel } from './StatusPanel.js'
import { WondersPanel } from './WondersPanel.js'
import { TechPanel } from './TechPanel.js'
import { TurnPanel } from './TurnPanel.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import './BattleMobile.css'

interface Props {
  readonly gameId: string
  /** `null` for a spectator watching without an account (issue #81). */
  readonly player: PlayerDto | null
  readonly onUnauthorized: () => void
  readonly onDeleted: () => void
  readonly onWithdrawn: () => void
  /**
   * Reports Withdraw/Delete for the site menu's "Game" section (issue #177);
   * `null` while there is nothing to offer yet (spectator who is not an
   * admin, or still loading). Optional so tests that do not care about the
   * menu can omit it. Must be referentially stable (e.g. a `useState`
   * setter, as `App.tsx` passes) — it sits in this effect's dependency
   * array and is called with a fresh object each run, so an inline arrow
   * here would re-run the effect every render.
   */
  readonly onGameActions?: (actions: GameMenuActions | null) => void
}

/**
 * How often the live game checks for changes while auto-refresh is on. The human asked for
 * 10 s specifically; the toggle was introduced at 30 s (issue #63).
 */
export const AUTO_REFRESH_MS = 10_000

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

const LOOT_CATEGORIES: readonly {
  readonly category: LootCategory
  readonly label: string
  readonly sheets: ReadonlySet<SheetName>
}[] = [
  {
    category: 'CULTURE_CARD',
    label: 'Culture Card',
    sheets: new Set(['CULTURE_1', 'CULTURE_2', 'CULTURE_3']),
  },
  { category: 'HUTS', label: 'Huts', sheets: new Set(['HUTS']) },
  { category: 'VILLAGES', label: 'Villages', sheets: new Set(['VILLAGES']) },
]

export async function refreshBeforeLive(
  reload: () => Promise<boolean | void>,
  showLive: () => void,
): Promise<void> {
  if (await reload() === true) showLive()
}

export async function loadConsistentLive(
  loadRevisions: () => Promise<readonly GameRevisionSummary[]>,
  loadView: () => Promise<PlayerView>,
): Promise<{ readonly view: PlayerView; readonly revisions: readonly GameRevisionSummary[] }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Read history first. A later game read is either at that revision or
    // newer, whereas parallel reads could knowingly pair revision 4 with game 3.
    const revisions = await loadRevisions()
    const view = await loadView()
    if (view.rev >= (revisions.at(-1)?.revision ?? -1)) return { view, revisions }
  }
  throw new Error('Could not load a consistent live game snapshot')
}

/**
 * A reload that skips the history when the live game has not moved at all.
 *
 * `rev` is the server's optimistic-concurrency token: every write advances it,
 * including a private note, which writes no revision. It therefore cannot be
 * compared with the newest revision number. Comparing it with the revision of
 * the view we already have is enough: an unchanged `rev` means nothing was
 * written, so no revision can have appeared, while a private note still arrives
 * through the view.
 *
 * Asking the view first costs one request instead of two in the common poll.
 * When the revision did move, the consistent pair is read history-first as
 * before (issue #70), which costs one extra view read on that path.
 *
 * A `null` list means "keep the list you already have".
 */
export async function loadAfterKnownRevision(
  loadRevisions: () => Promise<readonly GameRevisionSummary[]>,
  loadView: () => Promise<PlayerView>,
  knownRevision: number,
): Promise<{
  readonly view: PlayerView
  readonly revisions: readonly GameRevisionSummary[] | null
}> {
  const view = await loadView()
  if (view.rev === knownRevision) return { view, revisions: null }
  return loadConsistentLive(loadRevisions, loadView)
}

export async function reloadIfRevisionChanged(
  readRevision: () => Promise<number>,
  knownRevision: () => number,
  reload: () => Promise<boolean | void>,
): Promise<boolean> {
  const revision = await readRevision()
  return revision === knownRevision() ? false : Boolean(await reload())
}

export async function loadHistoricalIfCurrent(
  load: () => Promise<GameRevisionView>,
  isCurrent: () => boolean,
): Promise<GameRevisionView | null> {
  const revision = await load()
  return isCurrent() ? revision : null
}

export interface GameMenuGate {
  readonly canWithdraw: boolean
  readonly withdrawDisabled: boolean
  readonly canDelete: boolean
  readonly deleteDisabled: boolean
}

/**
 * The booleans behind the site menu's "Game" section (issue #177), pulled
 * out as a pure function so the one real risk in that wiring — who gets
 * Delete and who gets Withdraw — is testable without rendering the whole
 * page. `null` means nothing to offer: the game has not loaded yet, or the
 * viewer is a plain spectator (no hand in this game, not an admin). An
 * admin who never joined still needs Delete, matching old-civ-web's
 * `nav.html`, whose "Admin settings" → "Delete game" was gated only on the
 * admin flag, membership-independent (`GameOption.setShowAdminValue` in
 * `GameController.js`) — `you === null` alone must not suppress it.
 */
export function gameMenuGate(
  currentView: Pick<PlayerView, 'you' | 'active'> | null,
  isAdmin: boolean,
  busyNow: boolean,
): GameMenuGate | null {
  if (currentView === null || (currentView.you === null && !isAdmin)) return null
  const currentYou = currentView.you
  return {
    canWithdraw: currentYou !== null,
    withdrawDisabled: busyNow || !currentView.active,
    canDelete: currentYou?.gameCreator === true || isAdmin,
    deleteDisabled: busyNow,
  }
}

export function GameView({
  gameId,
  player,
  onUnauthorized,
  onDeleted,
  onWithdrawn,
  onGameActions,
}: Props): React.JSX.Element {
  const [view, setView] = useState<PlayerView | null>(null)
  const [revisions, setRevisions] = useState<readonly GameRevisionSummary[]>([])
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null)
  const [historical, setHistorical] = useState<GameRevisionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(() => {
    try { return localStorage.getItem('civ.autoRefresh') === 'true' } catch { return false }
  })
  const liveRevisionRef = useRef(-1)
  const latestStoredRevisionRef = useRef(-1)
  const revisionRequestEpochRef = useRef(0)
  const pollPendingRef = useRef(false)
  const activeGameIdRef = useRef(gameId)
  activeGameIdRef.current = gameId

  const applyLiveView = useCallback((nextView: PlayerView) => {
    if (nextView.rev < liveRevisionRef.current) return
    liveRevisionRef.current = nextView.rev
    setView(nextView)
  }, [])

  const applyRevisionList = useCallback((nextRevisions: readonly GameRevisionSummary[]) => {
    const latest = nextRevisions.at(-1)?.revision ?? -1
    if (latest < latestStoredRevisionRef.current) return
    latestStoredRevisionRef.current = latest
    setRevisions(nextRevisions)
  }, [])

  const reload = useCallback(async () => {
    try {
      const { view: nextView, revisions: nextRevisions } = await loadAfterKnownRevision(
        () => api.revisions(gameId),
        () => api.game(gameId),
        liveRevisionRef.current,
      )
      if (activeGameIdRef.current !== gameId) return false
      applyLiveView(nextView)
      if (nextRevisions !== null) applyRevisionList(nextRevisions)
      setReloadCount((count) => count + 1)
      setError(null)
      return true
    } catch (caught) {
      if (activeGameIdRef.current !== gameId) return false
      // A spectator has no session to lose; an unauthorized response there
      // just means an anonymous read hit a route that still requires an
      // account, not that they were signed out.
      if (isUnauthorized(caught) && player !== null) return onUnauthorized()
      setError(errorMessage(caught))
      return false
    }
  }, [applyLiveView, applyRevisionList, gameId, onUnauthorized, player])

  const showRevision = useCallback(async (revision: number) => {
    const requestEpoch = ++revisionRequestEpochRef.current
    setBusy(true)
    setError(null)
    try {
      const nextHistorical = await loadHistoricalIfCurrent(
        () => api.revision(gameId, revision),
        () => activeGameIdRef.current === gameId && revisionRequestEpochRef.current === requestEpoch,
      )
      if (nextHistorical === null) return
      setHistorical(nextHistorical)
      setSelectedRevision(revision)
    } catch (caught) {
      if (activeGameIdRef.current !== gameId || revisionRequestEpochRef.current !== requestEpoch) return
      if (isUnauthorized(caught) && player !== null) return onUnauthorized()
      setError(errorMessage(caught))
    } finally {
      if (activeGameIdRef.current === gameId && revisionRequestEpochRef.current === requestEpoch) {
        setBusy(false)
      }
    }
  }, [gameId, onUnauthorized, player])

  useEffect(() => {
    revisionRequestEpochRef.current += 1
    liveRevisionRef.current = -1
    latestStoredRevisionRef.current = -1
    setView(null)
    setRevisions([])
    setSelectedRevision(null)
    setHistorical(null)
    setBusy(false)
    setError(null)
  }, [gameId])

  useEffect(() => {
    try { localStorage.setItem('civ.autoRefresh', String(autoRefresh)) } catch {}
    if (!autoRefresh) return
    const poll = async () => {
      if (pollPendingRef.current) return
      pollPendingRef.current = true
      try {
        await reloadIfRevisionChanged(
          async () => (await api.gameRev(gameId)).rev,
          () => activeGameIdRef.current === gameId ? liveRevisionRef.current : -1,
          async () => activeGameIdRef.current === gameId ? reload() : false,
        )
      } catch (caught) {
        if (activeGameIdRef.current === gameId) {
          if (isUnauthorized(caught) && player !== null) onUnauthorized()
          else setError(errorMessage(caught))
        }
      } finally {
        pollPendingRef.current = false
      }
    }
    const id = setInterval(() => { void poll() }, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [autoRefresh, gameId, onUnauthorized, player, reload])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Runs an action, then reloads a consistent live game/history pair. */
  const run = useCallback(
    async (action: () => Promise<PlayerView | unknown>) => {
      setBusy(true)
      setError(null)
      try {
        await action()
        if (activeGameIdRef.current !== gameId) return
        await reload()
        if (activeGameIdRef.current !== gameId) return
      } catch (caught) {
        if (activeGameIdRef.current !== gameId) return
        if (isUnauthorized(caught) && player !== null) return onUnauthorized()
        // On conflict: reload so rev is fresh before the next action
        if (caught instanceof ApiError && caught.status === 409) {
          await reload()
        }
        setError(errorMessage(caught))
      } finally {
        if (activeGameIdRef.current === gameId) setBusy(false)
      }
    },
    [gameId, reload, onUnauthorized, player],
  )

  // Exposes Withdraw/Delete to the site menu's "Game" section (issue #177).
  // Recomputed from `view`/`historical` directly, rather than the
  // `displayedView`/`you` consts below, which only exist after the loading
  // guard: hooks must run unconditionally, before any conditional return.
  useEffect(() => {
    if (onGameActions === undefined) return
    const currentView = selectedRevision !== null && historical !== null ? historical.view : view
    const busyNow = busy || (selectedRevision !== null && historical !== null)
    const gate = gameMenuGate(currentView, player?.role === 'admin', busyNow)
    if (gate === null) {
      onGameActions(null)
      return
    }
    onGameActions({
      ...gate,
      onWithdraw: () => {
        setBusy(true)
        setError(null)
        void api.withdraw(gameId).then(
          () => {
            onWithdrawn()
            // Withdrawing already succeeded; if `onWithdrawn` (e.g.
            // navigating away) got vetoed by unsaved turn orders, this view
            // stays mounted and must not stay stuck busy.
            setBusy(false)
          },
          (caught: unknown) => {
            if (isUnauthorized(caught)) return onUnauthorized()
            setError(errorMessage(caught))
            setBusy(false)
          },
        )
      },
      onDelete: () => {
        void run(async () => {
          await api.deleteGame(gameId)
          onDeleted()
        })
      },
    })
    return () => onGameActions(null)
  }, [onGameActions, view, historical, selectedRevision, busy, gameId, player, onWithdrawn, onDeleted, onUnauthorized, run])

  if (view === null) {
    return (
      <>
        {error !== null && <div className="error">{error}</div>}
        <p className="muted">Loading the game …</p>
      </>
    )
  }

  const replaying = selectedRevision !== null && historical !== null
  const displayedView = replaying ? historical.view : view
  const interactionBusy = busy || replaying
  const you = displayedView.you
  const yourTurn = you?.yourTurn === true

  return (
    <>
      <div className="panel">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <h1 style={{ margin: 0 }}>
            {yourTurn
              ? 'Your turn'
              : `${(displayedView.activeTurn?.username ??
                  displayedView.opponents.find((opponent) => opponent.yourTurn)?.username ??
                  'nobody')}'s turn`}
            {displayedView.activeTurn !== null &&
              ` — ${TURN_PHASE_LABEL[displayedView.activeTurn.phase]} phase`}
          </h1>
          <span className="muted" style={{ fontSize: '0.9rem' }}>{displayedView.name}</span>
          {!displayedView.active && <span className="tag">ended</span>}
          {displayedView.winner !== null && <span className="tag revealed">{displayedView.winner} won</span>}
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
            title={`Auto-refresh every ${AUTO_REFRESH_MS / 1000} seconds`}
          >
            {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
          </button>
        </div>

        <div className="row" style={{ marginTop: '0.6rem' }}>
          {you !== null && (
            <>
              <button disabled={interactionBusy || !yourTurn} onClick={() => void run(() => api.endTurn(gameId))}>
                End turn
              </button>
              <button disabled={interactionBusy || yourTurn} onClick={() => void run(() => api.takeTurn(gameId))}>
                Take the turn
              </button>
            </>
          )}
          {you === null && <span className="muted">Watching (not a player)</span>}
        </div>
      </div>

      <GlobalReplayBar
        revisions={revisions}
        selectedRevision={selectedRevision}
        busy={busy}
        onRevision={(revision) => void showRevision(revision)}
        onLive={() => {
          void (async () => {
            setBusy(true)
            await refreshBeforeLive(reload, () => {
              setSelectedRevision(null)
              setHistorical(null)
            })
            setBusy(false)
          })()
        }}
      />

      {error !== null && <div className="error">{error}</div>}

      {/* The board sits above everything else */}
      <BoardView
        gameId={gameId}
        board={displayedView.board}
        numOfPlayers={displayedView.numOfPlayers}
        areas={displayedView.boardAreas}
        busy={interactionBusy}
        readOnly={replaying}
        youId={you?.playerId ?? null}
        run={run}
      />

      <div className="panel-stack">
        {/* Log and chat sit directly under the board: it is what a player
            reading a turn-by-forum game looks at first. Side by side when the
            viewport has room, stacked when it does not (`.panel-pair`). */}
        <div className="panel-pair">
          <LogPanel
            gameId={gameId}
            busy={busy}
            readOnly={replaying}
            run={run}
            reloadCount={reloadCount}
            historical={historical}
          />
          {player !== null && (
            <ChatPanel
              gameId={gameId}
              busy={busy}
              run={run}
              player={player}
              reloadCount={reloadCount}
              autoRefresh={autoRefresh}
            />
          )}
        </div>
        <DrawPanel gameId={gameId} busy={interactionBusy} yourTurn={yourTurn} run={run} view={displayedView} />
        <HandPanel gameId={gameId} busy={interactionBusy} run={run} view={displayedView} />
        <OpponentHandPanel opponents={displayedView.opponents} />
        <BattlePanel gameId={gameId} busy={interactionBusy} run={run} view={displayedView} />
        <TechPanel gameId={gameId} busy={interactionBusy} run={run} view={displayedView} reloadCount={reloadCount} historical={historical} />
        <SocialPolicyPanel gameId={gameId} busy={interactionBusy} run={run} view={displayedView} reloadCount={reloadCount} historical={historical} />
        <TurnPanel gameId={gameId} busy={interactionBusy} run={run} reloadCount={reloadCount} historical={historical} />
        <StatusPanel
          gameId={gameId}
          view={displayedView}
          busy={interactionBusy}
          readOnly={displayedView.you === null || replaying}
          run={run}
        />
        <WondersPanel
          gameId={gameId}
          view={displayedView}
          busy={interactionBusy}
          readOnly={displayedView.you === null || replaying}
          run={run}
        />
        <RevealedPanel gameId={gameId} reloadCount={reloadCount} historical={historical} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

export function GlobalReplayBar({
  revisions,
  selectedRevision,
  busy,
  onRevision,
  onLive,
}: {
  readonly revisions: readonly GameRevisionSummary[]
  readonly selectedRevision: number | null
  readonly busy: boolean
  readonly onRevision: (revision: number) => void
  readonly onLive: () => void
}): React.JSX.Element | null {
  if (revisions.length === 0) return null
  const selectedIndex = selectedRevision === null
    ? revisions.length - 1
    : revisions.findIndex((entry) => entry.revision === selectedRevision)
  const current = revisions[Math.max(0, selectedIndex)]
  const hasNewer = selectedRevision !== null && selectedIndex < revisions.length - 1
  const canGoBack = selectedIndex > 0
  const canGoForward = selectedRevision !== null && selectedIndex >= 0 && selectedIndex < revisions.length - 1

  return (
    <div className="panel replay-bar global-replay-bar" aria-label="Game revision history">
      <button
        className="small"
        disabled={busy || !canGoBack}
        onClick={() => {
          const previous = revisions[selectedIndex - 1]
          if (previous !== undefined) onRevision(previous.revision)
        }}
      >
        ◀ Back
      </button>
      <button
        className="small"
        disabled={busy || !canGoForward}
        onClick={() => {
          const next = revisions[selectedIndex + 1]
          if (next !== undefined) onRevision(next.revision)
        }}
      >
        Forward ▶
      </button>
      <button className="small primary" disabled={busy || selectedRevision === null} onClick={onLive}>
        Live
      </button>
      <span className={selectedRevision === null ? 'tag turn' : 'tag'}>
        {selectedRevision === null ? 'Live' : `Revision ${selectedRevision}`}
      </span>
      {hasNewer && <span className="tag revealed">Newer revisions available</span>}
      <span className="muted replay-what">
        {current?.privateDescription ?? current?.publicDescription ?? ''}
        {current !== undefined && ` — ${current.actor.username}`}
      </span>
    </div>
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
    <CollapsiblePanel id="draw" title="Draw" defaultOpen>
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
    <CollapsiblePanel id="hand" title={`Your hand (${items.length})`} defaultOpen>
      <LootControls
        items={items}
        opponents={opponents}
        busy={busy}
        onLoot={(category, targetPlayerId) =>
          void run(() => api.loot(gameId, category, targetPlayerId))
        }
      />
      <GreatPersonDiscardControls
        items={items}
        busy={busy}
        onDiscard={(type) => void run(() => api.discardGreatPerson(gameId, type))}
      />
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

export function LootControls({
  items,
  opponents,
  busy,
  onLoot,
}: {
  readonly items: readonly Item[]
  readonly opponents: readonly {
    readonly playerId: string
    readonly username: string
  }[]
  readonly busy: boolean
  readonly onLoot: (category: LootCategory, targetPlayerId: string) => void
}): React.JSX.Element | null {
  const [targetPlayerId, setTargetPlayerId] = useState('')
  const available = LOOT_CATEGORIES.filter(({ sheets }) =>
    items.some((item) => sheets.has(item.sheetName)),
  )

  if (available.length === 0) return null

  return (
    <section aria-label="Loot" style={{ marginBottom: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Loot</h3>
      <p className="muted">Send one randomly selected item from your hand to an opponent.</p>
      <div className="row">
        <select
          aria-label="Player receiving loot"
          value={targetPlayerId}
          onChange={(event) => setTargetPlayerId(event.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="">Opponent …</option>
          {opponents.map((opponent) => (
            <option key={opponent.playerId} value={opponent.playerId}>
              {opponent.username}
            </option>
          ))}
        </select>
        {available.map(({ category, label }) => (
          <button
            key={category}
            className="small danger"
            disabled={busy || targetPlayerId === ''}
            onClick={() => onLoot(category, targetPlayerId)}
          >
            Loot {label}
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * Offers a random discard only for a Great Person type the viewer holds two or
 * more of; with exactly one there is no choice to make, so the ordinary
 * per-card discard covers it (the human's rule — see the task brief). Built
 * from the viewer's own hand only.
 */
export function GreatPersonDiscardControls({
  items,
  busy,
  onDiscard,
}: {
  readonly items: readonly Item[]
  readonly busy: boolean
  readonly onDiscard: (type: string) => void
}): React.JSX.Element | null {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.kind === 'greatperson' && item.type !== null) {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1)
    }
  }
  const duplicates = [...counts]
    .filter(([, count]) => count >= 2)
    .map(([type]) => type)

  if (duplicates.length === 0) return null

  return (
    <section aria-label="Discard a great person" style={{ marginBottom: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Discard a great person</h3>
      <p className="muted">
        You hold more than one of a type, so which card is lost is random. Discard one:
      </p>
      <div className="row">
        {duplicates.map((type) => (
          <button
            key={type}
            className="small danger"
            disabled={busy}
            onClick={() => onDiscard(type)}
          >
            Discard random {type}
          </button>
        ))}
      </div>
    </section>
  )
}

export function HandItem({
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
      <GiveControl
        item={item}
        gameId={gameId}
        busy={busy}
        run={run}
        opponents={opponents}
      />
      {item.kind === 'greatperson' && item.name === 'Sir Isaac Newton' && (
        <PlaceGreatPersonControl item={item} gameId={gameId} busy={busy} run={run} />
      )}
    </ItemCard>
  )
}

/**
 * "Place in tech pyramid" — Sir Isaac Newton's printed effect: *"Before
 * researching, you may place this card facedown in your tech pyramid as a
 * blank tech card of level IV or less. It remains in your tech pyramid for
 * the rest of the game, even if Newton dies."* New in this port, no
 * old-system equivalent — see the pyramid-reposition task brief. Deliberately
 * unvalidated: any pyramid row 1-5 is accepted, not just "level IV or less".
 */
function PlaceGreatPersonControl({
  item,
  gameId,
  busy,
  run,
}: {
  readonly item: Item
  readonly gameId: string
  readonly busy: boolean
  readonly run: Run
}): React.JSX.Element {
  const [slot, setSlot] = useState<1 | 2 | 3 | 4 | 5>(1)

  return (
    <span className="row">
      <select
        aria-label={`Pyramid row for ${itemName(item)}`}
        value={slot}
        disabled={busy}
        onChange={(event) => setSlot(Number(event.target.value) as 1 | 2 | 3 | 4 | 5)}
      >
        {[1, 2, 3, 4, 5].map((level) => (
          <option key={level} value={level}>
            Row {level}
          </option>
        ))}
      </select>
      <button
        className="small"
        disabled={busy}
        onClick={() => void run(() => api.placeGreatPersonInPyramid(gameId, item.id, slot))}
      >
        Place in tech pyramid
      </button>
    </span>
  )
}

/**
 * The "give to …" selector and Give button, shown only for the old `Tradable`
 * cards (Culture I/II/III, Hut, Village). The engine rejects every other kind
 * with `ITEM_NOT_FOUND`, so drawing the control for them only invited a failed
 * click — Great Person, Civ, City-state and the rest get no Give control.
 */
export function GiveControl({
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
}): React.JSX.Element | null {
  const [target, setTarget] = useState('')

  if (!isTradable(item)) return null

  return (
    <>
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
    </>
  )
}

export function BattlePanel({ gameId, busy, run, view }: PanelProps): React.JSX.Element {
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
  const [selectedBattlePiece, setSelectedBattlePiece] = useState<{
    readonly kind: 'hand' | 'arena'
    readonly id: string
  } | null>(null)
  const battleActionInFlightRef = useRef(false)
  const touchDragRef = useRef<{
    readonly unitId: string
    readonly pointerId: number
    readonly startX: number
    readonly startY: number
    moved: boolean
  } | null>(null)

  useEffect(() => {
    if (selectedBattlePiece === null) return
    const stillAvailable = selectedBattlePiece.kind === 'hand'
      ? battle !== null && (
          battle.attacker.playerId === myId || battle.defender.playerId === myId
        ) && (
          battlehand.some((unit) => unit.id === selectedBattlePiece.id && !unit.inBattle && !(battle.defender.kind === 'barbarians' && battle.defender.playerId === myId)) ||
          barbarians.some((unit) => unit.id === selectedBattlePiece.id && !unit.inBattle && battle.defender.kind === 'barbarians' && battle.defender.playerId === myId)
        )
      : battle !== null && battle.arena.some((unit) => unit.id === selectedBattlePiece.id && (
          unit.side === 'attacker' ? battle.attacker.playerId === myId : battle.defender.playerId === myId
        ))
    if (!stillAvailable) setSelectedBattlePiece(null)
  }, [battle, battlehand, barbarians, selectedBattlePiece])

  function handleDragStart(unitId: string): void {
    setDraggingArenaUnitId(null)
    setDraggingUnitId(unitId)
  }

  function handleArenaDragStart(e: React.DragEvent<HTMLLIElement>, arenaUnitId: string): void {
    e.dataTransfer.setData('text/plain', arenaUnitId)
    setDraggingUnitId(null)
    setDraggingArenaUnitId(arenaUnitId)
  }

  // A drop is the only place either state gets cleared on success; if the
  // browser drops the drag outside any slot (or the user hits Escape), no
  // drop event fires at all, so a dangling id would silently hijack the next
  // unrelated drag. Clear both on dragend regardless of where the drag ended.
  function handleDragEnd(): void {
    setDraggingUnitId(null)
    setDraggingArenaUnitId(null)
  }

  function placeInArena(unitId: string, side: BattleSideId, position: number): void {
    const unit = battlehand.find((u) => u.id === unitId) ?? barbarians.find((u) => u.id === unitId)
    if (unit === undefined) return
    setSelectedBattlePiece(null)
    runBattleAction(() => api.placeUnitInArena(gameId, unitId, side, position, unit.attack, unit.health, rev))
  }

  function selectBattlePiece(kind: 'hand' | 'arena', id: string): void {
    if (busy || battleActionInFlightRef.current) return
    setDraggingUnitId(null)
    setDraggingArenaUnitId(null)
    setSelectedBattlePiece({ kind, id })
  }

  function handleSlotClick(side: BattleSideId, position: number): void {
    if (busy || battleActionInFlightRef.current || selectedBattlePiece === null) return
    if (selectedBattlePiece.kind === 'hand') {
      if (side !== mySideInBattle && !(side === 'defender' && battle?.defender.kind === 'barbarians' && battle.defender.playerId === myId)) return
      placeInArena(selectedBattlePiece.id, side, position)
      return
    }
    const arenaUnit = battle?.arena.find((unit) => unit.id === selectedBattlePiece.id)
    if (arenaUnit === undefined || !mySideInBattle || arenaUnit.side !== side || arenaUnit.side !== mySideInBattle) return
    setSelectedBattlePiece(null)
    runBattleAction(() => api.moveArenaUnit(gameId, arenaUnit.id, position, rev))
  }

  function runBattleAction(action: () => Promise<PlayerView | unknown>): Promise<void> {
    if (busy || battleActionInFlightRef.current) return Promise.resolve()
    battleActionInFlightRef.current = true
    return run(async () => {
      try { return await action() } finally { battleActionInFlightRef.current = false }
    })
  }

  function handleArenaPointerDown(unitId: string, event: React.PointerEvent<HTMLLIElement>): void {
    if (event.isPrimary === false || (event.button !== undefined && event.button !== 0) || event.pointerType === 'mouse' || busy || battleActionInFlightRef.current) return
    if (touchDragRef.current !== null) return
    if (selectedBattlePiece?.kind !== 'arena' || selectedBattlePiece.id !== unitId) return
    if ((event.target as HTMLElement).closest('button, input, select, textarea') !== null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    touchDragRef.current = {
      unitId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
  }

  function handleArenaPointerMove(event: React.PointerEvent<HTMLLIElement>): void {
    const drag = touchDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 6) return
    drag.moved = true
    event.preventDefault()
  }

  function finishArenaPointerDrag(event: React.PointerEvent<HTMLLIElement>, cancelled: boolean): void {
    const drag = touchDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    touchDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancelled || !drag.moved) return
    event.preventDefault()
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-arena-slot]')
    const side = target?.dataset['arenaSide']
    const position = target?.dataset['arenaPosition']
    if ((side !== 'attacker' && side !== 'defender') || position === undefined) return
    handleSlotClick(side, Number(position))
  }

  function handleDropOnArena(side: BattleSideId, position: number): void {
    if (draggingArenaUnitId !== null) {
      const arenaUnitId = draggingArenaUnitId
      setDraggingArenaUnitId(null)
      // Dropping on the other side's row is not a legal move — a unit can
      // only be repositioned within its own side.
      const draggedUnit = battle?.arena.find((u) => u.id === arenaUnitId)
      if (draggedUnit === undefined || draggedUnit.side !== side) return
      runBattleAction(() => api.moveArenaUnit(gameId, arenaUnitId, position, rev))
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

  // Next free position on my side (for click-to-place fallback). A front
  // held only by a killed unit is reinforceable — offer it first, rather
  // than always opening a new front, so the click path (not just drag) can
  // reinforce a fallen unit's position.
  function nextPositionFor(units: readonly ArenaUnit[]): number {
    const livePositions = new Set(units.filter((u) => !u.killed).map((u) => u.position))
    const reinforceable = units.find((u) => u.killed && !livePositions.has(u.position))
    if (reinforceable !== undefined) return reinforceable.position
    return units.reduce((m, u) => Math.max(m, u.position), -1) + 1
  }
  const myNextPosition = mySideInBattle === 'attacker'
    ? nextPositionFor(attackerUnits)
    : nextPositionFor(defenderUnits)

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
      {selectedBattlePiece !== null && (
        <div className="battle-selection" role="status">
          Selected unit. Tap a destination front to place or move it.
          <button className="small" type="button" onClick={() => setSelectedBattlePiece(null)}>Cancel</button>
        </div>
      )}
      {availableBattlehand.length === 0 && <p className="muted">Empty.</p>}
      <ul className="card-grid small">
        {availableBattlehand.map((unit) => (
          <ItemCard
            key={unit.id}
            item={unit}
            {...(selectedBattlePiece?.id === unit.id
              ? { className: 'battle-piece-selected' }
              : battle !== null && mySideInBattle !== null && !(battle.defender.kind === 'barbarians' && battle.defender.playerId === myId)
                ? { className: 'battle-piece-selectable' } : {})}
            draggable={battle !== null}
            {...(battle !== null && mySideInBattle !== null && !(battle.defender.kind === 'barbarians' && battle.defender.playerId === myId)
              ? {
                  onClick: () => selectBattlePiece('hand', unit.id), role: 'button' as const, tabIndex: 0,
                  onKeyDown: (event: React.KeyboardEvent<HTMLLIElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectBattlePiece('hand', unit.id) }
                  },
                }
              : {})}
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', unit.id); handleDragStart(unit.id) }}
            onDragEnd={handleDragEnd}
          >
            {battle !== null && mySideInBattle !== null &&
              !(battle.defender.kind === 'barbarians' && battle.defender.playerId === myId) && (
              <button
                className="small"
                disabled={busy}
                onClick={(event) => { event.stopPropagation(); placeInArena(unit.id, mySideInBattle, myNextPosition) }}
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
            {...(selectedBattlePiece?.id === unit.id
              ? { className: 'battle-piece-selected' }
              : battle !== null && battle.defender.kind === 'barbarians' && battle.defender.playerId === myId
                ? { className: 'battle-piece-selectable' } : {})}
            draggable={battle !== null}
            {...(battle !== null && battle.defender.kind === 'barbarians' && battle.defender.playerId === myId
              ? {
                  onClick: () => selectBattlePiece('hand', unit.id), role: 'button' as const, tabIndex: 0,
                  onKeyDown: (event: React.KeyboardEvent<HTMLLIElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectBattlePiece('hand', unit.id) }
                  },
                }
              : {})}
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', unit.id); handleDragStart(unit.id) }}
            onDragEnd={handleDragEnd}
          >
            {battle !== null && battle.defender.kind === 'barbarians' && battle.defender.playerId === myId && (
              <button
                className="small"
                disabled={busy}
                onClick={(event) => { event.stopPropagation(); placeInArena(unit.id, 'defender', myNextPosition) }}
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
                onClick={() => runBattleAction(() => api.endBattleTurn(gameId, rev))}
              >
                End turn
              </button>
            )}
            {mySideInBattle !== null && (
              <button
                className="small danger"
                disabled={busy}
                onClick={() => runBattleAction(() => api.endBattleArena(gameId, rev))}
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
          <div className="arena-frame mobile-arena-frame">
            <ArenaRow
              label={attackerSummary?.label ?? 'Attacker'}
              side="attacker"
              units={attackerUnits}
              maxPositions={maxPositions}
              gameId={gameId}
              busy={busy}
              rev={rev}
              run={runBattleAction}
              draggingUnitId={draggingUnitId}
              draggingArenaUnitId={draggingArenaUnitId}
              onArenaDragStart={handleArenaDragStart}
              onArenaDragEnd={handleDragEnd}
              onDropUnit={handleDropOnArena}
              onSlotClick={handleSlotClick}
              onArenaPointerDown={handleArenaPointerDown}
              onArenaPointerMove={handleArenaPointerMove}
              onArenaPointerUp={finishArenaPointerDrag}
              selectedBattlePiece={selectedBattlePiece}
              onSelectPiece={selectBattlePiece}
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
              run={runBattleAction}
              draggingUnitId={draggingUnitId}
              draggingArenaUnitId={draggingArenaUnitId}
              onArenaDragStart={handleArenaDragStart}
              onArenaDragEnd={handleDragEnd}
              onDropUnit={handleDropOnArena}
              onSlotClick={handleSlotClick}
              onArenaPointerDown={handleArenaPointerDown}
              onArenaPointerMove={handleArenaPointerMove}
              onArenaPointerUp={finishArenaPointerDrag}
              selectedBattlePiece={selectedBattlePiece}
              onSelectPiece={selectBattlePiece}
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
  readonly onArenaDragEnd: () => void
  readonly onDropUnit: (side: BattleSideId, position: number) => void
  readonly onSlotClick: (side: BattleSideId, position: number) => void
  readonly onArenaPointerDown: (unitId: string, event: React.PointerEvent<HTMLLIElement>) => void
  readonly onArenaPointerMove: (event: React.PointerEvent<HTMLLIElement>) => void
  readonly onArenaPointerUp: (event: React.PointerEvent<HTMLLIElement>, cancelled: boolean) => void
  readonly selectedBattlePiece: { readonly kind: 'hand' | 'arena'; readonly id: string } | null
  readonly onSelectPiece: (kind: 'hand' | 'arena', id: string) => void
  readonly canManage: boolean
  /** Whether the viewer controls this side — gates moving/returning units. */
  readonly isOwnSide: boolean
}

function ArenaRow({
  label, side, units, maxPositions, gameId, busy, rev, run,
  draggingUnitId, draggingArenaUnitId, onArenaDragStart, onArenaDragEnd, onDropUnit, onSlotClick,
  onArenaPointerDown, onArenaPointerMove, onArenaPointerUp, selectedBattlePiece, onSelectPiece, canManage, isOwnSide,
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
          const validDestination = selectedBattlePiece !== null && isOwnSide && (unit === null || unit.killed) && (
            selectedBattlePiece.kind === 'hand' || units.some((candidate) => candidate.id === selectedBattlePiece.id && candidate.side === side)
          )
          return (
            <div
              key={pos}
              className={`arena-slot${isDragOver ? ' drag-over' : ''}${validDestination ? ' valid-destination' : ''}`}
              data-arena-slot="true"
              data-arena-side={side}
              data-arena-position={pos}
              aria-disabled={selectedBattlePiece !== null && !validDestination}
              onClick={() => { if (validDestination) onSlotClick(side, pos) }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if ((event.key === 'Enter' || event.key === ' ') && validDestination) { event.preventDefault(); onSlotClick(side, pos) }
              }}
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
                  selected={selectedBattlePiece?.id === unit.id}
                  {...(isOwnSide ? {
                    onSelect: selectedBattlePiece !== null && unit.killed
                      ? () => onSlotClick(side, pos)
                      : () => onSelectPiece('arena', unit.id),
                  } : {})}
                  onPointerDown={(event) => onArenaPointerDown(unit.id, event)}
                  onPointerMove={onArenaPointerMove}
                  onPointerUp={(event) => onArenaPointerUp(event, false)}
                  onPointerCancel={(event) => onArenaPointerUp(event, true)}
                  onDragStart={(e) => onArenaDragStart(e, unit.id)}
                  onDragEnd={onArenaDragEnd}
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
  readonly selected?: boolean
  readonly onSelect?: () => void
  readonly onPointerDown?: React.PointerEventHandler<HTMLLIElement>
  readonly onPointerMove?: React.PointerEventHandler<HTMLLIElement>
  readonly onPointerUp?: React.PointerEventHandler<HTMLLIElement>
  readonly onPointerCancel?: React.PointerEventHandler<HTMLLIElement>
  readonly onDragStart: (e: React.DragEvent<HTMLLIElement>) => void
  readonly onDragEnd: () => void
}

export function ArenaUnitCard({
  unit, gameId, busy, rev, run, canManage, canMove, selected = false, onSelect,
  onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDragStart, onDragEnd,
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
  // the card says it is (issue #71). This must stay a label-only override:
  // the art itself (`item`) has to stay the pristine snapshot, because
  // `itemImage()` builds the filename from the item's own attack/health —
  // passing a mutated item points it at a card image that does not exist
  // and the art goes blank (issue #71 follow-up).
  const displayLabel = `${itemType(unit.unit)} ${unit.attack}.${unit.health}`

  // The two sides sit face to face across the arena, like a real tabletop
  // battle — the attacker's row is on top, so its cards are shown upside
  // down (base +180°) to face the defender's row below, on top of whatever
  // rotation the player has cycled to for that unit's own printed level.
  const baseOrientation = unit.side === 'attacker' ? 180 : 0
  const displayRotation = (unit.rotation + baseOrientation) % 360

  return (
    <div className={`arena-unit-card${unit.killed ? ' killed' : ''}`} onClick={(event) => event.stopPropagation()}>
      <ItemCard
        item={unit.unit}
        {...(selected
          ? { className: 'battle-piece-selected' }
          : onSelect === undefined ? {} : { className: 'battle-piece-selectable' })}
        {...(onSelect === undefined ? {} : {
          onClick: (event: React.MouseEvent<HTMLLIElement>) => { event.stopPropagation(); onSelect() },
          role: 'button' as const,
          tabIndex: 0,
          onKeyDown: (event: React.KeyboardEvent<HTMLLIElement>) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() }
          },
        })}
        {...(onPointerDown === undefined ? {} : { onPointerDown })}
        {...(onPointerMove === undefined ? {} : { onPointerMove })}
        {...(onPointerUp === undefined ? {} : { onPointerUp })}
        {...(onPointerCancel === undefined ? {} : { onPointerCancel })}
        labelOverride={displayLabel}
        rotation={displayRotation}
        draggable={canMove}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
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

