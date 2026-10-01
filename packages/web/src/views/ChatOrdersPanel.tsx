/**
 * Chat orders (issue #215): one timeline instead of the Chat and Turn orders
 * panels. A message is chat or an order tagged with a turn and a phase, and
 * players mark phases done from a sheet. Shown only while `view.chatOrders` is
 * on; the classic panels are untouched.
 *
 * The timeline is public. The Private tab is the viewer's own `gamenote`, which
 * the view already carries for them alone.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { TURN_PHASES, TURN_PHASE_LABEL } from '@civ/engine'
import type { TurnPhase } from '@civ/engine'

import { errorMessage } from '../App.js'
import { api } from '../lib/api.js'
import type { ActiveTurnStatus, PlayerView, TimelineMessageDto } from '../lib/api.js'
import type { NavigationAttempt } from '../lib/navigationGuard.js'
import { ChatTimestamp } from './ChatTimestamp.js'
import type { ChatAuthor } from './ChatPanel.js'
import { CollapsiblePanel } from './CollapsiblePanel.js'
import { MarkdownEditor } from './MarkdownEditor.js'
import type { MarkdownEditorComponent, MarkdownEditorHandle } from './MarkdownEditor.js'
import { colorClass } from './playerColor.js'
import { ReferenceDialog } from './ReferenceDialog.js'
import { SafeMarkdown } from './SafeMarkdown.js'
import type { SaveStatus } from './TurnPanel.js'
import { PrivateLogWorkspace } from './TurnPanel.js'
import './ChatOrdersPanel.css'

const TIMELINE_REFRESH_MS = 10_000

/** Short names for the tag on an order and the waiting line in the title. */
const PHASE_SHORT: Readonly<Record<TurnPhase, string>> = {
  SOT: 'SOT',
  TRADE: 'Trade',
  CM: 'CM',
  MOVEMENT: 'Movement',
  RESEARCH: 'Research',
}

/** Full names for the selects, where there is room. */
const PHASE_OPTION: Readonly<Record<TurnPhase, string>> = {
  SOT: 'Start of turn',
  TRADE: 'Trade',
  CM: 'City management',
  MOVEMENT: 'Movement',
  RESEARCH: 'Research',
}

type Filter = 'all' | 'orders' | 'chat' | 'private'

const FILTERS: readonly { readonly filter: Filter; readonly label: string }[] = [
  { filter: 'all', label: 'All' },
  { filter: 'orders', label: 'Orders' },
  { filter: 'chat', label: 'Chat' },
  { filter: 'private', label: 'Private' },
]

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Adds `incoming` (one server page, oldest first) to what is already loaded,
 * by id. A row already held is refreshed in place; an unknown row goes right
 * after the row before it in the page, or at the very start when nothing before
 * it is known. That puts an older page in front and new rows at the end without
 * trusting timestamps to sort, so the server's order is kept.
 *
 * This assumes a page either overlaps what is held or is the older page fetched
 * with `before`. A page that overlaps nothing goes to the front, which is right
 * for Load more and would be wrong for a newer page with a gap before it, such
 * as a refresh that arrives after the turn moved on by more than one. The server
 * always answers the whole current turn, so that gap cannot come up today.
 */
export function mergeTimeline(
  existing: readonly TimelineMessageDto[],
  incoming: readonly TimelineMessageDto[],
): readonly TimelineMessageDto[] {
  const merged = [...existing]
  let anchor = -1
  for (const row of incoming) {
    const at = merged.findIndex((held) => held.id === row.id)
    if (at === -1) {
      anchor += 1
      merged.splice(anchor, 0, row)
    } else {
      merged[at] = row
      anchor = at
    }
  }
  return merged
}

/**
 * The ids of orders a newer order from the same player, turn and phase has
 * replaced. The newest counts, and `history` on the server keeps every version.
 */
