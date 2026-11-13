/**
 * The player status sidebar beside the map (issue #342), in the style of the
 * Terraforming Mars player panel on Board Game Arena.
 *
 * One compact block per player (the viewer first, then every opponent): the civ
 * marker, `username - civilization`, the government with its seal, then every
 * value of the Player status table as an icon with its number. It shows only what
 * the projections already give every member (public stats, the revealed
 * civilization and the government).
 *
 * It edits the same fields the Player status panel does, with the same rules:
 * shared bookkeeping that ANY member may change for ANY player, saved through
 * `api.setPlayerStat` / `api.setPlayerGovernment`, disabled while busy and absent
 * for a viewer who cannot edit (spectator, replay, locked game). A stat is a tap
 * target that opens a compact editor for that one value. Coins total, Culture
 * hand size and Combat are calculated and stay read-only; the Coins counters are
 * edited in the Player status panel.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import {
  GOVERNMENTS,
  MAX_COMBAT_HAND_SIZE_LENGTH,
  leaderAssetId,
  totalCoins,
  tradeCeilingOf,
} from '@civ/engine'
import type { Government, PlayerStatKey } from '@civ/engine'

import { api } from '../lib/api.js'
import type { PlayerStats, PlayerView } from '../lib/api.js'
import { GovernmentReferenceDialog } from './GovernmentReferenceDialog.js'
import type { Run } from './GameView.js'
import './PlayerStatusSidebar.css'
import { parseStatInput } from './statInput.js'
import type { StatInputKind } from './statInput.js'
import { focusPlayer } from './turnFocus.js'

interface Props {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  /** Spectator, replay or locked game: nothing can be edited. */
  readonly readOnly: boolean
  readonly run: Run
}

/** The stats the sidebar edits; Aircraft is a switch, Culture hand size and Combat are calculated. */
type EditableStatKey = Exclude<PlayerStatKey, 'aircraft' | 'cultureHandSize' | 'combat'>

interface Block {
  readonly playerId: string
  readonly username: string
  readonly color: string | null
  readonly onTurn: boolean
  readonly civilizationName: string | null
  readonly government: string
  readonly stats: PlayerStats
}

const ICON_DIR = '/status-icons'

/** The name of each editable stat in the editor and in its accessible names. */
const EDIT_LABELS: Readonly<Record<EditableStatKey, string>> = {
  trade: 'Trade',
  culture: 'Culture',
  infantry: 'Infantry',
  artillery: 'Artillery',
  mounted: 'Mounted',
  stacking: 'Stacking',
  mvmt: 'Movement',
  combatHandSize: 'Combat hand size',
  efta: 'EftA',
  infra: 'Infra',
  mic: 'MIC',
  pe: 'PE',
}

/** Player colour names to the hex of the army flag; anything else gets a neutral grey. */
const FLAG_COLORS: Readonly<Record<string, string>> = {
  blue: '#22b5ea',
  green: '#43b04a',
  purple: '#8a52b0',
  red: '#d9392f',
  yellow: '#f3c32b',
  white: '#f4f4f4',
}
const NEUTRAL_FLAG_COLOR = '#9aa3a7'

export function flagColor(color: string | null): string {
  return (color === null ? undefined : FLAG_COLORS[color.toLowerCase()]) ?? NEUTRAL_FLAG_COLOR
}

/** The 12-point starburst of the combat badge: radii 62 and 44 around (64, 64). */
const STARBURST_POINTS = Array.from({ length: 24 }, (_, index) => {
  const radius = index % 2 === 0 ? 62 : 44
  const angle = (index * Math.PI) / 12 - Math.PI / 2
  return `${(64 + radius * Math.cos(angle)).toFixed(2)},${(64 + radius * Math.sin(angle)).toFixed(2)}`
}).join(' ')

/** `+2` for a bonus, `-1` for a penalty, `+0` for none. */
export function formatCombat(value: number): string {
  return value < 0 ? String(value) : `+${value}`
}

