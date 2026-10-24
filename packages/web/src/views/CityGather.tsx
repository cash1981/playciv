/**
 * Devote to the Arts and Harvest on a city card (the follow-up of issue #264).
 *
 * The buttons sit in the card's row with Build and Start Building Program; each opens a
 * small panel under the row. Nothing here is a rule: the culture, its parts, the scouts
 * and the resources come from the engine's `view.you.cityActions`, the server checks the
 * request again against the fresh state, and Undo is the vote every assisted action has.
 * A number typed in place of the culture estimate is sent as typed, and the log says so.
 */

import { useId, useState } from 'react'

import { MAX_DEVOTE_CULTURE } from '@civ/engine'

import type { CityActionOptions, CityProduction, PlayerView } from '../lib/api.js'
import { api } from '../lib/api.js'
import { useCityActionPress } from './CityActions.js'
import type { Run } from './GameView.js'
import './BuildPicker.css'
import './CityCard.css'

export type GatherPanel = 'devote' | 'harvest'

/**
 * What the player is asked before a city acts a second time in a turn: a city takes one action a turn
 * (build, devote, harvest or start a Building Program) and the game lets it do more only after a yes.
 */
export const cityAgainQuestion = (cityLabel: string, acted: readonly string[]): string =>
  `${cityLabel} has already acted this turn (${acted.join(', ')}). A city takes one action each turn. Do it anyway?`

/**
 * Whether the request is sent with `confirmedRepeat`, decided when it is sent. A yes given when the panel or
 * picker was opened stands; a city that has acted since (a panel left open while another action landed, or a
 * stale view) is asked now. `null` when the player says no: nothing is sent.
 */
export function resolveAgain(cityLabel: string, acted: readonly string[], confirmedBefore: boolean): boolean | null {
  if (confirmedBefore) return true
  if (acted.length === 0) return false
  return window.confirm(cityAgainQuestion(cityLabel, acted)) ? true : null
}

/** A whole number from 0 to the engine's cap, or `null` for anything else. */
function parseCulture(typed: string): number | null {
  const trimmed = typed.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return parsed <= MAX_DEVOTE_CULTURE ? parsed : null
}

interface ButtonProps {
  readonly status: 'ready' | 'wrong-phase' | 'unavailable'
  readonly reason: string
  readonly open: boolean
  readonly busy: boolean
  readonly label: string
  readonly ariaLabel: string
  readonly onToggle: () => void
}

/** One of the two buttons. A button that cannot be pressed says why next to it, as Build does. */
function GatherButton({ status, reason, open, busy, label, ariaLabel, onToggle }: ButtonProps): React.JSX.Element {
  const reasonId = useId()
  const ready = status === 'ready'
  return (
    <div className="city-build">
      <div className="city-build-row">
        <button
          type="button"
          className="small"
          aria-label={ariaLabel}
          // The reason on hover, as for the other disabled buttons; ready, what the press does
          title={ready ? ariaLabel : reason}
          aria-expanded={ready ? open : undefined}
          aria-describedby={ready ? undefined : reasonId}
          disabled={busy || !ready}
          onClick={onToggle}
        >
          {label}
        </button>
        {!ready && (
          <span id={reasonId} className="muted">
            {reason}
          </span>
        )}
      </div>
    </div>
  )
}

export function DevoteButton({
  city,
  options,
  open,
  busy,
  onToggle,
}: {
  readonly city: CityProduction
  readonly options: CityActionOptions['devoteToTheArts']
  readonly open: boolean
  readonly busy: boolean
  readonly onToggle: () => void
}): React.JSX.Element {
  return (
    <GatherButton
      status={options.status}
      reason={options.reason}
      open={open}
      busy={busy}
      label="Devote to the Arts"
      ariaLabel={`Devote to the Arts in ${city.label}`}
      onToggle={onToggle}
    />
  )
}

export function HarvestButton({
  city,
  options,
  open,
  busy,
  onToggle,
}: {
  readonly city: CityProduction
  readonly options: CityActionOptions['harvest']
  readonly open: boolean
  readonly busy: boolean
  readonly onToggle: () => void
}): React.JSX.Element {
  return (
    <GatherButton
      status={options.status}
      reason={options.reason}
      open={open}
      busy={busy}
      label="Harvest"
      ariaLabel={`Harvest a resource in ${city.label}`}
      onToggle={onToggle}
    />
  )
}

interface PanelProps {
  readonly city: CityProduction
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly run: Run
  readonly onClose: () => void
  /** The player said yes to a second action of this city this turn when the panel was opened. */
  readonly confirmedAgain: boolean
  /** What the city has done this turn, as the view now says. */
  readonly acted: readonly string[]
}

/**
 * The sum a Devote to the Arts adds up, the scouts that may be sent to the city, and the
 * number that will be taken. The number follows the sum until the player types one.
 */