export function replacedOrderIds(messages: readonly TimelineMessageDto[]): ReadonlySet<string> {
  const newest = new Set<string>()
  const replaced = new Set<string>()
  for (const row of [...messages].reverse()) {
    if (row.kind !== 'order') continue
    const key = `${row.username}\u0000${row.turnNumber}\u0000${row.phase}`
    if (newest.has(key)) replaced.add(row.id)
    else newest.add(key)
  }
  return replaced
}

const isVisible = (row: TimelineMessageDto, filter: Filter): boolean => {
  if (filter === 'orders') return row.kind === 'order' || row.kind === 'system'
  if (filter === 'chat') return row.kind === 'chat'
  return true
}

/** The first phase the viewer has not marked done in that turn; Research when all are. */
export function firstOpenPhase(view: PlayerView, turnNumber: number): TurnPhase {
  const turn = view.you?.playerTurns.find((candidate) => candidate.turnNumber === turnNumber)
  return TURN_PHASES.find((phase) => turn?.done[phase] !== true) ?? 'RESEARCH'
}

/**
 * `Turn 4 · Alice's turn — city management phase`, or `Turn 4 · Your turn — ...`
 * for the holder. Only whose turn it is and which phase they are on: the full
 * list of who is missing what is the status strip below the title.
 */
export function chatOrdersTitle(activeTurn: ActiveTurnStatus | null, viewerId?: string): string {
  if (activeTurn === null) return 'Nobody is up'
  const turn = `Turn ${activeTurn.turnNumber}`
  if ((activeTurn.waitingFor ?? []).length === 0) return `${turn} · everyone is done`
  const who = viewerId !== undefined && activeTurn.playerId === viewerId ? 'Your turn' : `${activeTurn.username}'s turn`
  return `${turn} · ${who} — ${TURN_PHASE_LABEL[activeTurn.phase]} phase`
}

/**
 * The system row the server writes when a turn starts. It is told apart by its
 * text: "Turn 5: Bob starts with the Start of turn phase", from the engine's log
 * line. The done rows read "Turn 5 - Bob marked ...", so they never match.
 */
export const isTurnDivider = (row: TimelineMessageDto): boolean =>
  row.kind === 'system' &&
  row.phase === 'SOT' &&
  row.turnNumber !== null &&
  /^Turn \d+: .+ starts with the Start of turn phase$/.test(row.message)

/**
 * The question to ask before an out-of-turn draw, or `null` when the viewer may
 * just draw. Only relevant with chat orders on; the classic panel disables Draw.
 */
export function outOfTurnQuestion(view: PlayerView): string | null {
  if (!view.chatOrders || view.you === null) return null
  if (view.activeTurn?.playerId === view.you.playerId) return null
  const up = view.activeTurn?.username
  return `It is not your turn. ${up === undefined ? 'Nobody is up' : `${up} is up`}. Draw anyway?`
}

const range = (from: number, to: number): readonly number[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index)

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

