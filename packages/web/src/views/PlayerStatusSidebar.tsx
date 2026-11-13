/**
 * A read-only player status sidebar beside the map (issue #342), in the style of
 * the Terraforming Mars player panel on Board Game Arena.
 *
 * One compact block per player (the viewer first, then every opponent): the civ
 * marker, `username - civilization`, the government as text, then every value of
 * the Player status table as an icon with its number. It shows only what the
 * projections already give every member (public stats, the revealed civilization
 * and the government), has no inputs and makes no api calls. Editing stays in the
 * Player status panel, which this does not replace.
 */

import type { CSSProperties } from 'react'

import { leaderAssetId, totalCoins } from '@civ/engine'

import type { PlayerStats, PlayerView } from '../lib/api.js'
import './PlayerStatusSidebar.css'
import { focusPlayer } from './turnFocus.js'

interface Props {
  readonly view: PlayerView
}

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

function Stat({
  label,
  children,
  value,
  className,
}: {
  readonly label: string
  readonly children: React.ReactNode
  readonly value: React.ReactNode
  readonly className?: string | undefined
}): React.JSX.Element {
  return (
    <li className={`pss-stat${className === undefined ? '' : ` ${className}`}`} title={label}>
      {children}
      <span className="pss-value">{value}</span>
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
  const focus = focusPlayer(view.activeTurn)
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

function PlayerBlock({ block }: { readonly block: Block }): React.JSX.Element {
  const { stats } = block
  const leader = leaderUrl(block.civilizationName, block.color)
  const heading = `${block.username} - ${block.civilizationName ?? 'hidden'}`
  const combatHandSize = stats.combatHandSize.trim()
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
        <span>{block.government}</span>
      </p>
      <ul className="pss-grid" aria-label="Economy">
        <Stat label="Coins" value={totalCoins(stats.coinSources)}>
          <FileIcon file="coins.png" label="Coins" />
        </Stat>
        <Stat label="Trade" value={stats.trade}>
          <FileIcon file="trade.png" label="Trade" />
        </Stat>
        <Stat label="Culture" value={stats.culture}>
          <FileIcon file="culture.png" label="Culture" />
        </Stat>
        <Stat label="Culture hand size" value={stats.cultureHandSize}>
          <FileIcon file="culture-hand-size.svg" label="Culture hand size" />
        </Stat>
      </ul>
      <ul className="pss-grid" aria-label="Units">
        <Stat label="Infantry" value={stats.infantry}>
          <FileIcon file="infantry.png" label="Infantry" />
        </Stat>
        <Stat label="Artillery" value={stats.artillery}>
          <FileIcon file="artillery.png" label="Artillery" />
        </Stat>
        <Stat label="Mounted" value={stats.mounted}>
          <FileIcon file="mounted.png" label="Mounted" />
        </Stat>
        <Stat
          label={`Aircraft ${stats.aircraft ? 'unlocked' : 'locked'}`}
          value={stats.aircraft ? '✓' : '–'}
          className={stats.aircraft ? 'pss-unlocked' : 'pss-locked-stat'}
        >
          <FileIcon
            file="aircraft.png"
            label={`Aircraft ${stats.aircraft ? 'unlocked' : 'locked'}`}
            locked={!stats.aircraft}
          />
        </Stat>
      </ul>
      <ul className="pss-grid" aria-label="Modifiers">
        <Stat label="Stacking" value={stats.stacking}>
          <FileIcon file="stacking.png" label="Stacking" />
        </Stat>
        <Stat label="Movement" value={stats.mvmt}>
          <MovementIcon color={block.color} />
        </Stat>
        <Stat label="Combat" value={formatCombat(stats.combat)}>
          <CombatIcon value={stats.combat} />
        </Stat>
        <Stat label="Combat hand size" value={combatHandSize === '' ? '–' : combatHandSize} className={combatHandSize === '' ? 'pss-empty' : undefined}>
          <FileIcon file="combat-hand-size.png" label="Combat hand size" />
        </Stat>
      </ul>
      <ul className="pss-grid" aria-label="Investments">
        <Stat label="EftA" value={stats.efta}>
          <FileIcon file="efta.png" label="EftA" />
        </Stat>
        <Stat label="Infra" value={stats.infra}>
          <FileIcon file="infra.png" label="Infra" />
        </Stat>
        <Stat label="MIC" value={stats.mic}>
          <FileIcon file="mic.png" label="MIC" />
        </Stat>
        <Stat label="PE" value={stats.pe}>
          <FileIcon file="pe.png" label="PE" />
        </Stat>
      </ul>
    </section>
  )
}

export function PlayerStatusSidebar({ view }: Props): React.JSX.Element {
  const blocks = blocksOf(view)
  return (
    <aside className="player-status-sidebar" aria-label="Player status sidebar">
      {blocks.map((block) => (
        <PlayerBlock key={block.playerId} block={block} />
      ))}
      {blocks.length === 0 && <p className="muted">Nobody has joined yet.</p>}
    </aside>
  )
}