function MovementIcon({ color }: { readonly color: string | null }): React.JSX.Element {
  return (
    <svg
      className="pss-icon"
      viewBox="0 0 64 64"
      role="img"
      aria-label="Movement"
      data-testid="movement-icon"
    >
      <title>Movement</title>
      <g stroke="#6b7479" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M5 17h18" />
        <path d="M2 29h21" />
        <path d="M7 41h16" />
      </g>
      <path
        d="M33 12c7-4 15-3 24 2l-3 9 3 9c-9-5-17-6-24-2z"
        fill={flagColor(color)}
        stroke="#1b1b1b"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M31.5 6v50" stroke="#1b1b1b" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function CombatIcon({ value }: { readonly value: number }): React.JSX.Element {
  const text = formatCombat(value)
  const fontSize = text.length <= 2 ? 44 : text.length === 3 ? 34 : 27
  return (
    <svg
      className="pss-icon"
      viewBox="0 0 128 128"
      role="img"
      aria-label="Combat"
      data-testid="combat-icon"
    >
      <title>Combat</title>
      <polygon points={STARBURST_POINTS} fill="#e8532b" stroke="#7a2412" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="64" cy="64" r="34" fill="#fff1d0" stroke="#7a2412" strokeWidth="3" />
      <text
        x="64"
        y="64"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fill="#3a1a0c"
        data-testid="combat-value"
      >
        {text}
      </text>
    </svg>
  )
}

function FileIcon({ file, label, locked = false }: { readonly file: string; readonly label: string; readonly locked?: boolean }): React.JSX.Element {
  return (
    <img
      className={`pss-icon${locked ? ' pss-locked' : ''}`}
      src={`${ICON_DIR}/${file}`}
      alt={label}
      title={label}
      draggable={false}
    />
  )
}

/** How a stat cell is operated: it opens an editor, or (Aircraft) it is a switch. */
type StatControl =
  | {
      readonly kind: 'edit'
      /** `Edit Alice Trade, currently 6`. */
      readonly label: string
      readonly open: boolean
      /** Busy: dimmed and ignoring taps, but still focusable so focus survives a save. */
      readonly disabled: boolean
      readonly onOpen: () => void
      readonly onPressStart: () => void
      /** The press left the button or was cancelled, so no click follows it. */
      readonly onPressCancel: () => void
      readonly buttonRef: (element: HTMLButtonElement | null) => void
    }
  | {
      readonly kind: 'switch'
      readonly label: string
      readonly checked: boolean
      readonly disabled: boolean
      readonly onToggle: () => void
    }

function Stat({
  label,
  children,
  value,
  className,
  control,
}: {
  readonly label: string
  readonly children: React.ReactNode
  readonly value: React.ReactNode
  readonly className?: string | undefined
  /** Absent when the stat is calculated or the viewer cannot edit. */
  readonly control?: StatControl | undefined
}): React.JSX.Element {
  const content = (
    <>
      {children}
      <span className="pss-value">{value}</span>
    </>
  )
  return (
    <li className={`pss-stat${className === undefined ? '' : ` ${className}`}`} title={label}>
      {control === undefined ? (
        content
      ) : control.kind === 'edit' ? (
        <button
          type="button"
          className="pss-stat-button"
          ref={control.buttonRef}
          aria-label={control.label}
          aria-expanded={control.open}
          aria-disabled={control.disabled}
          onMouseDown={control.onPressStart}
          onMouseLeave={control.onPressCancel}
          onPointerCancel={control.onPressCancel}
          onClick={control.onOpen}
        >
          {content}
        </button>
      ) : (
        <button
          type="button"
          role="switch"
          className="pss-stat-button"
          aria-label={control.label}
          aria-checked={control.checked}
          aria-disabled={control.disabled}
          onClick={control.onToggle}
        >
          {content}
        </button>
      )}
    </li>
  )
}

/**
 * The editor for one stat, shown under its grid row: a stepper for numbers, a
 * text field for Movement and Combat hand size. Enter, Done or leaving the editor
 * saves; Escape cancels; an invalid or out-of-range entry is dropped like the
 * Player status table's cell drops it, so nothing is sent.
 */
function StatEditor({
  name,
  kind,
  value,
  max,
  onSave,
  onClose,
}: {
  /** `Alice Trade` */
  readonly name: string
  readonly kind: StatInputKind
  readonly value: number | string
  /** The largest whole number a numeric stat takes (Trade: the civ's ceiling). */
  readonly max?: number | undefined
  readonly onSave: (value: number | string) => void
  /** `restoreFocus`: hand focus back to the stat that opened the editor. */
  readonly onClose: (restoreFocus: boolean) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value))
  // What the field showed when it was last in sync with the saved value. An untouched
  // draft never saves, so a value changed by someone else while this editor is open
  // is not overwritten by the stale number the field still holds.
  const initial = useRef(value)
  const touched = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Closing moves focus, which blurs the field again; only the first finish counts.
  const finished = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    if (touched.current) return
    initial.current = value
    setDraft(String(value))
  }, [value])

  function finish(save: boolean, restoreFocus: boolean): void {
    if (finished.current) return
    finished.current = true
    if (save) {
      const result = parseStatInput(kind, draft, max)
      if (result.ok && result.value !== initial.current) onSave(result.value)
    }
    onClose(restoreFocus)
  }

  const numeric = kind === 'number'
  // The stepper starts from the typed number, or from the saved one when the draft is not a number.
  const typed = parseStatInput('number', draft)
  const current = typed.ok && typeof typed.value === 'number' ? typed.value : Number(value)
  const step = (delta: number): void => {
    const next = Math.max(0, max === undefined ? current + delta : Math.min(max, current + delta))
    touched.current = true
    setDraft(String(next))
    // A stepper that disables itself at the end of its range must not keep focus,
    // or Escape and Enter would stop reaching the editor.
    if ((delta < 0 && next <= 0) || (delta > 0 && max !== undefined && next >= max)) {
      inputRef.current?.focus()
    }
  }
  // A button must not take focus from the field: that would blur it and save early.
  const keepFocus = (event: React.MouseEvent): void => event.preventDefault()

  return (
    <li className="pss-editor">
      <div
        role="group"
        aria-label={`Edit ${name}`}
        className="pss-editor-box"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) finish(true, false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(false, true)
          } else if (event.key === 'Enter' && event.target === inputRef.current) {
            event.preventDefault()
            finish(true, true)
          }
        }}
      >
        {numeric && (
          <button
            type="button"
            className="pss-step"
            aria-label={`Decrease ${name}`}
            disabled={current <= 0}
            onMouseDown={keepFocus}
            onClick={() => step(-1)}
          >
            −
          </button>
        )}
        <input
          ref={inputRef}
          className="pss-editor-input"
          type="text"
          aria-label={name}
          inputMode={numeric ? 'numeric' : 'text'}
          maxLength={kind === 'freeText' ? MAX_COMBAT_HAND_SIZE_LENGTH : undefined}
          value={draft}
          onChange={(event) => {
            touched.current = true
            setDraft(event.target.value)
          }}
        />
        {numeric && (
          <button
            type="button"
            className="pss-step"
            aria-label={`Increase ${name}`}
            disabled={max !== undefined && current >= max}
            onMouseDown={keepFocus}
            onClick={() => step(1)}
          >
            +
          </button>
        )}
        <button
          type="button"
          className="pss-done"
          aria-label={`Done editing ${name}`}
          onMouseDown={keepFocus}
          onClick={() => finish(true, true)}
        >
          Done
        </button>
        {max !== undefined && <span className="pss-editor-hint">max {max}</span>}
      </div>
    </li>
  )
}

