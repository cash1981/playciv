/**
 * Turn orders. Java: `TurnAction` and the turn tabs in old-civ-web.
 *
 * Orders are public as soon as they are saved. The private log is the separate
 * unlogged planning space backed by `Playerhand.gamenote`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MutableRefObject } from 'react'

import { TURN_PHASES, TURN_PHASE_LABEL } from '@civ/engine'
import type { PlayerTurn, TurnPhase } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { NavigationAttempt } from '../lib/navigationGuard.js'
import type { GameRevisionView, PlayerView } from '../lib/api.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { MarkdownEditor } from './MarkdownEditor.js'
import type { MarkdownEditorComponent, MarkdownEditorHandle } from './MarkdownEditor.js'
import './TurnPanel.css'

interface Props {
  readonly gameId: string
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly reloadCount: number
  readonly editorComponent?: MarkdownEditorComponent | undefined
  readonly historical?: GameRevisionView | null
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
  readonly onPhaseDirty?: (phase: TurnPhase) => void
  readonly tabPanelId: string
  readonly labelledBy: string
  readonly savedValues?: Readonly<Record<TurnPhase, string>>
  readonly phaseStatuses?: Readonly<Record<TurnPhase, SaveStatus>>
  readonly editorRefs?: MutableRefObject<Record<TurnPhase, MarkdownEditorHandle | null>>
  readonly hasUnsavedChanges?: boolean
  readonly editorComponent?: MarkdownEditorComponent | undefined
}

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed'

const playerTabId = (index: number): string => `turn-orders-player-tab-${index}`
const playerPanelId = (index: number): string => `turn-orders-player-panel-${index}`
const privateTabId = 'turn-orders-private-tab'
const privatePanelId = 'turn-orders-private-panel'

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
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    )
    const currentIndex = tabs.indexOf(event.currentTarget)
    if (currentIndex < 0 || tabs.length === 0) return
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    event.preventDefault()
    tabs[nextIndex]?.focus()
    tabs[nextIndex]?.click()
  }

  return (
    <div className="turn-tabs" role="tablist" aria-label="Turn orders by player">
      {players.map((player, index) => {
        const color = player.color?.toLowerCase() ?? 'var(--line)'
        const style = { '--turn-tab-color': color } as CSSProperties
        const active = !privateLogSelected && player.username === selectedUsername
        return (
          <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={playerPanelId(index)}
            id={playerTabId(index)}
            tabIndex={active ? 0 : -1}
            className="turn-tab"
            style={style}
            key={player.username}
            onClick={() => onSelectPlayer(player)}
            onKeyDown={handleKeyDown}
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
          aria-controls={privatePanelId}
          id={privateTabId}
          tabIndex={privateLogSelected ? 0 : -1}
          className="turn-tab private-log-tab"
          onClick={onSelectPrivateLog}
          onKeyDown={handleKeyDown}
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
  onPhaseDirty,
  tabPanelId,
  labelledBy,
  savedValues: providedSavedValues,
  phaseStatuses,
  editorRefs: providedEditorRefs,
  hasUnsavedChanges = false,
  editorComponent: EditorComponent = MarkdownEditor,
}: WorkspaceProps): React.JSX.Element {
  const locked = current?.disabled === true
  const editable = player.own && !locked && !busy
  const savedValues = providedSavedValues ?? current?.orders ?? emptyOrders()
  const localEditorRefs = useRef<Record<TurnPhase, MarkdownEditorHandle | null>>({
    SOT: null,
    TRADE: null,
    CM: null,
    MOVEMENT: null,
    RESEARCH: null,
  })
  const editorRefs = providedEditorRefs ?? localEditorRefs

  return (
    <div
      className="turn-workspace"
      role="tabpanel"
      id={tabPanelId}
      aria-labelledby={labelledBy}
    >
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
          <button type="button" className="small" disabled={busy} onClick={onNewTurn}>
            New turn
          </button>
        )}
        {locked && <span className="tag">locked</span>}
        <span className="turn-toolbar-spacer" style={{ flex: 1 }} />
        {player.own && (
          <button
            type="button"
            className="small"
            disabled={busy || current === undefined || hasUnsavedChanges}
            onClick={() => void run(() => api.lockTurn(gameId, turnNumber, !locked))}
          >
            {locked ? 'Reopen' : 'Lock the turn'}
          </button>
        )}
        {player.own && hasUnsavedChanges && !locked && (
          <span className="turn-save-hint">Save changes before locking</span>
        )}
      </div>

      {!player.own && current === undefined && (
        <p className="muted">{player.username} has not written orders for this turn.</p>
      )}

      {TURN_PHASES.map((phase) => (
        <section
          className="turn-phase"
          data-save-status={
            player.own
              ? phaseStatuses?.[phase] ??
                (values[phase] !== savedValues[phase] ? 'unsaved' : 'saved')
              : 'saved'
          }
          key={phase}
        >
          <div className="turn-phase-heading">
            <h3>{TURN_PHASE_LABEL[phase]}</h3>
            {player.own && (
              <SaveStatusBadge
                status={
                  phaseStatuses?.[phase] ??
                    (values[phase] !== savedValues[phase] ? 'unsaved' : 'saved')
                }
                label={TURN_PHASE_LABEL[phase]}
              />
            )}
          </div>
          <EditorComponent
            key={`${player.username}:${turnNumber}:${phase}`}
            ref={(handle) => {
              editorRefs.current[phase] = handle
            }}
            value={values[phase]}
            onChange={(markdown) => onPhaseChange(phase, markdown)}
            onDirty={() => onPhaseDirty?.(phase)}
            readOnly={!editable}
            ariaLabel={`${TURN_PHASE_LABEL[phase]} orders for ${player.username}, turn ${turnNumber}`}
            placeholder={`Write ${TURN_PHASE_LABEL[phase]} orders …`}
          />
        </section>
      ))}
    </div>
  )
}

function SaveStatusBadge({
  status,
  label,
}: {
  readonly status: SaveStatus
  readonly label: string
}): React.JSX.Element {
  const labels: Readonly<Record<SaveStatus, string>> = {
    saved: `Saved ${label}`,
    unsaved: `Unsaved changes: ${label}`,
    saving: `Saving ${label}…`,
    failed: `Save failed: ${label}`,
  }
  return (
    <span className={`turn-save-status turn-save-status-${status}`} role="status">
      <span aria-hidden="true" className="turn-save-status-dot" />
      {labels[status]}
    </span>
  )
}

interface PrivateLogWorkspaceProps {
  readonly note: string
  readonly dirty: boolean
  readonly onChange: (markdown: string) => void
  readonly onDirty?: (() => void) | undefined
  readonly saveStatus?: SaveStatus
  readonly editorRef?: MutableRefObject<MarkdownEditorHandle | null>
  readonly tabPanelId: string
  readonly labelledBy: string
  readonly editorComponent?: MarkdownEditorComponent | undefined
  readonly readOnly?: boolean
}

/** The viewer's existing unlogged `gamenote`, kept separate from public orders. */
export function PrivateLogWorkspace({
  note,
  dirty,
  onChange,
  onDirty,
  saveStatus = dirty ? 'unsaved' : 'saved',
  editorRef: providedEditorRef,
  tabPanelId,
  labelledBy,
  readOnly = false,
  editorComponent: EditorComponent = MarkdownEditor,
}: PrivateLogWorkspaceProps): React.JSX.Element {
  const localEditorRef = useRef<MarkdownEditorHandle>(null)
  const editorRef = providedEditorRef ?? localEditorRef

  return (
    <div role="tabpanel" id={tabPanelId} aria-labelledby={labelledBy}>
      <p className="muted private-log-copy">
        Only you can see this planning space. Saving it does not add an entry to the game log.
      </p>
      <section className="turn-phase private-log-phase" data-save-status={saveStatus}>
        <div className="turn-phase-heading private-log-heading">
          <h3>Private log</h3>
          <SaveStatusBadge status={saveStatus} label="Private log" />
        </div>
        <EditorComponent
          key="private-log"
          ref={editorRef}
          value={note}
          onChange={onChange}
          onDirty={onDirty}
          readOnly={readOnly}
          ariaLabel="Private log"
          placeholder="Write private plans and reminders …"
        />
      </section>
    </div>
  )
}