/** Every player with a colour dot and the phase they are on, or Done. */
export function TurnStatusStrip({ view }: { readonly view: PlayerView }): React.JSX.Element {
  const seats = [...(view.you === null ? [] : [view.you]), ...view.opponents].sort(
    (left, right) => left.playernumber - right.playernumber,
  )
  const waiting = view.activeTurn?.waitingFor ?? []
  return (
    <ul className="chat-orders-strip" aria-label="Turn progress">
      {seats.map((seat) => {
        const phase = waiting.find((entry) => entry.username === seat.username)?.phase
        return (
          <li key={seat.playerId}>
            <span className={`chat-orders-dot ${colorClass(seat.color) ?? 'muted'}`} aria-hidden="true" />
            <span>{seat.username}</span>
            <span className="muted">{phase === undefined ? 'Done' : PHASE_SHORT[phase]}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// One message
// ---------------------------------------------------------------------------

function TimelineRow({
  row,
  author,
  replaced,
}: {
  readonly row: TimelineMessageDto
  readonly author: ChatAuthor | undefined
  readonly replaced: boolean
}): React.JSX.Element {
  if (isTurnDivider(row)) {
    return (
      <li className="chat-orders-message chat-orders-divider" aria-label={row.message}>
        <span>{row.message}</span>
      </li>
    )
  }
  if (row.kind === 'system') {
    return (
      <li className="chat-orders-message chat-orders-system">
        <span>{row.message}</span> <ChatTimestamp createdAt={row.createdAt} />
      </li>
    )
  }
  const tone = colorClass(author?.color ?? null)
  return (
    <li className={`chat-orders-message ${tone ?? ''}`.trim()} data-kind={row.kind}>
      <div className="chat-orders-meta">
        {/* "Greeks - nickname": one box, so the civ never ends up alone at the end of a line */}
        <span className="chat-orders-author">
          {author?.civilization != null && <span className={tone}>{author.civilization} - </span>}
          <strong className={tone}>{row.username}</strong>
        </span>
        <ChatTimestamp createdAt={row.createdAt} />
        {row.kind === 'order' && row.turnNumber !== null && row.phase !== null && (
          <span className="tag turn">{`T${row.turnNumber} · ${PHASE_SHORT[row.phase]}`}</span>
        )}
        {replaced && <span className="tag">replaced</span>}
      </div>
      <div className={replaced ? 'chat-orders-body chat-orders-replaced' : 'chat-orders-body'}>
        <SafeMarkdown markdown={row.message} />
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// The done sheet
// ---------------------------------------------------------------------------

function DoneSheet({
  gameId,
  view,
  currentTurn,
  busy,
  run,
  onClose,
  returnFocusTo,
}: {
  readonly gameId: string
  readonly view: PlayerView
  readonly currentTurn: number
  readonly busy: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly onClose: () => void
  readonly returnFocusTo: RefObject<HTMLElement | null>
}): React.JSX.Element {
  const [turn, setTurn] = useState(currentTurn)
  const [upToChoice, setUpToChoice] = useState<TurnPhase | null>(null)

  const done = view.you?.playerTurns.find((candidate) => candidate.turnNumber === turn)?.done
  const isDone = (phase: TurnPhase): boolean => done?.[phase] === true
  const upTo = upToChoice ?? firstOpenPhase(view, turn)
  // Nothing to mark when the chosen phase and every one before it are done
  const nothingToMark = TURN_PHASES.slice(0, TURN_PHASES.indexOf(upTo) + 1).every(isDone)

  return (
    <ReferenceDialog
      titleId="chat-orders-done-title"
      title="Mark phases done"
      className="chat-orders-done"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
    >
      <label htmlFor="chat-orders-done-turn">
        Turn
        <select
          id="chat-orders-done-turn"
          value={turn}
          onChange={(event) => {
            setTurn(Number(event.target.value))
            setUpToChoice(null)
          }}
        >
          {range(1, currentTurn).map((number) => (
            <option key={number} value={number}>{`Turn ${number}`}</option>
          ))}
        </select>
      </label>

      <ul className="chat-orders-phases" aria-label="Phases">
        {TURN_PHASES.map((phase) => (
          <li key={phase}>
            <span>{PHASE_OPTION[phase]}</span>
            {isDone(phase) ? (
              <button
                type="button"
                className="small"
                disabled={busy}
                aria-label={`Unmark ${PHASE_OPTION[phase]} as done`}
                onClick={() => void run(() => api.unmarkDone(gameId, phase, turn))}
              >
                Done, tap to undo
              </button>
            ) : (
              <span className="muted">Not done</span>
            )}
          </li>
        ))}
      </ul>

      <label htmlFor="chat-orders-done-upto">
        Done up to
        <select
          id="chat-orders-done-upto"
          value={upTo}
          onChange={(event) => {
            const chosen = TURN_PHASES.find((phase) => phase === event.target.value)
            if (chosen !== undefined) setUpToChoice(chosen)
          }}
        >
          {TURN_PHASES.map((phase) => (
            <option key={phase} value={phase}>{PHASE_OPTION[phase]}</option>
          ))}
        </select>
      </label>
      <p className="muted chat-orders-hint">This marks every phase up to the one you pick.</p>
      <button
        type="button"
        className="primary chat-orders-mark"
        disabled={busy || nothingToMark}
        onClick={() => void run(() => api.markDone(gameId, upTo, turn)).then(onClose)}
      >
        {`Mark done up to ${PHASE_OPTION[upTo]}`}
      </button>
    </ReferenceDialog>
  )
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  /** Replaying a revision or an ended game: read, but do not write. */
  readonly readOnly: boolean
  /** A revision is on screen. The private log is not part of the history. */
  readonly replaying?: boolean
  readonly run: (action: () => Promise<PlayerView | unknown>) => Promise<void>
  readonly reloadCount: number
  readonly autoRefresh: boolean
  readonly authors?: ReadonlyMap<string, ChatAuthor>
  readonly editorComponent?: MarkdownEditorComponent | undefined
}

export function ChatOrdersPanel({
  gameId,
  view,
  busy,
  readOnly,
  replaying = false,
  run,
  reloadCount,
  autoRefresh,
  authors,
  editorComponent: EditorComponent = MarkdownEditor,
}: Props): React.JSX.Element {
  const [messages, setMessages] = useState<readonly TimelineMessageDto[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [mode, setMode] = useState<'chat' | 'order'>('chat')
  const [draft, setDraft] = useState('')
  // Null follows the viewer's own progress; a pick sticks until the panel goes.
  const [turnPick, setTurnPick] = useState<number | null>(null)
  const [phasePick, setPhasePick] = useState<TurnPhase | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [privateNote, setPrivateNote] = useState(view.you?.gamenote ?? '')
  const [privateDirty, setPrivateDirty] = useState(false)
  const [privateStatus, setPrivateStatus] = useState<SaveStatus>('saved')

  const requestEpoch = useRef(0)
  // Bumped when the game changes or the panel goes: an answer for the old game
  // must land nowhere, Load more included.
  const gameEpoch = useRef(0)
  const firstPageLoaded = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  // scrollHeight before older rows went in, so the view stays where it was
  const prependFrom = useRef<number | null>(null)
  const composerEditorRef = useRef<MarkdownEditorHandle | null>(null)
  const privateEditorRef = useRef<MarkdownEditorHandle | null>(null)
  const privateDirtyRef = useRef(false)
  const doneButtonRef = useRef<HTMLButtonElement>(null)

  const currentTurn = view.activeTurn?.turnNumber ?? 1
  const orderTurn = turnPick ?? currentTurn
  const orderPhase = phasePick ?? firstOpenPhase(view, orderTurn)
  const canWrite = view.you !== null && !readOnly
  const remoteNote = view.you?.gamenote ?? ''

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current
    try {
      const page = await api.chatPage(gameId)
      if (epoch !== requestEpoch.current) return
      setMessages((held) => mergeTimeline(held, page.messages))
      // Later refreshes must not un-hide "Load more" after older turns were fetched
      if (!firstPageLoaded.current) {
        firstPageLoaded.current = true
        setHasMore(page.hasMore)
      }
      setLoadError(null)
    } catch (caught) {
      if (epoch !== requestEpoch.current) return
      setLoadError(errorMessage(caught))
    }
  }, [gameId])

  // Declared before the load effect so a new game starts empty, then loads.
  useEffect(() => {
    setMessages([])
    setHasMore(false)
    setLoadingMore(false)
    setLoadError(null)
    firstPageLoaded.current = false
    requestEpoch.current += 1
    gameEpoch.current += 1
    return () => {
      requestEpoch.current += 1
      gameEpoch.current += 1
    }
  }, [gameId])

  useEffect(() => {
    void load()
  }, [load, reloadCount])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => { void load() }, TIMELINE_REFRESH_MS)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  const loadMore = async (): Promise<void> => {
    const oldest = messages[0]
    if (oldest === undefined || loadingMore) return
    const epoch = gameEpoch.current
    setLoadingMore(true)
    try {
      const page = await api.chatPage(gameId, oldest.id)
      if (epoch !== gameEpoch.current) return
      prependFrom.current = scrollRef.current?.scrollHeight ?? null
      setMessages((held) => mergeTimeline(held, page.messages))
      setHasMore(page.hasMore)
      setLoadError(null)
    } catch (caught) {
      if (epoch !== gameEpoch.current) return
      setLoadError(errorMessage(caught))
    } finally {
      if (epoch === gameEpoch.current) setLoadingMore(false)
    }
  }

  const replaced = useMemo(() => replacedOrderIds(messages), [messages])
  const visible = useMemo(
    () => messages.filter((row) => isVisible(row, filter)),
    [messages, filter],
  )

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    if (prependFrom.current !== null) {
      element.scrollTop += element.scrollHeight - prependFrom.current
      prependFrom.current = null
    } else if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [visible])

  // The composer changes height when the editor finishes loading or the mode
  // switches, and the timeline is what gives way. Keep the newest message in
  // view when it was in view.
  useEffect(() => {
    const element = scrollRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [filter])

  // A note someone else saved from another tab arrives with the view, unless
  // the one being typed here would be lost.
  useEffect(() => {
    if (!privateDirtyRef.current) setPrivateNote(remoteNote)
  }, [remoteNote])

  useEffect(() => {
    const warnNavigation = (event: Event): void => {
      if (!privateDirtyRef.current) return
      const detail = (event as CustomEvent<NavigationAttempt>).detail
      if (!window.confirm('You have an unsaved private log. Leave without saving?')) {
        detail.allowed = false
      }
    }
    window.addEventListener('civ:navigation-attempt', warnNavigation)
    return () => window.removeEventListener('civ:navigation-attempt', warnNavigation)
  }, [])

  const authorOf = (username: string): ChatAuthor | undefined => authors?.get(username)

  const send = (): void => {
    const text = (composerEditorRef.current?.getMarkdown() ?? draft).trim()
    if (text === '') return
    void run(async () => {
      if (mode === 'order') await api.postOrder(gameId, orderPhase, text, orderTurn)
      else await api.sendChat(gameId, text)
      setDraft('')
      stickToBottom.current = true
      await load()
    })
  }

  const savePrivate = (): void => {
    const text = privateEditorRef.current?.getMarkdown() ?? privateNote
    setPrivateStatus('saving')
    void run(async () => {
      try {
        await api.saveNote(gameId, text)
      } catch (caught) {
        setPrivateStatus('failed')
        throw caught
      }
      privateDirtyRef.current = false
      setPrivateDirty(false)
      setPrivateNote(text)
      setPrivateStatus('saved')
    })
  }

  const showFilters = FILTERS.filter(({ filter: name }) => name !== 'private' || view.you !== null)

  return (
    <CollapsiblePanel id="chat-orders" title="Chat and orders" defaultOpen className="chat-orders">
      {loadError !== null && <div className="error">{loadError}</div>}

      <div className="chat-orders-filters" role="tablist" aria-label="Show">
        {showFilters.map(({ filter: name, label }) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`chat-orders-filter-${name}`}
            className={filter === name ? 'chat-orders-chip revealed' : 'chat-orders-chip'}
            aria-selected={filter === name}
            onClick={() => {
              setFilter(name)
              stickToBottom.current = true
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {filter === 'private' && view.you !== null && replaying ? (
        <div role="tabpanel" id="chat-orders-private-panel" aria-labelledby="chat-orders-filter-private">
          <p className="muted">Your private log is not part of the history.</p>
        </div>
      ) : filter === 'private' && view.you !== null ? (
        <>
          <PrivateLogWorkspace
            note={privateNote}
            dirty={privateDirty}
            onChange={(markdown) => {
              const dirty = markdown !== remoteNote
              privateDirtyRef.current = dirty
              setPrivateDirty(dirty)
              setPrivateNote(markdown)
              setPrivateStatus(dirty ? 'unsaved' : 'saved')
            }}
            onDirty={() => {
              privateDirtyRef.current = true
              setPrivateDirty(true)
              setPrivateStatus('unsaved')
            }}
            saveStatus={privateStatus}
            editorRef={privateEditorRef}
            tabPanelId="chat-orders-private-panel"
            labelledBy="chat-orders-filter-private"
            editorComponent={EditorComponent}
            readOnly={busy || readOnly}
          />
          <button
            type="button"
            className="primary chat-orders-save"
            disabled={busy || readOnly || !privateDirty}
            onClick={savePrivate}
          >
            Save private log
          </button>
        </>
      ) : (
        <div
          role="tabpanel"
          id="chat-orders-timeline-panel"
          aria-labelledby={`chat-orders-filter-${filter}`}
          className="chat-orders-thread"
        >
          <div
            className="chat-orders-scroll"
            ref={scrollRef}
            role="log"
            aria-label="Timeline"
            onScroll={(event) => {
              const element = event.currentTarget
              stickToBottom.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 80
            }}
          >
            {hasMore && (
              <button
                type="button"
                className="chat-orders-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                Load more
              </button>
            )}
            <ul className="chat-orders-list">
              {visible.map((row) => (
                <TimelineRow
                  key={row.id}
                  row={row}
                  author={authorOf(row.username)}
                  replaced={replaced.has(row.id)}
                />
              ))}
              {visible.length === 0 && <li className="muted">Quiet in here.</li>}
            </ul>
          </div>

          {canWrite && (
            <form
              className="chat-orders-composer"
              onSubmit={(event) => {
                event.preventDefault()
                send()
              }}
            >
              <div className="chat-orders-mode" role="group" aria-label="Message type">
                {(['chat', 'order'] as const).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={mode === name ? 'chat-orders-chip revealed' : 'chat-orders-chip'}
                    aria-pressed={mode === name}
                    onClick={() => setMode(name)}
                  >
                    {name === 'chat' ? 'Chat' : 'Order'}
                  </button>
                ))}
              </div>
              {mode === 'order' && (
                <div className="chat-orders-fields">
                  <label htmlFor="chat-orders-turn">
                    Turn
                    <select
                      id="chat-orders-turn"
                      value={orderTurn}
                      onChange={(event) => setTurnPick(Number(event.target.value))}
                    >
                      {/* One turn ahead, so an order can be written before the turn starts */}
                      {range(1, Math.max(currentTurn, orderTurn) + 1).map((number) => (
                        <option key={number} value={number}>{`Turn ${number}`}</option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="chat-orders-phase">
                    Phase
                    <select
                      id="chat-orders-phase"
                      value={orderPhase}
                      onChange={(event) => {
                        const chosen = TURN_PHASES.find((phase) => phase === event.target.value)
                        if (chosen !== undefined) setPhasePick(chosen)
                      }}
                    >
                      {TURN_PHASES.map((phase) => (
                        <option key={phase} value={phase}>{PHASE_OPTION[phase]}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <EditorComponent
                key="composer"
                ref={composerEditorRef}
                value={draft}
                onChange={setDraft}
                readOnly={busy}
                ariaLabel={mode === 'order' ? 'Order' : 'Chat message'}
                // One text for both modes: the editor reads it only when it is created
                placeholder="Write a message …"
              />
              <div className="chat-orders-actions">
                <button
                  type="button"
                  ref={doneButtonRef}
                  aria-haspopup="dialog"
                  onClick={() => setSheetOpen(true)}
                >
                  Done …
                </button>
                <button type="submit" className="primary" disabled={busy || draft.trim() === ''}>
                  Send
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {sheetOpen && canWrite && (
        <DoneSheet
          gameId={gameId}
          view={view}
          currentTurn={currentTurn}
          busy={busy}
          run={run}
          onClose={() => setSheetOpen(false)}
          returnFocusTo={doneButtonRef}
        />
      )}
    </CollapsiblePanel>
  )
}