function leaderUrl(civilizationName: string | null, color: string | null): string | null {
  if (civilizationName === null || color === null) return null
  const id = leaderAssetId(civilizationName, color)
  if (id === undefined) return null
  return `/board/${id.split('/').map(encodeURIComponent).join('/')}.png`
}

function blocksOf(view: PlayerView): Block[] {
  // An ended game keeps its last activeTurn, so no one is on turn once it is over.
  const focus = view.active ? focusPlayer(view.activeTurn) : null
  const onTurn = (username: string): boolean => focus?.username === username
  const blocks: Block[] = []
  if (view.you !== null) {
    blocks.push({
      playerId: view.you.playerId,
      username: view.you.username,
      color: view.you.color,
      onTurn: onTurn(view.you.username),
      civilizationName: view.you.civilization?.name ?? null,
      government: view.you.government,
      stats: view.you.stats,
    })
  }
  for (const opponent of view.opponents) {
    blocks.push({
      playerId: opponent.playerId,
      username: opponent.username,
      color: opponent.color,
      onTurn: onTurn(opponent.username),
      civilizationName: opponent.civilization?.name ?? null,
      government: opponent.government,
      stats: opponent.stats,
    })
  }
  return blocks
}

function PlayerBlock({
  block,
  gameId,
  busy,
  readOnly,
  run,
  onShowReference,
}: {
  readonly block: Block
  readonly gameId: string
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** Opens the government card reference; the button is where focus returns to. */
  readonly onShowReference: (opener: HTMLElement) => void
}): React.JSX.Element {
  const { stats } = block
  const leader = leaderUrl(block.civilizationName, block.color)
  const heading = `${block.username} - ${block.civilizationName ?? 'hidden'}`
  const combatHandSize = stats.combatHandSize.trim()
  const [editing, setEditing] = useState<EditableStatKey | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const active = !readOnly && !busy ? editing : null
  // A save from the editor makes the sidebar busy before the next tap's click can land
  // (tapping stat B blurs the editor of A, which saves). That tap is kept and opens B
  // once the save is done.
  const saving = useRef(false)
  const pendingOpen = useRef<EditableStatKey | null>(null)
  // Whether the editor of the stat was open when the press began: the blur it causes
  // closes the editor, so the click must not reopen it.
  const pressedOpen = useRef(false)
  useEffect(() => {
    if (readOnly || busy) {
      setEditing(null)
      // A viewer who can no longer edit must not get an editor, and its focus
      // grab, when they can edit again.
      if (readOnly) {
        pendingOpen.current = null
        saving.current = false
      }
      return
    }
    saving.current = false
    const next = pendingOpen.current
    pendingOpen.current = null
    if (next !== null) setEditing(next)
  }, [readOnly, busy])

  const save = (key: PlayerStatKey, value: number | string | boolean): void => {
    saving.current = true
    void run(() => api.setPlayerStat(gameId, block.playerId, key, value))
  }

  /** The control of an editable stat, or none for a viewer who cannot edit. */
  const edit = (key: EditableStatKey): StatControl | undefined =>
    readOnly
      ? undefined
      : {
          kind: 'edit',
          label: `Edit ${block.username} ${EDIT_LABELS[key]}, currently ${String(stats[key]).trim() || 'empty'}`,
          open: active === key,
          disabled: busy,
          onPressStart: () => {
            pressedOpen.current = active === key
          },
          onPressCancel: () => {
            pressedOpen.current = false
          },
          onOpen: () => {
            const wasOpen = pressedOpen.current || active === key
            pressedOpen.current = false
            if (wasOpen) {
              setEditing(null)
              return
            }
            if (busy) {
              if (saving.current) pendingOpen.current = key
              return
            }
            saving.current = false
            setEditing(key)
          },
          buttonRef: (element) => {
            if (element === null) buttons.current.delete(key)
            else buttons.current.set(key, element)
          },
        }

  /** The editor, placed after the last cell of the grid that holds the edited stat. */
  const editorIn = (keys: readonly EditableStatKey[]): React.JSX.Element | null => {
    if (active === null || !keys.includes(active)) return null
    const kind: StatInputKind =
      active === 'mvmt' ? 'movement' : active === 'combatHandSize' ? 'freeText' : 'number'
    const label = EDIT_LABELS[active]
    return (
      <StatEditor
        key={active}
        name={`${block.username} ${label}`}
        kind={kind}
        value={stats[active]}
        max={active === 'trade' ? tradeCeilingOf(block.civilizationName) : undefined}
        onSave={(value) => save(active, value)}
        onClose={(restoreFocus) => {
          if (restoreFocus) buttons.current.get(active)?.focus()
          setEditing(null)
        }}
      />
    )
  }

  return (
    <section
      className="pss-block"
      aria-label={`${block.username} status`}
      style={block.color === null ? undefined : ({ '--player-color': block.color.toLowerCase() } as CSSProperties)}
    >
      <header className="pss-header">
        {leader !== null ? (
          <img className="pss-civ" src={leader} alt={`${block.civilizationName ?? ''} marker`} draggable={false} />
        ) : (
          block.color !== null && <span className="swatch pss-swatch" aria-hidden="true" />
        )}
        <h3 className="pss-title" title={heading}>{heading}</h3>
        {block.onTurn && <span className="tag turn">turn</span>}
      </header>
      <p className="pss-government" title="Government">
        <img className="pss-seal" src={`${ICON_DIR}/government.svg`} alt="Government" draggable={false} />
        {readOnly ? (
          <span className="pss-government-name">{block.government}</span>
        ) : (
          <select
            className="government-select"
            aria-label={`${block.username} government`}
            value={block.government}
            disabled={busy}
            onChange={(event) =>
              void run(() =>
                api.setPlayerGovernment(gameId, block.playerId, event.target.value as Government),
              )
            }
          >
            {GOVERNMENTS.map((government) => (
              <option key={government} value={government}>{government}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="help-button pss-help"
          aria-label="Show government card reference"
          title="Show government card reference"
          onClick={(event) => onShowReference(event.currentTarget)}
        >
          ?
        </button>
      </p>
      <ul className="pss-grid" aria-label="Economy">
        <Stat label="Coins" value={totalCoins(stats.coinSources)}>
          <FileIcon file="coins.png" label="Coins" />
        </Stat>
        <Stat label="Trade" value={stats.trade} control={edit('trade')}>
          <FileIcon file="trade.png" label="Trade" />
        </Stat>
        <Stat label="Culture" value={stats.culture} control={edit('culture')}>
          <FileIcon file="culture.png" label="Culture" />
        </Stat>
        <Stat label="Culture hand size" value={stats.cultureHandSize}>
          <FileIcon file="culture-hand-size.svg" label="Culture hand size" />
        </Stat>
        {editorIn(['trade', 'culture'])}
      </ul>
      <ul className="pss-grid" aria-label="Units">
        <Stat label="Infantry" value={stats.infantry} control={edit('infantry')}>
          <FileIcon file="infantry.png" label="Infantry" />
        </Stat>
        <Stat label="Artillery" value={stats.artillery} control={edit('artillery')}>
          <FileIcon file="artillery.png" label="Artillery" />
        </Stat>
        <Stat label="Mounted" value={stats.mounted} control={edit('mounted')}>
          <FileIcon file="mounted.png" label="Mounted" />
        </Stat>
        <Stat
          label={`Aircraft ${stats.aircraft ? 'unlocked' : 'locked'}`}
          value={stats.aircraft ? '✓' : '–'}
          className={stats.aircraft ? 'pss-unlocked' : 'pss-locked-stat'}
          control={
            readOnly
              ? undefined
              : {
                  kind: 'switch',
                  label: `${block.username} Aircraft unlocked`,
                  checked: stats.aircraft,
                  disabled: busy,
                  onToggle: () => {
                    if (!busy) save('aircraft', !stats.aircraft)
                  },
                }
          }
        >
          <FileIcon
            file="aircraft.png"
            label={`Aircraft ${stats.aircraft ? 'unlocked' : 'locked'}`}
            locked={!stats.aircraft}
          />
        </Stat>
        {editorIn(['infantry', 'artillery', 'mounted'])}
      </ul>
      <ul className="pss-grid" aria-label="Modifiers">
        <Stat label="Stacking" value={stats.stacking} control={edit('stacking')}>
          <FileIcon file="stacking.png" label="Stacking" />
        </Stat>
        <Stat label="Movement" value={stats.mvmt} control={edit('mvmt')}>
          <MovementIcon color={block.color} />
        </Stat>
        <Stat label="Combat" value={formatCombat(stats.combat)}>
          <CombatIcon value={stats.combat} />
        </Stat>
        <Stat
          label="Combat hand size"
          value={combatHandSize === '' ? '–' : combatHandSize}
          className={combatHandSize === '' ? 'pss-empty' : undefined}
          control={edit('combatHandSize')}
        >
          <FileIcon file="combat-hand-size.png" label="Combat hand size" />
        </Stat>
        {editorIn(['stacking', 'mvmt', 'combatHandSize'])}
      </ul>
      <ul className="pss-grid" aria-label="Investments">
        <Stat label="EftA" value={stats.efta} control={edit('efta')}>
          <FileIcon file="efta.png" label="EftA" />
        </Stat>
        <Stat label="Infra" value={stats.infra} control={edit('infra')}>
          <FileIcon file="infra.png" label="Infra" />
        </Stat>
        <Stat label="MIC" value={stats.mic} control={edit('mic')}>
          <FileIcon file="mic.png" label="MIC" />
        </Stat>
        <Stat label="PE" value={stats.pe} control={edit('pe')}>
          <FileIcon file="pe.png" label="PE" />
        </Stat>
        {editorIn(['efta', 'infra', 'mic', 'pe'])}
      </ul>
    </section>
  )
}

export function PlayerStatusSidebar({ gameId, view, busy, readOnly, run }: Props): React.JSX.Element {
  const blocks = blocksOf(view)
  const [showReference, setShowReference] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  return (
    <aside className="player-status-sidebar" aria-label="Player status sidebar">
      {blocks.map((block) => (
        <PlayerBlock
          key={block.playerId}
          block={block}
          gameId={gameId}
          busy={busy}
          readOnly={readOnly}
          run={run}
          onShowReference={(button) => {
            opener.current = button
            setShowReference(true)
          }}
        />
      ))}
      {blocks.length === 0 && <p className="muted">Nobody has joined yet.</p>}
      {showReference && (
        <GovernmentReferenceDialog returnFocusTo={opener} onClose={() => setShowReference(false)} />
      )}
    </aside>
  )
}