export function DevotePanel({
  city,
  options,
  gameId,
  view,
  busy,
  run,
  onClose,
  confirmedAgain,
  acted,
}: PanelProps & { readonly options: CityActionOptions['devoteToTheArts'] }): React.JSX.Element | null {
  const { sending, message, press } = useCityActionPress(run, view)
  const [sent, setSent] = useState<readonly string[]>([])
  const [typed, setTyped] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()
  if (view.you === null) return null
  const playerId = view.you.playerId

  const chosen = options.scouts.filter((scout) => sent.includes(scout.pieceId))
  const total = options.culture + chosen.reduce((sum, scout) => sum + scout.culture, 0)
  const shown = typed ?? String(total)
  const amount = parseCulture(shown)
  const invalid = typed !== null && amount === null

  function confirm(): void {
    if (amount === null || sending) return
    const again = resolveAgain(city.label, acted, confirmedAgain)
    if (again === null) return
    const scoutPieceIds = chosen.map((scout) => scout.pieceId)
    const key = `${gameId}:${playerId}:devoteToTheArts:${city.pieceId}:${scoutPieceIds.join('+')}:${amount}`
    void press(key, (requestId) =>
      api.devoteToTheArts(gameId, requestId, view.rev, city.pieceId, {
        scoutPieceIds,
        ...(amount === total ? {} : { culture: amount }),
        ...(again ? { confirmedRepeat: true } : {}),
      }),
    ).then((done) => {
      if (done) onClose()
    })
  }

  return (
    <div className="build-picker gather-panel" role="group" aria-label={`Devote ${city.label} to the arts`}>
      <p className="build-picker-title">
        <strong>Devote {city.label} to the arts</strong>
      </p>
      <ul className="gather-parts" aria-label="Where the culture comes from">
        {options.parts.map((part) => (
          <li key={part.label}>
            {part.label}: +{part.amount}
          </li>
        ))}
      </ul>
      {options.scouts.length > 0 && (
        <fieldset className="gather-scouts">
          <legend>Send a scout to this city</legend>
          {options.scouts.map((scout) => (
            <label key={scout.pieceId} className="gather-scout">
              <input
                type="checkbox"
                checked={sent.includes(scout.pieceId)}
                disabled={busy || sending}
                onChange={(event) => {
                  setSent(event.target.checked ? [...sent, scout.pieceId] : sent.filter((id) => id !== scout.pieceId))
                  setTyped(null)
                }}
              />
              <span>
                Scout at {scout.square} ({scout.source}): +{scout.culture} culture
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="city-edit-row">
        <label htmlFor={inputId}>Culture to take</label>
        <input
          id={inputId}
          className="city-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          value={shown}
          disabled={busy || sending}
          onChange={(event) => setTyped(event.target.value)}
        />
        {typed !== null && typed.trim() !== String(total) && (
          <button type="button" className="small" disabled={busy || sending} onClick={() => setTyped(null)}>
            Use {total}
          </button>
        )}
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="city-error">
          Type a whole number from 0 to {MAX_DEVOTE_CULTURE}.
        </p>
      )}
      <ul className="gather-notes muted" aria-label="What is not counted">
        {options.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {message !== null && (
        <p role="alert" className="city-error">
          {message}
        </p>
      )}
      <div className="build-bar-buttons">
        <button type="button" className="small primary" disabled={busy || sending || amount === null} onClick={confirm}>
          {amount === null ? 'Devote' : `Devote and take ${amount} culture`}
        </button>
        <button type="button" className="small" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** One button per resource the city can harvest, outskirts first, then under a scout. */
export function HarvestPanel({
  city,
  options,
  gameId,
  view,
  busy,
  run,
  onClose,
  confirmedAgain,
  acted,
}: PanelProps & { readonly options: CityActionOptions['harvest'] }): React.JSX.Element | null {
  const { sending, message, press } = useCityActionPress(run, view)
  const reasonPrefix = useId()
  if (view.you === null) return null
  const playerId = view.you.playerId

  function take(choice: CityActionOptions['harvest']['choices'][number]): void {
    if (!choice.available || sending) return
    const again = resolveAgain(city.label, acted, confirmedAgain)
    if (again === null) return
    const key = `${gameId}:${playerId}:harvest:${city.pieceId}:${choice.resource}:${choice.scoutPieceId ?? 'outskirts'}`
    void press(key, (requestId) =>
      again
        ? api.harvest(gameId, requestId, view.rev, city.pieceId, choice.resource, choice.scoutPieceId ?? undefined, true)
        : api.harvest(gameId, requestId, view.rev, city.pieceId, choice.resource, choice.scoutPieceId ?? undefined),
    ).then((done) => {
      if (done) onClose()
    })
  }

  return (
    <div className="build-picker gather-panel" role="group" aria-label={`Harvest a resource in ${city.label}`}>
      <p className="build-picker-title">
        <strong>Harvest a resource in {city.label}</strong>
      </p>
      <p className="build-picker-production">One token goes to your player area.</p>
      <ul className="build-choices">
        {options.choices.map((choice, index) => (
          <li key={`${choice.resource}:${choice.scoutPieceId ?? 'outskirts'}`} className="build-choice">
            <span className="build-choice-text">
              <strong>{choice.label}</strong>
              {!choice.available && (
                <span id={`${reasonPrefix}-${index}`} className="muted">
                  {choice.unavailableReason}
                </span>
              )}
            </span>
            <button
              type="button"
              className="small"
              aria-label={`Take ${choice.label}`}
              aria-describedby={choice.available ? undefined : `${reasonPrefix}-${index}`}
              disabled={busy || sending || !choice.available}
              onClick={() => take(choice)}
            >
              Take
            </button>
          </li>
        ))}
      </ul>
      <ul className="gather-notes muted" aria-label="What is not counted">
        {options.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {message !== null && (
        <p role="alert" className="city-error">
          {message}
        </p>
      )}
      <div className="build-bar-buttons">
        <button type="button" className="small" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