export function TurnPanel({
  gameId,
  busy,
  run,
  reloadCount,
  editorComponent,
  historical = null,
}: Props): React.JSX.Element {
  const [view, setView] = useState<PlayerView | null>(null)
  const [publicTurns, setPublicTurns] = useState<readonly PlayerTurn[]>([])
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null)
  const [privateLogSelected, setPrivateLogSelected] = useState(false)
  const [turnNumber, setTurnNumber] = useState(1)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [privateNote, setPrivateNote] = useState('')
  const [privateNoteDirty, setPrivateNoteDirty] = useState(false)
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({})
  const [savedPhaseValues, setSavedPhaseValues] = useState<Record<string, string>>({})
  const [liveDirtyKeys, setLiveDirtyKeys] = useState<Record<string, true>>({})
  const draftsRef = useRef<Record<string, string>>({})
  const savedPhaseValuesRef = useRef<Record<string, string>>({})
  const liveDirtyKeysRef = useRef<Record<string, true>>({})
  const privateNoteDirtyRef = useRef(false)
  const privateNoteRef = useRef('')
  const privateSavedNoteRef = useRef('')
  const editorRefs = useRef<Record<TurnPhase, MarkdownEditorHandle | null>>({
    SOT: null,
    TRADE: null,
    CM: null,
    MOVEMENT: null,
    RESEARCH: null,
  })
  const privateEditorRef = useRef<MarkdownEditorHandle | null>(null)
  const visibleOwnTurnRef = useRef<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const requestEpoch = useRef(0)

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current
    try {
      const [nextView, nextPublicTurns] = await Promise.all([
        api.game(gameId),
        api.publicTurns(gameId),
      ])
      if (epoch !== requestEpoch.current) return
      setView(nextView)
      setPublicTurns(nextPublicTurns)
      if (!privateNoteDirtyRef.current) {
        const loadedNote = nextView.you?.gamenote ?? ''
        privateSavedNoteRef.current = loadedNote
        privateNoteRef.current = loadedNote
        setPrivateNote(loadedNote)
      }
      setLoadError(null)
    } catch (caught) {
      if (epoch !== requestEpoch.current) return
      setLoadError(errorMessage(caught))
    }
  }, [gameId])

  useEffect(() => {
    if (historical !== null) {
      requestEpoch.current += 1
      setView(historical.view)
      setPublicTurns(historical.publicTurns)
      setDrafts({})
      draftsRef.current = {}
      setLiveDirtyKeys({})
      liveDirtyKeysRef.current = {}
      setPrivateNote('')
      privateNoteRef.current = ''
      privateSavedNoteRef.current = ''
      setPrivateNoteDirty(false)
      privateNoteDirtyRef.current = false
      setLoadError(null)
      return
    }
    void load()
  }, [historical, load, reloadCount])

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
  visibleOwnTurnRef.current = selectedPlayer?.own === true ? turnNumber : null
  const selectedPlayerIndex = selectedPlayer === undefined ? -1 : players.indexOf(selectedPlayer)
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
        ? (drafts[`${turnNumber}:${phase}`] ??
          savedPhaseValues[`${turnNumber}:${phase}`] ??
          current?.orders[phase] ??
          '')
        : (current?.orders[phase] ?? '')
  }

  const phaseKey = (number: number, phase: TurnPhase): string => `${number}:${phase}`
  const serverTurnFor = (number: number): PlayerTurn | undefined =>
    (view?.you?.playerTurns ?? []).find((turn) => turn.turnNumber === number)
  const savedPhaseValue = (number: number, phase: TurnPhase): string =>
    savedPhaseValues[phaseKey(number, phase)] ?? serverTurnFor(number)?.orders[phase] ?? ''
  const savedValues = emptyOrders()
  for (const phase of TURN_PHASES) {
    savedValues[phase] =
      selectedPlayer?.own === true
        ? savedPhaseValue(turnNumber, phase)
        : (current?.orders[phase] ?? '')
  }
  const dirtyPhaseKeys = Object.entries(drafts).filter(([key, markdown]) => {
    const separator = key.indexOf(':')
    const number = Number(key.slice(0, separator))
    const phase = key.slice(separator + 1) as TurnPhase
    return markdown !== savedPhaseValue(number, phase)
  })
  const selectedOwnTurnDirty =
    selectedPlayer?.own === true &&
    TURN_PHASES.some(
      (phase) =>
        values[phase] !== savedValues[phase] || liveDirtyKeys[phaseKey(turnNumber, phase)] === true,
    )
  const hasUnsavedChanges =
    dirtyPhaseKeys.length > 0 || Object.keys(liveDirtyKeys).length > 0 || privateNoteDirty

  useEffect(() => {
    const warnNavigation = (event: Event): void => {
      if (!hasUnsavedChanges) return
      const detail = (event as CustomEvent<NavigationAttempt>).detail
      if (!window.confirm('You have unsaved turn-order changes. Leave without saving?')) {
        detail.allowed = false
      }
    }
    const warnBeforeLeaving = (event: BeforeUnloadEvent): void => {
      if (!hasUnsavedChanges) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('civ:navigation-attempt', warnNavigation)
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => {
      window.removeEventListener('civ:navigation-attempt', warnNavigation)
      window.removeEventListener('beforeunload', warnBeforeLeaving)
    }
  }, [hasUnsavedChanges])

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
    const dirty = markdown !== privateSavedNoteRef.current
    privateNoteRef.current = markdown
    privateNoteDirtyRef.current = dirty
    setPrivateNoteDirty(dirty)
    setPrivateNote(markdown)
    setSaveStatuses((existing) => ({
      ...existing,
      ['private']: dirty ? 'unsaved' : 'saved',
    }))
  }

  const markPrivateNoteDirty = (): void => {
    privateNoteDirtyRef.current = true
    setPrivateNoteDirty(true)
    setSaveStatuses((existing) => ({ ...existing, ['private']: 'unsaved' }))
  }

  const markLiveDirty = (key: string): void => {
    if (liveDirtyKeysRef.current[key] === true) return
    const next = { ...liveDirtyKeysRef.current, [key]: true as const }
    liveDirtyKeysRef.current = next
    setLiveDirtyKeys(next)
    setSaveStatuses((existing) => ({ ...existing, [key]: 'unsaved' }))
  }

  const clearLiveDirty = (key: string): void => {
    if (liveDirtyKeysRef.current[key] !== true) return
    const next = { ...liveDirtyKeysRef.current }
    delete next[key]
    liveDirtyKeysRef.current = next
    setLiveDirtyKeys(next)
  }

  const setDraftValue = (key: string, markdown: string): void => {
    const separator = key.indexOf(':')
    const number = Number(key.slice(0, separator))
    const phase = key.slice(separator + 1) as TurnPhase
    const saved =
      savedPhaseValuesRef.current[key] ?? serverTurnFor(number)?.orders[phase] ?? ''
    if (markdown === saved) {
      const next = { ...draftsRef.current }
      delete next[key]
      draftsRef.current = next
      setDrafts(next)
      clearLiveDirty(key)
      setSaveStatuses((existing) => ({ ...existing, [key]: 'saved' }))
      return
    }
    draftsRef.current = { ...draftsRef.current, [key]: markdown }
    setDrafts((existing) => ({ ...existing, [key]: markdown }))
    setSaveStatuses((existing) => ({ ...existing, [key]: 'unsaved' }))
  }

  const reconcileSuccessfulPhase = (
    key: string,
    submission: { readonly turn: number; readonly phase: TurnPhase; readonly markdown: string },
  ): void => {
    const currentMarkdown =
      visibleOwnTurnRef.current === submission.turn
        ? (editorRefs.current[submission.phase]?.getMarkdown() ?? draftsRef.current[key])
        : draftsRef.current[key]
    const nextSaved = { ...savedPhaseValuesRef.current, [key]: submission.markdown }
    savedPhaseValuesRef.current = nextSaved
    setSavedPhaseValues(nextSaved)
    if (currentMarkdown !== undefined && currentMarkdown !== submission.markdown) {
      if (draftsRef.current[key] !== currentMarkdown) setDraftValue(key, currentMarkdown)
      setSaveStatuses((existing) => ({ ...existing, [key]: 'unsaved' }))
      return
    }

    const nextDrafts = { ...draftsRef.current }
    delete nextDrafts[key]
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)
    clearLiveDirty(key)
    setSaveStatuses((existing) => ({ ...existing, [key]: 'saved' }))
  }

  const saveAll = (): void => {
    if (view?.you === null || view === null) return

    const submissions = new Map<
      string,
      { readonly turn: number; readonly phase: TurnPhase; readonly markdown: string }
    >()
    for (const [key] of dirtyPhaseKeys) {
      const separator = key.indexOf(':')
      const number = Number(key.slice(0, separator))
      const phase = key.slice(separator + 1) as TurnPhase
      const markdown =
        selectedPlayer?.own === true && number === turnNumber
          ? (editorRefs.current[phase]?.getMarkdown() ?? draftsRef.current[key] ?? '')
          : (draftsRef.current[key] ?? '')
      submissions.set(key, { turn: number, phase, markdown })
    }
    if (selectedPlayer?.own === true) {
      for (const phase of TURN_PHASES) {
        const key = phaseKey(turnNumber, phase)
        const markdown = editorRefs.current[phase]?.getMarkdown() ?? values[phase]
        if (markdown !== savedValues[phase]) {
          submissions.set(key, { turn: turnNumber, phase, markdown })
          setDraftValue(key, markdown)
        } else if (liveDirtyKeysRef.current[key] === true) {
          const nextDrafts = { ...draftsRef.current }
          delete nextDrafts[key]
          draftsRef.current = nextDrafts
          setDrafts(nextDrafts)
          clearLiveDirty(key)
          setSaveStatuses((existing) => ({ ...existing, [key]: 'saved' }))
        }
      }
    }

    const latestPrivateNote = privateEditorRef.current?.getMarkdown() ?? privateNoteRef.current
    const privateNeedsSave =
      privateNoteDirty || latestPrivateNote !== privateSavedNoteRef.current
    if (privateNeedsSave && latestPrivateNote !== privateNoteRef.current) {
      privateNoteRef.current = latestPrivateNote
      setPrivateNote(latestPrivateNote)
      privateNoteDirtyRef.current = true
      setPrivateNoteDirty(true)
    }
    const privateSubmission = latestPrivateNote

    const keys = [...submissions.keys()]
    const savingStatuses = Object.fromEntries(keys.map((key) => [key, 'saving' as const]))
    if (privateNeedsSave) savingStatuses['private'] = 'saving'
    setSaveStatuses((existing) => ({ ...existing, ...savingStatuses }))

    void run(async () => {
      const failed = new Set<string>()
      let lastView: PlayerView | unknown = undefined
      for (const [key, submission] of submissions) {
        try {
          lastView = await api.updateTurn(
            gameId,
            submission.turn,
            submission.phase,
            submission.markdown,
          )
          reconcileSuccessfulPhase(key, submission)
        } catch (caught) {
          failed.add(key)
          setSaveStatuses((existing) => ({ ...existing, [key]: 'failed' }))
          console.error(`Failed to save ${submission.phase}`, caught)
        }
      }
      if (privateNeedsSave) {
        try {
          lastView = await api.saveNote(gameId, privateSubmission)
          privateSavedNoteRef.current = privateSubmission
          const currentPrivateNote =
            privateEditorRef.current?.getMarkdown() ?? privateNoteRef.current
          if (currentPrivateNote === privateSubmission) {
            privateNoteRef.current = privateSubmission
            privateNoteDirtyRef.current = false
            setPrivateNoteDirty(false)
            setSaveStatuses((existing) => ({ ...existing, ['private']: 'saved' }))
          } else {
            if (privateNoteRef.current !== currentPrivateNote) {
              setPrivateNoteValue(currentPrivateNote)
            } else {
              markPrivateNoteDirty()
            }
            setSaveStatuses((existing) => ({ ...existing, ['private']: 'unsaved' }))
          }
        } catch (caught) {
          failed.add('private')
          setSaveStatuses((existing) => ({ ...existing, ['private']: 'failed' }))
          console.error('Failed to save private log', caught)
        }
      }
      if (failed.size > 0) throw new Error('Some changes could not be saved')
      return lastView
    })
  }

  return (
    <CollapsiblePanel id="turn-orders" title="Turn orders">
      {loadError !== null && <div className="error">{loadError}</div>}
      {view === null && loadError === null && <p className="muted">Loading turn orders …</p>}

      {view !== null && (
        <>
          <div className="turn-save-toolbar" aria-live="polite">
            <button
              type="button"
              className="primary turn-save-all"
              disabled={busy || view.you === null || !hasUnsavedChanges}
              onClick={saveAll}
            >
              Save all changes
            </button>
            {hasUnsavedChanges && <span className="turn-unsaved-summary">Unsaved changes</span>}
            {!hasUnsavedChanges && <span className="turn-unsaved-summary">All changes saved</span>}
          </div>
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
              note={privateNote}
              dirty={privateNoteDirty}
              onChange={setPrivateNoteValue}
              onDirty={markPrivateNoteDirty}
              saveStatus={saveStatuses['private'] ?? (privateNoteDirty ? 'unsaved' : 'saved')}
              editorRef={privateEditorRef}
              tabPanelId={privatePanelId}
              labelledBy={privateTabId}
              editorComponent={editorComponent}
              readOnly={busy}
            />
          ) : selectedPlayer !== undefined ? (
            <TurnOrderWorkspace
              gameId={gameId}
              busy={busy}
              run={run}
              player={selectedPlayer}
              turnNumber={turnNumber}
              turnNumbers={turnNumbers}
              current={current}
              values={values}
              savedValues={savedValues}
              hasUnsavedChanges={selectedOwnTurnDirty}
              phaseStatuses={Object.fromEntries(
                TURN_PHASES.map((phase) => {
                  const key = phaseKey(turnNumber, phase)
                  const dirty = values[phase] !== savedValues[phase]
                  return [phase, saveStatuses[key] ?? (dirty ? 'unsaved' : 'saved')]
                }),
              ) as Record<TurnPhase, SaveStatus>}
              editorRefs={editorRefs}
              onTurnNumberChange={setTurnNumber}
              onNewTurn={() =>
                setTurnNumber(
                  Math.max(turnNumber, ...selectedTurns.map((turn) => turn.turnNumber)) + 1,
                )
              }
              onPhaseChange={(phase, markdown) => {
                const key = phaseKey(turnNumber, phase)
                setDraftValue(key, markdown)
              }}
              onPhaseDirty={(phase) => markLiveDirty(phaseKey(turnNumber, phase))}
              tabPanelId={playerPanelId(selectedPlayerIndex)}
              labelledBy={playerTabId(selectedPlayerIndex)}
              editorComponent={editorComponent}
            />
          ) : null}
        </>
      )}
    </CollapsiblePanel>
  )
}
