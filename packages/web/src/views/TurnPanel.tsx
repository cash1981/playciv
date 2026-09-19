/**
 * Turn orders. Java: `TurnAction` and the turn tabs in old-civ-web.
 *
 * Orders are public as soon as they are saved. The private log is the separate
 * unlogged planning space backed by `Playerhand.gamenote`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { TURN_PHASES, TURN_PHASE_LABEL } from '@civ/engine'
import type { PlayerTurn, TurnPhase } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { MarkdownEditor } from './MarkdownEditor.js'
import './TurnPanel.css'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly reloadCount: number
}

export interface TurnPlayerTab {
  readonly username: string
  readonly color: string | null
  readonly own: boolean
}

interface TurnTabsProps {
  readonly players: readonly TurnPlayerTab[]
  readonly selectedUsername: string | undefined
  readonly privateLogSelected: boolean
  readonly showPrivateLog: boolean
  readonly onSelectPlayer: (player: TurnPlayerTab) => void
  readonly onSelectPrivateLog: () => void
}

interface WorkspaceProps {
  readonly gameId: string
  readonly busy: boolean
  readonly run: Props['run']
  readonly player: TurnPlayerTab
  readonly turnNumber: number
  readonly turnNumbers: readonly number[]
  readonly current: PlayerTurn | undefined
  readonly values: Readonly<Record<TurnPhase, string>>
  readonly onTurnNumberChange: (turnNumber: number) => void
  readonly onNewTurn: () => void
  readonly onPhaseChange: (phase: TurnPhase, markdown: string) => void
}

const emptyOrders = (): Record<TurnPhase, string> => ({
  SOT: '',
  TRADE: '',
  CM: '',
  MOVEMENT: '',
  RESEARCH: '',
})

const turnsFor = (
  username: string,
  ownUsername: string | undefined,
  ownTurns: readonly PlayerTurn[],
  publicTurns: readonly PlayerTurn[],
): readonly PlayerTurn[] =>
  (username === ownUsername ? ownTurns : publicTurns.filter((turn) => turn.username === username))
    .slice()
    .sort((left, right) => left.turnNumber - right.turnNumber)

const latestTurnNumber = (turns: readonly PlayerTurn[]): number =>
  turns.at(-1)?.turnNumber ?? 1

/** Username tabs share the players' board colours; the private space comes last. */
export function TurnTabs({
  players,
  selectedUsername,
  privateLogSelected,
  showPrivateLog,
  onSelectPlayer,
  onSelectPrivateLog,
}: TurnTabsProps): React.JSX.Element {
  return (
    <div className="turn-tabs" role="tablist" aria-label="Turn orders by player">
      {players.map((player) => {
        const color = player.color?.toLowerCase() ?? 'var(--line)'
        const style = { '--turn-tab-color': color } as CSSProperties
        const active = !privateLogSelected && player.username === selectedUsername
        return (
          <button
            type="button"
            role="tab"
            aria-selected={active}
            className="turn-tab"
            style={style}
            key={player.username}
            onClick={() => onSelectPlayer(player)}
          >
            {player.username}
          </button>
        )
      })}
      {showPrivateLog && (
        <button
          type="button"
          role="tab"
          aria-selected={privateLogSelected}
          className="turn-tab private-log-tab"
          onClick={onSelectPrivateLog}
        >
          Private log
        </button>
      )}
    </div>
  )
}

/** The five phase editors for the selected player's selected turn. */
export function TurnOrderWorkspace({
  gameId,
  busy,
  run,
  player,
  turnNumber,
  turnNumbers,
  current,
  values,
  onTurnNumberChange,
  onNewTurn,
  onPhaseChange,
}: WorkspaceProps): React.JSX.Element {
  const locked = current?.disabled === true
  const editable = player.own && !locked

  return (
    <div className="turn-workspace">
      <div className="row turn-toolbar">
        <label>
          Turn
          <select
            aria-label={`Turn for ${player.username}`}
            value={turnNumber}
            onChange={(event) => onTurnNumberChange(Number(event.target.value))}
          >
            {turnNumbers.map((number) => (
              <option key={number} value={number}>
                {number}
              </option>
            ))}
          </select>
        </label>
        {player.own && (
          <button type="button" className="small" onClick={onNewTurn}>
            New turn
          </button>
        )}
        {locked && <span className="tag">locked</span>}
        <span className="turn-toolbar-spacer" style={{ flex: 1 }} />
        {player.own && (
          <button
            type="button"
            className="small"
            disabled={busy || current === undefined}
            onClick={() => void run(() => api.lockTurn(gameId, turnNumber, !locked))}
          >
            {locked ? 'Reopen' : 'Lock the turn'}
          </button>
        )}
      </div>

      {!player.own && current === undefined && (
        <p className="muted">{player.username} has not written orders for this turn.</p>
      )}

      {TURN_PHASES.map((phase) => (
        <section className="turn-phase" key={phase}>
          <div className="turn-phase-heading">
            <h3>{TURN_PHASE_LABEL[phase]}</h3>
          </div>
          <MarkdownEditor
            value={values[phase]}
            onChange={(markdown) => onPhaseChange(phase, markdown)}
            readOnly={!editable}
            ariaLabel={`${TURN_PHASE_LABEL[phase]} orders for ${player.username}, turn ${turnNumber}`}
            placeholder={`Write ${TURN_PHASE_LABEL[phase]} orders …`}
          />
          {player.own && (
            <div className="turn-phase-actions">
              <button
                type="button"
                className="small"
                disabled={busy || locked}
                onClick={() =>
                  void run(() => api.updateTurn(gameId, turnNumber, phase, values[phase]))
                }
              >
                Save {TURN_PHASE_LABEL[phase]}
              </button>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

interface PrivateLogWorkspaceProps {
  readonly gameId: string
  readonly busy: boolean
  readonly run: Props['run']
  readonly note: string
  readonly dirty: boolean
  readonly onChange: (markdown: string) => void
  readonly onSaved: () => void
}

/** The viewer's existing unlogged `gamenote`, kept separate from public orders. */
export function PrivateLogWorkspace({
  gameId,
  busy,
  run,
  note,
  dirty,
  onChange,
  onSaved,
}: PrivateLogWorkspaceProps): React.JSX.Element {
  return (
    <div role="tabpanel">
      <p className="muted private-log-copy">
        Only you can see this planning space. Saving it does not add an entry to the game log.
      </p>
      <MarkdownEditor
        value={note}
        onChange={onChange}
        readOnly={false}
        ariaLabel="Private log"
        placeholder="Write private plans and reminders …"
      />
      <div className="turn-phase-actions">
        <button
          type="button"
          className="small"
          disabled={busy || !dirty}
          onClick={() =>
            void run(async () => {
              const nextView = await api.saveNote(gameId, note)
              onSaved()
              return nextView
            })
          }
        >
          Save private log
        </button>
      </div>
    </div>
  )
}

export function TurnPanel({ gameId, busy, run, reloadCount }: Props): React.JSX.Element {
  const [view, setView] = useState<PlayerView | null>(null)
  const [publicTurns, setPublicTurns] = useState<readonly PlayerTurn[]>([])
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null)
  const [privateLogSelected, setPrivateLogSelected] = useState(false)
  const [turnNumber, setTurnNumber] = useState(1)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [privateNote, setPrivateNote] = useState('')
  const [privateNoteDirty, setPrivateNoteDirty] = useState(false)
  const privateNoteDirtyRef = useRef(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [nextView, nextPublicTurns] = await Promise.all([
        api.game(gameId),
        api.publicTurns(gameId),
      ])
      setView(nextView)
      setPublicTurns(nextPublicTurns)
      if (!privateNoteDirtyRef.current) setPrivateNote(nextView.you?.gamenote ?? '')
      setLoadError(null)
    } catch (caught) {
      setLoadError(errorMessage(caught))
    }
  }, [gameId])

  useEffect(() => {
    void load()
  }, [load, reloadCount])

  const players = useMemo<readonly TurnPlayerTab[]>(() => {
    if (view === null) return []
    return [
      ...(view.you === null
        ? []
        : [{ username: view.you.username, color: view.you.color, own: true }]),
      ...view.opponents.map((opponent) => ({
        username: opponent.username,
        color: opponent.color,
        own: false,
      })),
    ].sort((left, right) => {
      const leftNumber =
        left.own
          ? (view.you?.playernumber ?? Number.MAX_SAFE_INTEGER)
          : (view.opponents.find((opponent) => opponent.username === left.username)?.playernumber ??
            Number.MAX_SAFE_INTEGER)
      const rightNumber =
        right.own
          ? (view.you?.playernumber ?? Number.MAX_SAFE_INTEGER)
          : (view.opponents.find((opponent) => opponent.username === right.username)?.playernumber ??
            Number.MAX_SAFE_INTEGER)
      return leftNumber - rightNumber
    })
  }, [view])

  useEffect(() => {
    if (view === null || players.length === 0) return
    const selectionStillExists = players.some((player) => player.username === selectedUsername)
    if (selectionStillExists) return

    const nextUsername = view.you?.username ?? players[0]?.username
    if (nextUsername === undefined) return
    const selectedTurns = turnsFor(
      nextUsername,
      view.you?.username,
      view.you?.playerTurns ?? [],
      publicTurns,
    )
    setSelectedUsername(nextUsername)
    setTurnNumber(latestTurnNumber(selectedTurns))
  }, [players, publicTurns, selectedUsername, view])

  const selectedPlayer =
    players.find((player) => player.username === selectedUsername) ?? players[0]
  const selectedTurns =
    selectedPlayer === undefined || view === null
      ? []
      : turnsFor(
          selectedPlayer.username,
          view.you?.username,
          view.you?.playerTurns ?? [],
          publicTurns,
        )
  const current = selectedTurns.find((turn) => turn.turnNumber === turnNumber)
  const turnNumbers = [...new Set([...selectedTurns.map((turn) => turn.turnNumber), turnNumber])]
    .sort((left, right) => left - right)
  const values = emptyOrders()
  for (const phase of TURN_PHASES) {
    values[phase] =
      selectedPlayer?.own === true
        ? (drafts[`${turnNumber}:${phase}`] ?? current?.orders[phase] ?? '')
        : (current?.orders[phase] ?? '')
  }

  const selectPlayer = (player: TurnPlayerTab): void => {
    const turns =
      view === null
        ? []
        : turnsFor(
            player.username,
            view.you?.username,
            view.you?.playerTurns ?? [],
            publicTurns,
          )
    setPrivateLogSelected(false)
    setSelectedUsername(player.username)
    setTurnNumber(latestTurnNumber(turns))
  }

  const setPrivateNoteValue = (markdown: string): void => {
    privateNoteDirtyRef.current = true
    setPrivateNoteDirty(true)
    setPrivateNote(markdown)
  }

  return (
    <CollapsiblePanel id="turn-orders" title="Turn orders">
      {loadError !== null && <div className="error">{loadError}</div>}
      {view === null && loadError === null && <p className="muted">Loading turn orders …</p>}

      {view !== null && (
        <>
          <TurnTabs
            players={players}
            selectedUsername={selectedPlayer?.username}
            privateLogSelected={privateLogSelected}
            showPrivateLog={view.you !== null}
            onSelectPlayer={selectPlayer}
            onSelectPrivateLog={() => setPrivateLogSelected(true)}
          />

          {privateLogSelected && view.you !== null ? (
            <PrivateLogWorkspace
              gameId={gameId}
              busy={busy}
              run={run}
              note={privateNote}
              dirty={privateNoteDirty}
              onChange={setPrivateNoteValue}
              onSaved={() => {
                privateNoteDirtyRef.current = false
                setPrivateNoteDirty(false)
              }}
            />
          ) : selectedPlayer !== undefined ? (
            <div role="tabpanel">
              <TurnOrderWorkspace
                gameId={gameId}
                busy={busy}
                run={run}
                player={selectedPlayer}
                turnNumber={turnNumber}
                turnNumbers={turnNumbers}
                current={current}
                values={values}
                onTurnNumberChange={setTurnNumber}
                onNewTurn={() =>
                  setTurnNumber(
                    Math.max(turnNumber, ...selectedTurns.map((turn) => turn.turnNumber)) + 1,
                  )
                }
                onPhaseChange={(phase, markdown) =>
                  setDrafts((existing) => ({
                    ...existing,
                    [`${turnNumber}:${phase}`]: markdown,
                  }))
                }
              />
            </div>
          ) : null}
        </>
      )}
    </CollapsiblePanel>
  )
}
