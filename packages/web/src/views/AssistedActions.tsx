/**
 * Assisted actions in the browser (#260): the game does a step for the player
 * instead of asking them to edit counters by hand.
 *
 * The state of every button comes from `view.you.availableActions`, which the
 * engine computes once for the viewer. This file adds no rule of its own: it
 * lists the ready and used rows, shows the `status` and puts the `reason` behind
 * a help button, and sends one request per press.
 *
 * Two entry points use the same {@link AssistedActionButton}: the phase tabs
 * (`PhaseTabs.tsx`) and the tech detail dialog. Neither fires anything by rendering;
 * only a press does.
 */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'

import {
  ANY_RESOURCES,
  ASSISTED_TECH_PICKERS,
  INVESTABLE_COIN_SOURCES,
  brandenburgForbiddenCells,
  combustionTargets,
  findCoinSource,
  isMapCell,
  itemName,
  nukeTargetsOf,
  obsoletableWondersOf,
  destroyableBuildingsOf,
  occupancyOf,
  squareLabel,
  steamPowerDestinations,
  steamPowerFiguresAt,
  steamPowerSources,
} from '@civ/engine'
import type { AssistedActionKind, CombustionTarget, PendingRewardView, TechPicker, TurnPhase } from '@civ/engine'

import { ApiError, api } from '../lib/api.js'
import type { PlayerView } from '../lib/api.js'
import type { BuildFlow } from './buildFlow.js'
import { endTurnState } from './EndTurn.js'
import { HelpHint } from './HelpHint.js'
import { useMapPicker } from './mapPick.js'
import { ItemCard } from './ItemCard.js'
import { goToHandItem, goToPanel } from './PhaseSummary.js'
import type { Run } from './GameView.js'
import './AssistedActions.css'

type Status = NonNullable<PlayerView['you']>['availableActions'][number]['status']

const STATUS_TEXT: Readonly<Record<Status, string>> = {
  ready: 'Ready',
  used: 'Used',
  'needs-resource': 'Needs resource',
  'wrong-phase': 'Not now',
  'not-owned': 'Not owned',
  unavailable: 'Unavailable',
}

/**
 * A request id per press. It is kept while the outcome is unknown, so a double
 * click or a retry of the same press sends the same id and the server does the
 * action once. It is freed in three cases:
 *
 * - the press succeeded;
 * - the server answered with a status that means it decided not to apply the
 *   write: below 500, except 408 (request timeout) and 429 (too many requests),
 *   which say nothing about whether the write was applied (see
 *   {@link serverDeclined});
 * - the projection shows the action as applied: the kept id is the `id` of a
 *   record in `view.assistedActions`, so the press landed even though its
 *   response was lost, and the next press is a new one (see
 *   {@link dropLandedId}).
 *
 * It is kept for 500 and above (a gateway, or Cloudflare's resource limit, can
 * answer after the Worker applied the write) and for a failure with no response
 * at all (network down, lost response). Kept at module level, keyed on game,
 * viewer and action, so the panel and the dialog share it, a remount (closing the
 * dialog) does not lose it, and another account in the same tab never reuses it.
 */
const pendingRequestIds = new Map<string, string>()
const inFlight = new Set<string>()

/** Whether a press with this key has been sent and has not settled yet. */
export function isPressInFlight(key: string): boolean {
  return inFlight.has(key)
}

/** For tests: forget every kept request id. */
export function resetPendingRequestIds(): void {
  pendingRequestIds.clear()
  inFlight.clear()
}

function newRequestId(): string {
  const random = globalThis.crypto?.randomUUID
  if (typeof random === 'function') return random.call(globalThis.crypto)
  // Old browsers and insecure contexts have no randomUUID. The id only has to be
  // unique per press, not unguessable.
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * True when the status proves the server decided not to apply the write. A 5xx
 * does not: it can come from a gateway after the Worker did the work. 408 and 429
 * are 4xx but come from the edge or a limiter, not from the game's own decision.
 */
function serverDeclined(status: unknown): boolean {
  return typeof status === 'number' && status < 500 && status !== 408 && status !== 429
}

/**
 * The kept id is the `id` of an applied action in the projection: the press
 * landed. Forget the id, so the next press (a second culture advance, say) is a
 * new request and not an idempotent replay of the first.
 */
function dropLandedId(key: string, view: PlayerView | undefined): void {
  const kept = pendingRequestIds.get(key)
  if (kept !== undefined && view?.assistedActions?.some((record) => record.id === kept)) {
    pendingRequestIds.delete(key)
  }
}

/**
 * One press, with its kept request id. `key` says which press it is: the same key
 * while the outcome is unknown reuses the id, a settled one gets a new id.
 * Resolves to true when the request succeeded.
 */
export function pressOnce(
  key: string,
  run: Run,
  send: (requestId: string) => Promise<PlayerView>,
  view?: PlayerView,
): Promise<boolean> {
  // A second click before the first has settled is the same press.
  if (inFlight.has(key)) return Promise.resolve(false)
  dropLandedId(key, view)
  const requestId = pendingRequestIds.get(key) ?? newRequestId()
  pendingRequestIds.set(key, requestId)
  inFlight.add(key)
  let succeeded = false
  const settle = (): boolean => {
    inFlight.delete(key)
    return succeeded
  }
  return run(async () => {
    try {
      const result = await send(requestId)
      succeeded = true
      pendingRequestIds.delete(key)
      return result
    } catch (caught) {
      // See the comment on pendingRequestIds for which failures spend the id.
      if (caught instanceof ApiError && serverDeclined(caught.status)) {
        pendingRequestIds.delete(key)
      }
      throw caught
    }
  }).then(settle, settle)
}

/** A status that leaves the culture advance on the page, disabled, with its reason behind the `?`. */
const isBlockedHere = (status: Status): boolean => status === 'needs-resource' || status === 'unavailable'

/** Actions whose button does not read "Use <label>". */
const BUTTON_TEXT: Readonly<Partial<Record<AssistedActionKind, string>>> = {
  cultureAdvance: 'Advance culture',
}

/**
 * Where an action's name should link: the card or panel that says what it does.
 * A tech card has its place in the tech tree; the other card groups point at the
 * panel that holds them. `undefined` leaves the name as plain text.
 */
function cardLinkOf(
  candidate: NonNullable<PlayerView['you']>['availableActions'][number],
  view: PlayerView,
): { readonly where: string; readonly go: () => void } | undefined {
  if (candidate.techName !== undefined) {
    return { where: 'the tech panel', go: () => goToPanel('techs') }
  }
  if (candidate.group === 'Social policies') {
    return { where: 'the social policy panel', go: () => goToPanel('social-policy', true) }
  }
  if (candidate.group === 'Wonders') {
    return { where: 'the map', go: () => goToPanel('board') }
  }
  if (candidate.group === 'Great Persons') {
    const card = view.you?.items?.find((item) => itemName(item) === candidate.label)
    if (card !== undefined) return { where: 'your hand', go: () => goToHandItem(card.id) }
  }
  return undefined
}

/** What a tech picker has chosen so far, one shape per kind of picker (`ASSISTED_TECH_PICKERS`). */
type TechPick =
  | { readonly kind: 'resources'; readonly resources: readonly string[] }
  | {
      readonly kind: 'gunpowder'
      readonly resources: readonly string[]
      readonly mode: 'obsolete' | 'destroy'
      readonly wonderPieceId: string
      readonly buildingPieceId: string
    }
  | { readonly kind: 'city'; readonly cityPieceId: string }
  | { readonly kind: 'player'; readonly targetId: string; readonly note: string }
  | { readonly kind: 'coin'; readonly targetId: string; readonly source: string }
  | { readonly kind: 'monarchy'; readonly mode: 'obsolete' | 'kill'; readonly targetId: string; readonly wonderPieceId: string }
  | { readonly kind: 'arenaUnit'; readonly arenaUnitId: string }
  | { readonly kind: 'atomic'; readonly mode: 'extraActions' | 'nuke'; readonly cityPieceId: string }

type Opponent = PlayerView['opponents'][number]

/** The viewer's own living units in the arena, which Metalworking may give attack to. */
function ownArenaUnits(view: PlayerView) {
  const me = view.you?.playerId
  return (view.battle?.arena ?? []).filter((unit) => unit.placedBy === me && !unit.killed)
}

/** The wonders a player owns that Monarchy (ancient) or Gunpowder (ancient and medieval) may obsolete, from the public board and the players' names. */
function obsoletableWondersInView(view: PlayerView, eras: readonly ('Ancient' | 'Medieval')[] = ['Ancient']) {
  const me = view.you
  if (me === null) return []
  return obsoletableWondersOf(view.board, [me, ...(view.opponents ?? [])].map((player) => ({ playerId: player.playerId, username: player.username })), eras)
}

/** The buildings on the map Gunpowder may destroy, with the player whose outskirts hold each. */
function destroyableBuildingsInView(view: PlayerView) {
  const me = view.you
  if (me === null) return []
  return destroyableBuildingsOf({ board: view.board, players: [] }, [me, ...(view.opponents ?? [])].map((player) => ({ username: player.username, color: player.color })))
}

/** The cities of other players Atomic Theory may nuke, with what each would take with it: the public board and the players' colours. */
function nukeTargetsInView(view: PlayerView) {
  const me = view.you
  if (me === null) return []
  const owners = [me, ...(view.opponents ?? [])].map((player) => ({ playerId: player.playerId, username: player.username, color: player.color }))
  return nukeTargetsOf({ board: view.board, players: [] }, me.playerId, owners)
}

/** The coin counters of an opponent that hold a coin token (the public status board), with what is on each. */
function coinCountersOf(opponent: Opponent): readonly { readonly key: string; readonly label: string; readonly coins: number }[] {
  return INVESTABLE_COIN_SOURCES.flatMap((key) => {
    const coins = opponent.stats?.coinSources?.[key] ?? 0
    return coins > 0 ? [{ key, label: findCoinSource(key)?.label ?? key, coins }] : []
  })
}

interface PickerFormProps {
  readonly pick: TechPick
  readonly setPick: (pick: TechPick | null) => void
  readonly view: PlayerView
  readonly label: string
  readonly canSubmit: boolean
  readonly picker: TechPicker | undefined
  readonly send: (args: Record<string, unknown>) => void
}

/**
 * The question a tech ability asks before it is sent: which resources to pay, which city, which other player (and,
 * for a cancel, what is cancelled as free text), which coin counter, or Monarchy's mode. It decides no rule: it sends
 * what was picked and the engine accepts or refuses it. Nothing is sent by opening it; only the submit button sends.
 */
function TechPickerForm({ pick, setPick, view, label, canSubmit, picker, send }: PickerFormProps): React.JSX.Element {
  const opponents = view.opponents ?? []
  // The view is fetched again while the picker is open: what was picked may be gone (a city, a unit, a counter, a player).
  // The selection is worked out here, so the option the list shows is the one that is sent and the one the button names
  const radioName = useId()
  const stillThere = (ids: readonly string[], wanted: string): string => (ids.includes(wanted) ? wanted : (ids[0] ?? ''))
  const playerIds = opponents.map((opponent) => opponent.playerId)
  const cancel = (
    <button type="button" className="small" onClick={() => setPick(null)}>
      Cancel
    </button>
  )
  const playerSelect = (value: string, onChange: (id: string) => void, hint?: (opponent: Opponent) => string) => (
    <select aria-label="Player" value={value} onChange={(event) => onChange(event.target.value)}>
      {opponents.map((opponent) => (
        <option key={opponent.playerId} value={opponent.playerId}>
          {opponent.username}
          {hint === undefined ? '' : ` (${hint(opponent)})`}
        </option>
      ))}
    </select>
  )

  if (pick.kind === 'resources' && picker?.kind === 'resources') {
    const { resources } = pick
    return (
      <span className="assisted-any-pick" role="group" aria-label={`Resources to pay for ${label}`}>
        {resources.map((resource, index) => (
          <select
            key={index}
            aria-label={`Resource ${index + 1}`}
            value={resource}
            onChange={(event) =>
              setPick({ kind: 'resources', resources: resources.map((current, at) => (at === index ? event.target.value : current)) })
            }
          >
            {ANY_RESOURCES.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        ))}
        <span className="muted">Tokens you hold pay for any you lack; culture cards only if tokens run out.</span>
        <button type="button" className="small" disabled={!canSubmit} onClick={() => send({ resources })}>
          Pay {listOf(resources)}
        </button>
        {cancel}
      </span>
    )
  }

  if (pick.kind === 'gunpowder') {
    const { resources } = pick
    const wonders = obsoletableWondersInView(view, ['Ancient', 'Medieval'])
    const buildings = destroyableBuildingsInView(view)
    const obsolete = pick.mode === 'obsolete'
    // The selections follow the view, as the other pickers do: what is gone is replaced by the first left, and with none nothing is chosen
    const wonderId = stillThere(wonders.map((wonder) => wonder.pieceId), pick.wonderPieceId)
    const buildingId = stillThere(buildings.map((building) => building.pieceId), pick.buildingPieceId)
    const wonder = wonders.find((candidate) => candidate.pieceId === wonderId)
    const building = buildings.find((candidate) => candidate.pieceId === buildingId)
    const ready = obsolete ? wonder !== undefined : building !== undefined
    return (
      <span className="assisted-any-pick" role="group" aria-label={`${label}: resources, mode and target`}>
        {resources.map((resource, index) => (
          <select
            key={index}
            aria-label={`Resource ${index + 1}`}
            value={resource}
            onChange={(event) => setPick({ ...pick, resources: resources.map((current, at) => (at === index ? event.target.value : current)) })}
          >
            {ANY_RESOURCES.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        ))}
        <span className="muted">Tokens you hold pay for any you lack; culture cards only if tokens run out.</span>
        <label>
          <input type="radio" name={radioName} checked={obsolete} onChange={() => setPick({ ...pick, mode: 'obsolete' })} /> Obsolete an ancient or medieval wonder
        </label>
        <label>
          <input type="radio" name={radioName} checked={!obsolete} onChange={() => setPick({ ...pick, mode: 'destroy' })} /> Destroy a building
        </label>
        {obsolete ? (
          <>
            <select aria-label="Wonder" value={wonderId} onChange={(event) => setPick({ ...pick, wonderPieceId: event.target.value })}>
              {wonders.map((candidate) => (
                <option key={candidate.pieceId} value={candidate.pieceId}>
                  {candidate.label} ({candidate.ownerUsername})
                </option>
              ))}
            </select>
            {wonders.length === 0 && <span role="status" className="assisted-warning">No ancient or medieval wonder is owned by a player, so there is none to obsolete.</span>}
          </>
        ) : (
          <>
            <select aria-label="Building" value={buildingId} onChange={(event) => setPick({ ...pick, buildingPieceId: event.target.value })}>
              {buildings.map((candidate) => (
                <option key={candidate.pieceId} value={candidate.pieceId}>
                  {candidate.label} on {candidate.square} ({candidate.ownerUsername === null ? 'no single owner' : `${candidate.ownerUsername}'s outskirts`})
                </option>
              ))}
            </select>
            {buildings.length === 0 && <span role="status" className="assisted-warning">No building stands on the map, so there is none to destroy.</span>}
          </>
        )}
        <span className="muted">
          {obsolete
            ? 'The wonder is marked disabled on the owner list: its owner is cleared and the piece stays, crossed out.'
            : 'The building is removed from the board. Only the undo vote puts it back.'}
        </span>
        <button
          type="button"
          className="small"
          disabled={!canSubmit || !ready}
          onClick={() => send({ resources, ...(obsolete ? { mode: 'obsolete', wonderPieceId: wonderId } : { mode: 'destroy', buildingPieceId: buildingId }) })}
        >
          {obsolete ? `Obsolete ${wonder?.label ?? 'a wonder'}` : `Destroy ${building === undefined ? 'a building' : `${building.label} on ${building.square}`}`} (pay {listOf(resources)})
        </button>
        {cancel}
      </span>
    )
  }

  if (pick.kind === 'city') {
    const cities = view.you?.cities ?? []
    const cityId = stillThere(cities.map((city) => city.pieceId), pick.cityPieceId)
    return (
      <span className="assisted-any-pick" role="group" aria-label={`City for ${label}`}>
        <select aria-label="City" value={cityId} onChange={(event) => setPick({ kind: 'city', cityPieceId: event.target.value })}>
          {cities.map((city) => (
            <option key={city.pieceId} value={city.pieceId}>
              {city.label} (production {city.estimate})
            </option>
          ))}
        </select>
        <span className="muted">The Wheat is paid from a token first, then a culture card. The bonus lasts this turn.</span>
        <button type="button" className="small" disabled={!canSubmit || cityId === ''} onClick={() => send({ cityPieceId: cityId })}>
          Boost {cities.find((city) => city.pieceId === cityId)?.label ?? 'this city'}
        </button>
        {cancel}
      </span>
    )
  }

  if (pick.kind === 'player') {
    const targetId = stillThere(playerIds, pick.targetId)
    const target = opponents.find((opponent) => opponent.playerId === targetId)
    const note = picker?.kind === 'player' ? picker.noteLabel : undefined
    return (
      <span className="assisted-any-pick" role="group" aria-label={`Player for ${label}`}>
        {playerSelect(targetId, (id) => setPick({ ...pick, targetId: id }))}
        {note !== undefined && (
          <input
            type="text"
            aria-label={note}
            placeholder={note}
            maxLength={80}
            value={pick.note}
            onChange={(event) => setPick({ ...pick, note: event.target.value })}
          />
        )}
        <button
          type="button"
          className="small"
          disabled={!canSubmit || target === undefined}
          onClick={() => send({ targetId, ...(pick.note.trim() === '' ? {} : { note: pick.note.trim() }) })}
        >
          Use {label} on {target?.username ?? 'a player'}
        </button>
        {cancel}
      </span>
    )
  }

  if (pick.kind === 'coin') {
    const targetId = stillThere(playerIds, pick.targetId)
    const target = opponents.find((opponent) => opponent.playerId === targetId)
    const counters = target === undefined ? [] : coinCountersOf(target)
    const sourceKey = stillThere(counters.map((counter) => counter.key), pick.source)
    const chosen = counters.find((counter) => counter.key === sourceKey)
    return (
      <span className="assisted-any-pick" role="group" aria-label={`Coin to discard with ${label}`}>
        {playerSelect(
          targetId,
          (id) => {
            const next = opponents.find((opponent) => opponent.playerId === id)
            setPick({ kind: 'coin', targetId: id, source: (next === undefined ? undefined : coinCountersOf(next)[0])?.key ?? '' })
          },
          (opponent) => `${coinCountersOf(opponent).reduce((total, counter) => total + counter.coins, 0)} coin tokens`,
        )}
        <select aria-label="Coin counter" value={sourceKey} onChange={(event) => setPick({ ...pick, source: event.target.value })}>
          {counters.map((counter) => (
            <option key={counter.key} value={counter.key}>
              {counter.label} ({counter.coins})
            </option>
          ))}
        </select>
        {counters.length === 0 && <span role="status" className="assisted-warning">{target?.username ?? 'That player'} holds no coin token.</span>}
        <button
          type="button"
          className="small"
          disabled={!canSubmit || chosen === undefined}
          onClick={() => send({ targetId, source: sourceKey })}
        >
          Discard a coin from {chosen?.label ?? 'a counter'}
        </button>
        {cancel}
      </span>
    )
  }

  if (pick.kind === 'arenaUnit') {
    const units = ownArenaUnits(view)
    const unitId = stillThere(units.map((unit) => unit.id), pick.arenaUnitId)
    const chosen = units.find((unit) => unit.id === unitId)
    return (
      <span className="assisted-any-pick" role="group" aria-label={`Unit for ${label}`}>
        <select aria-label="Unit" value={unitId} onChange={(event) => setPick({ kind: 'arenaUnit', arenaUnitId: event.target.value })}>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {itemName(unit.unit)} (front {unit.position + 1}, attack {unit.attack})
            </option>
          ))}
        </select>
        <span className="muted">Adds 3 to the attack shown on the unit. The Iron is paid from a token first.</span>
        <button type="button" className="small" disabled={!canSubmit || chosen === undefined} onClick={() => send({ arenaUnitId: unitId })}>
          Add 3 attack to {chosen === undefined ? 'a unit' : itemName(chosen.unit)}
        </button>
        {cancel}
      </span>
    )
  }

  if (pick.kind === 'atomic') {
    const targets = nukeTargetsInView(view)
    const nuke = pick.mode === 'nuke'
    // Never preselect the player's own city: the default is another player's city, and with only their own the player picks one
    const nukeId = targets.some((candidate) => candidate.pieceId === pick.cityPieceId)
      ? pick.cityPieceId
      : (targets.find((candidate) => !candidate.own)?.pieceId ?? '')
    const target = targets.find((candidate) => candidate.pieceId === nukeId)
    return (
      <span className="assisted-any-pick" role="group" aria-label={`Mode for ${label}`}>
        <label>
          <input type="radio" name={radioName} checked={!nuke} onChange={() => setPick({ ...pick, mode: 'extraActions' })} /> An extra action with each city (City Management)
        </label>
        <label>
          <input type="radio" name={radioName} checked={nuke} onChange={() => setPick({ ...pick, mode: 'nuke' })} /> Nuke a city (Movement)
        </label>
        {nuke && (
          <>
            <select aria-label="City to nuke" value={nukeId} onChange={(event) => setPick({ ...pick, cityPieceId: event.target.value })}>
              {nukeId === '' && targets.length > 0 && <option value="">Choose a city</option>}
              {targets.map((candidate) => (
                <option key={candidate.pieceId} value={candidate.pieceId}>
                  {candidate.label} of {candidate.ownerUsername}{candidate.own ? ' (yours)' : ''}
                </option>
              ))}
            </select>
            {targets.length === 0 && <span role="status" className="assisted-warning">No city that is not a capital stands on the map.</span>}
            {target !== undefined && (
              <span className="muted">
                Destroys the city{target.destroyed.length === 0 ? '' : ` with ${target.destroyed.map((item) => `${item.label}${item.square === null ? '' : ` (${item.square})`}`).join(', ')}`}. Only the undo vote brings it back.
              </span>
            )}
          </>
        )}
        <button
          type="button"
          className="small"
          disabled={!canSubmit || (nuke && target === undefined)}
          onClick={() => {
            if (!nuke) return send({ mode: 'extraActions' })
            if (target !== undefined && window.confirm(`Nuke ${target.label} of ${target.ownerUsername}${target.own ? ' (your own city)' : ''}? The city and everything in its outskirts is destroyed, whoever owns it.`)) {
              send({ mode: 'nuke', cityPieceId: target.pieceId })
            }
          }}
        >
          {nuke ? `Nuke ${target?.label ?? 'a city'}` : 'Allow an extra action with each city'}
        </button>
        {cancel}
      </span>
    )
  }

  if (pick.kind === 'monarchy') {
    const targetId = stillThere(playerIds, pick.targetId)
    const target = opponents.find((opponent) => opponent.playerId === targetId)
    // No unit is killed while a battle is on (the game refuses it); the mode falls back to obsolete, which is not limited
    const battleOn = view.battle != null
    const kill = pick.mode === 'kill' && !battleOn
    const wonders = obsoletableWondersInView(view)
    // The selection follows the view: a wonder that is gone is replaced by the first one left, and with none nothing is chosen
    const wonderId = stillThere(wonders.map((wonder) => wonder.pieceId), pick.wonderPieceId)
    const wonder = wonders.find((candidate) => candidate.pieceId === wonderId)
    return (
      <span className="assisted-any-pick" role="group" aria-label={`Mode for ${label}`}>
        <label>
          <input type="radio" name={radioName} checked={!kill} onChange={() => setPick({ ...pick, mode: 'obsolete' })} /> Obsolete an ancient wonder
        </label>
        <label>
          <input type="radio" name={radioName} checked={kill} disabled={battleOn} onChange={() => setPick({ ...pick, mode: 'kill' })} /> Kill a random unit{battleOn ? ' (not while a battle is on)' : ''}
        </label>
        {!kill && (
          <>
            <select aria-label="Wonder" value={wonderId} onChange={(event) => setPick({ ...pick, wonderPieceId: event.target.value })}>
              {wonders.map((candidate) => (
                <option key={candidate.pieceId} value={candidate.pieceId}>
                  {candidate.label} ({candidate.ownerUsername})
                </option>
              ))}
            </select>
            {wonders.length === 0 && <span role="status" className="assisted-warning">No ancient wonder is owned by a player, so there is none to obsolete.</span>}
          </>
        )}
        {kill && playerSelect(targetId, (id) => setPick({ ...pick, targetId: id }), (opponent) => `${opponent.publicHand.units} units in hand`)}
        <span className="muted">
          {kill
            ? 'A random unit card is taken from that player\'s hand and discarded. The game refuses if they hold none.'
            : 'The wonder is marked disabled on the owner list: its owner is cleared and the piece stays, crossed out.'}
        </span>
        <button
          type="button"
          className="small"
          disabled={!canSubmit || (kill ? target === undefined : wonder === undefined)}
          onClick={() => send(kill ? { mode: 'kill', targetId } : { mode: 'obsolete', wonderPieceId: wonderId })}
        >
          {kill ? `Kill a unit of ${target?.username ?? 'a player'}` : `Obsolete ${wonder?.label ?? 'a wonder'}`}
        </button>
        {cancel}
      </span>
    )
  }

  return <></>
}

interface ButtonProps {
  readonly action: AssistedActionKind
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** `full` shows the status tag; a tight table cell uses `blocked`. */
  readonly detail?: 'full' | 'blocked'
  /**
   * `help` keeps the reason behind the `?`; `inline` shows it as text, for a
   * dialog that already is the card reference (no second modal on top).
   */
  readonly reasonPlacement?: 'help' | 'inline'
  readonly className?: string
  /** Replaces the default "Use <label>" text. */
  readonly children?: ReactNode
  /** Called after a press that went through, once the page has the fresh view. */
  readonly onDone?: (() => void) | undefined
  /** Called before an action that opens the board picker, so a dialog can close first. */
  readonly onBeforePress?: (() => void) | undefined
}

/** What a resource list looks like in a button: "Iron", "Iron and Wheat", "Iron, Wheat and Silk". */
const listOf = (names: readonly string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

/** The kinds a fallback pick is filled from, in the order the card texts list the resources. */
const FALLBACK_KINDS: readonly string[] = ['Iron', 'Wheat', 'Silk', 'Incense', 'Spy', 'Uranium']

/**
 * The resources a picker starts on: the tokens the player holds (a hut in the hand or a resource piece in their own
 * area), so the default pays with tokens, in the order held. The engine pays any other
 * token before it would play a culture card, so this is only a convenience; what is missing is filled from the kinds
 * not picked yet (Iron, Wheat, ...).
 */
function defaultResourcePick(view: PlayerView, count: number): readonly string[] {
  const viewer = view.you
  const name = (raw: string): string | undefined => ANY_RESOURCES.find((resource) => resource.toLowerCase() === raw.toLowerCase())
  const held: string[] = []
  if (viewer !== null) {
    const huts = viewer.items.flatMap((item) => (item.kind === 'hut' && !item.used ? [name(item.name)] : []))
    const own = view.boardAreas.find((area) => area.playerId === viewer.playerId)
    const pieces =
      own === undefined
        ? []
        : view.board.pieces.flatMap((piece) => {
            const x = piece.x + piece.width / 2
            const y = piece.y + piece.height / 2
            const inside = x >= own.x && x < own.x + own.width && y >= own.y && y < own.y + own.height
            return piece.category === 'resource' && inside ? [name(piece.assetId.replace('resources/', ''))] : []
          })
    for (const resource of [...huts, ...pieces]) {
      if (resource !== undefined && held.length < count) held.push(resource)
    }
  }
  const picked = [...held]
  while (picked.length < count) {
    picked.push(FALLBACK_KINDS.find((kind) => !picked.includes(kind)) ?? 'Iron')
  }
  return picked
}

/**
 * What the player is asked before a card that was used this turn is used again.
 * Some Great Persons and culture cards allow it and are not built, so the player
 * is the override, the way the Draw button asks first when it is not your turn.
 */
export const usedAgainQuestion = (label: string): string =>
  `You have already used ${label} this turn. The rules allow it once per turn. Use it again?`

/**
 * One button for one assisted action. Renders nothing for a spectator or when
 * the viewer has no state for the action. Disabled unless the status is `ready`
 * or it is `used` and repeatable; the reason is in the button's title and behind
 * its `?` help, not on the page. A repeatable `used` card stays pressable: a
 * press asks first and sends `confirmedRepeat` only after a yes. A rule that
 * allows the action once and gives no second use (a social policy or a wonder)
 * leaves its used button disabled instead.
 */
export function AssistedActionButton({
  action,
  gameId,
  view,
  busy,
  readOnly,
  run,
  detail = 'full',
  reasonPlacement = 'help',
  className = 'small',
  children,
  onDone,
  onBeforePress,
}: ButtonProps): React.JSX.Element | null {
  const state = view.you?.availableActions?.find((candidate) => candidate.action === action)
  const mapPicker = useMapPicker()
  const [hint, setHint] = useState<string | null>(null)
  // The tech abilities that ask something first (`ASSISTED_TECH_PICKERS`): what the player has picked so far, or `null` while the picker is closed
  const [pick, setPick] = useState<TechPick | null>(null)
  // Combustion: whether the army picker is open. The armies it offers are worked out from the current view on every render, so the
  // square and building a button names are what the engine will work out for that army when it is pressed
  const [armyPickOpen, setArmyPickOpen] = useState(false)
  if (view.you === null || state === undefined) return null
  const NO_ARMY_TARGET = 'None of your armies stands on a building of another player or outside every city, or on another player\'s walled city.'
  // The map in the projection carries every city and building; the owner of a building is read from the cities' outskirts
  const armyTargets: readonly CombustionTarget[] = armyPickOpen ? combustionTargets({ board: view.board, players: [] }, view.you) : []

  const ready = state.status === 'ready'
  const used = state.status === 'used'
  // Shakespeare's skip is a choice during the normal advance, not a second button.
  // It can be the only legal move when the normal landing is blocked.
  const skip =
    action === 'cultureAdvance'
      ? view.you.availableActions?.find(
          (candidate) => candidate.action === 'cultureAdvanceSkip' && candidate.status === 'ready',
        )
      : undefined
  // A used action is pressable only when its rule allows the player to confirm
  // another use; a strict-once policy or wonder stays disabled. A projection
  // without the flag predates it and keeps the old repeat behaviour.
  const pressable = ready || skip !== undefined || (used && state.repeatable !== false)
  const shownReason = !ready && skip !== undefined ? skip.reason : state.reason
  const shownStatus = !ready && skip !== undefined ? 'ready' : state.status
  const warning = ready ? state.warning : skip?.warning
  const rev = view.rev
  const playerId = view.you.playerId

  const pressCommunism = async (): Promise<void> => {
    if (mapPicker === null) return
    if (used && !window.confirm(usedAgainQuestion(state.label))) return
    onBeforePress?.()
    const cells: { column: number; row: number; label: string }[] = []
    for (let row = 0; row < view.board.rows; row += 1) {
      for (let column = 0; column < view.board.columns; column += 1) {
        if (isMapCell(view.board, column, row)) {
          cells.push({ column, row, label: squareLabel({ column, row }) })
        }
      }
    }
    const picked = await mapPicker.begin({
      title: 'the Communism square',
      cells,
      describeCell: (cell) => `Lock ${cell.label} with Communism`,
    })
    if (picked === null) return
    const square = { column: picked.column, row: picked.row }
    const key = `${gameId}:${playerId}:communism:${square.column},${square.row}`
    if (inFlight.has(key)) return
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'communism', requestId, rev, { square }, used),
      view,
    ).then((done) => {
      if (done) onDone?.()
    })
  }

  const pressSteamPower = async (): Promise<void> => {
    if (mapPicker === null || view.you === null) return
    const viewer = view.you
    if (used && !window.confirm(usedAgainQuestion(state.label))) return
    const turnNumber = view.activeTurn?.turnNumber ?? 0
    const locked = (cell: { column: number; row: number }): boolean =>
      view.communismLocks.some((square) => square.column === cell.column && square.row === cell.row)
    const sources = steamPowerSources(view.board, viewer, turnNumber)
      .filter((cell) => !locked(cell))
      .map((cell) => ({ ...cell, label: squareLabel(cell) }))
    if (sources.length === 0) {
      setHint('None of your figures can be moved: they are on no map square, locked by Communism, or already moved by Galileo or Steam Power.')
      return
    }
    setHint(null)
    onBeforePress?.()
    const from = await mapPicker.begin({
      title: 'the Steam Power source square',
      cells: sources,
      describeCell: (cell) => `Move all your figures on ${cell.label} with Steam Power`,
    })
    if (from === null) return
    const figures = steamPowerFiguresAt(view.board, viewer, from, turnNumber)
    const forbidden = brandenburgForbiddenCells(view.brandenburgZones, viewer.playerId)
    const destinations = steamPowerDestinations(view.board, viewer, viewer.stackingLimit, figures, from, forbidden)
    const occupancy = occupancyOf(view.board, viewer)
    if (destinations.length === 0) {
      setHint('There is no water square these figures may be moved to.')
      return
    }
    const to = await mapPicker.begin({
      title: 'the Steam Power water square',
      cells: destinations.map((cell) => ({
        ...cell,
        ...(occupancy.foreign.has(`${cell.column},${cell.row}`)
          ? { note: 'Another player\'s figure stands here. Armies fight there; settle any battle and loot by hand.' }
          : {}),
      })),
      describeCell: (cell) => `Move your figures to ${cell.label}`,
    })
    if (to === null) return
    const count = `${figures.length} ${figures.length === 1 ? 'figure' : 'figures'}`
    const sameSquare = to.column === from.column && to.row === from.row
    if (
      !window.confirm(
        sameSquare
          ? `Lock ${count} on ${squareLabel(from)} with Steam Power (spends a Silk)?`
          : `Move ${count} from ${squareLabel(from)} to ${squareLabel(to)} with Steam Power (spends a Silk)?`,
      )
    ) {
      return
    }
    const source = { column: from.column, row: from.row }
    const target = { column: to.column, row: to.row }
    const key = `${gameId}:${playerId}:steamPower:${source.column},${source.row}:${target.column},${target.row}`
    if (inFlight.has(key)) return
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'steamPower', requestId, rev, { from: source, to: target }, used),
      view,
    ).then((done) => {
      if (done) onDone?.()
    })
  }

  // The two pickers submit later than the button that opened them, so they carry the button's own guard
  // (busy, read-only, still pressable), and a repeat use is confirmed when they submit, against the state then
  const canSubmit = !busy && !readOnly && pressable

  const pressCombustion = (): void => {
    if (view.you === null) return
    if (combustionTargets({ board: view.board, players: [] }, view.you).length === 0) {
      setHint(NO_ARMY_TARGET)
      return
    }
    setHint(null)
    setArmyPickOpen(true)
  }

  const burnWith = (target: CombustionTarget): void => {
    if (!canSubmit) return
    const key = `${gameId}:${playerId}:combustion:${target.pieceId}`
    if (inFlight.has(key)) return
    // Cancelling the question keeps the picker open
    if (used && !window.confirm(usedAgainQuestion(state.label))) return
    setArmyPickOpen(false)
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, 'combustion', requestId, rev, { pieceId: target.pieceId }, used),
      view,
    ).then((done) => {
      if (done) onDone?.()
    })
  }

  // One submit for every picker: the same guard as the button, a repeat use is confirmed now and not when the picker
  // opened, and declining keeps the picker open
  const sendPick = (args: Record<string, unknown>): void => {
    if (!canSubmit) return
    const key = `${gameId}:${playerId}:${action}:${JSON.stringify(args)}`
    if (inFlight.has(key)) return
    if (used && !window.confirm(usedAgainQuestion(state.label))) return
    setPick(null)
    void pressOnce(
      key,
      run,
      (requestId) => api.actionWithArgs(gameId, action, requestId, rev, args, used),
      view,
    ).then((done) => {
      if (done) onDone?.()
    })
  }

  const openPicker = (picker: TechPicker): void => {
    const opponents = view.opponents ?? []
    setHint(null)
    switch (picker.kind) {
      case 'resources':
        setPick({ kind: 'resources', resources: defaultResourcePick(view, picker.count) })
        return
      case 'gunpowder': {
        const wonder = obsoletableWondersInView(view, ['Ancient', 'Medieval'])[0]
        setPick({
          kind: 'gunpowder',
          resources: defaultResourcePick(view, 2),
          mode: wonder === undefined ? 'destroy' : 'obsolete',
          wonderPieceId: wonder?.pieceId ?? '',
          buildingPieceId: destroyableBuildingsInView(view)[0]?.pieceId ?? '',
        })
        return
      }
      case 'city': {
        const city = view.you?.cities?.[0]
        if (city === undefined) {
          setHint('You have no city on the map to give production to.')
          return
        }
        setPick({ kind: 'city', cityPieceId: city.pieceId })
        return
      }
      case 'player': {
        const first = opponents[0]
        if (first === undefined) {
          setHint('There is no other player.')
          return
        }
        setPick({ kind: 'player', targetId: first.playerId, note: '' })
        return
      }
      case 'coin': {
        const target = opponents.find((opponent) => coinCountersOf(opponent).length > 0)
        if (target === undefined) {
          setHint('No opponent holds a coin token.')
          return
        }
        setPick({ kind: 'coin', targetId: target.playerId, source: coinCountersOf(target)[0]?.key ?? '' })
        return
      }
      case 'arenaUnit': {
        const unit = ownArenaUnits(view)[0]
        if (unit === undefined) {
          setHint('You have no living unit of your own in the arena.')
          return
        }
        setPick({ kind: 'arenaUnit', arenaUnitId: unit.id })
        return
      }
      case 'atomic': {
        // The mode of the phase the player has open, so a quick press is not refused
        const phase = endTurnState(view)
        setPick({ kind: 'atomic', mode: phase?.kind === 'open' && phase.phase === 'MOVEMENT' ? 'nuke' : 'extraActions', cityPieceId: nukeTargetsInView(view).find((target) => !target.own)?.pieceId ?? '' })
        return
      }
      case 'monarchy': {
        const target = opponents.find((opponent) => opponent.publicHand.units > 0)
        setPick({ kind: 'monarchy', mode: 'obsolete', targetId: (target ?? opponents[0])?.playerId ?? '', wonderPieceId: obsoletableWondersInView(view)[0]?.pieceId ?? '' })
        return
      }
    }
  }

  const press = (): void => {
    const picker = ASSISTED_TECH_PICKERS.get(action)
    if (picker !== undefined) {
      openPicker(picker)
      return
    }
    if (action === 'combustion') {
      pressCombustion()
      return
    }
    if (action === 'communism') {
      void pressCommunism()
      return
    }
    if (action === 'steamPower') {
      void pressSteamPower()
      return
    }
    let chosen = action
    if (skip !== undefined && !used) {
      const question = `William Shakespeare can skip the occupied culture space(s). ${skip.reason} Skip them?`
      if (window.confirm(question)) chosen = 'cultureAdvanceSkip'
      else if (!ready) return
    }
    const key = `${gameId}:${playerId}:${chosen}`
    if (used) {
      // A press already on its way is the same press: do not ask a second time.
      if (inFlight.has(key)) return
      // Cancelling asks nothing of the server and leaves any kept request id as it is.
      if (!window.confirm(usedAgainQuestion(state.label))) return
    }
    void pressOnce(
      key,
      run,
      (requestId) =>
        used
          ? api.performAction(gameId, chosen, requestId, rev, true)
          : api.performAction(gameId, chosen, requestId, rev),
      view,
    ).then((done) => {
      if (done) onDone?.()
    })
  }

  return (
    <span className="assisted-action">
      <button
        type="button"
        className={className}
        disabled={busy || readOnly || !pressable || ((action === 'communism' || action === 'steamPower') && mapPicker === null)}
        title={shownReason}
        onClick={press}
      >
        {children ?? state.buttonText ?? BUTTON_TEXT[action] ?? `Use ${state.label}`}
      </button>
      {detail === 'full' && <span className="tag">{STATUS_TEXT[shownStatus]}</span>}
      {reasonPlacement === 'inline' ? (
        <span className="muted assisted-reason">{shownReason}</span>
      ) : (
        <HelpHint label={state.label}>{shownReason}</HelpHint>
      )}
      {warning !== undefined && (
        <span role="status" className="assisted-warning">
          {warning}
        </span>
      )}
      {hint !== null && (
        <span role="status" className="assisted-warning">
          {hint}
        </span>
      )}
      {armyPickOpen && (
        <span className="assisted-any-pick" role="group" aria-label="Army that uses Combustion">
          {armyTargets.map((target) => (
            <button key={target.pieceId} type="button" className="small" disabled={!canSubmit} onClick={() => burnWith(target)}>
              Army on {squareLabel(target)}: destroy {target.subject}
            </button>
          ))}
          {armyTargets.length === 0 && <span role="status" className="assisted-warning">{NO_ARMY_TARGET}</span>}
          <button type="button" className="small" onClick={() => setArmyPickOpen(false)}>
            Cancel
          </button>
        </span>
      )}
      {pick !== null && (
        <TechPickerForm
          pick={pick}
          setPick={setPick}
          view={view}
          label={state.label}
          canSubmit={canSubmit}
          picker={ASSISTED_TECH_PICKERS.get(action)}
          send={sendPick}
        />
      )}
    </span>
  )
}

interface PanelProps {
  readonly gameId: string
  readonly view: PlayerView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** The Build flow GameView shares with the board. Without it the city cards have no Build button. */
  readonly build?: BuildFlow | undefined
}

/**
 * Whether "Your actions" is on the page: the viewer has an action for a card they
 * hold, a card choice waiting, a city on the map, or a turn to end (a player in a
 * game that is running). Never for a spectator. The game page asks too, so the
 * Actions shortcut is not a dead button.
 */
export function hasActionsPanel(view: PlayerView): boolean {
  return (
    endTurnState(view) !== null ||
    (view.you?.availableActions ?? []).some((candidate) => candidate.status !== 'not-owned') ||
    (view.you?.pendingRewards?.length ?? 0) > 0 ||
    (view.you?.cities?.length ?? 0) > 0
  )
}

/**
 * The buttons of one phase, grouped under the heading each action names. Actions for
 * a card the player does not hold are left out, so the list stays short; so are blocked
 * ones, except the culture advance, which stays disabled with its reason. `'ANY'`
 * actions are listed in every phase. `onDone` runs after a press that went through, with
 * the action that was pressed.
 */
export function AssistedActionGroups({
  gameId,
  view,
  busy,
  readOnly,
  run,
  phase,
  onDone,
}: PanelProps & {
  readonly phase: TurnPhase
  readonly onDone?: ((action: AssistedActionKind) => void) | undefined
}): React.JSX.Element | null {
  const actions = (view.you?.availableActions ?? []).filter(
    (candidate) =>
      candidate.action !== 'cultureAdvanceSkip' &&
      (candidate.status === 'ready' ||
        candidate.status === 'used' ||
        // The culture advance stays on the list when it is blocked, so the player sees
        // it and the reason behind its `?` instead of wondering where the button went.
        (candidate.action === 'cultureAdvance' && isBlockedHere(candidate.status))) &&
      (candidate.phase === phase || candidate.phase === 'ANY'),
  )
  if (view.you === null || actions.length === 0) return null
  const groups = [...new Set(actions.map((candidate) => candidate.group))]
  return (
    <section className="assisted-possible" aria-label="Possible actions">
      <h3 className="assisted-possible-title">Possible actions</h3>
      <div className="assisted-possible-box">
        {groups.map((group) => (
          <section key={group} className="phase-group" aria-label={group}>
            <h4 className="phase-group-title">{group}</h4>
            <ul className="assisted-actions">
              {actions
                .filter((candidate) => candidate.group === group)
                .map((candidate) => {
                  const link = cardLinkOf(candidate, view)
                  const title = link === undefined ? undefined : `Show ${candidate.label} in ${link.where}`
                  return (
                    <li key={candidate.action}>
                      {/* A button with its own text (Advance culture) names the row itself. */}
                      {BUTTON_TEXT[candidate.action] === undefined && candidate.buttonText === undefined && (
                        link === undefined ? (
                          <span className="assisted-name">{candidate.label}</span>
                        ) : (
                          <button
                            type="button"
                            className="link assisted-name"
                            title={title}
                            aria-label={title}
                            onClick={link.go}
                          >
                            {candidate.label}
                          </button>
                        )
                      )}
                      <AssistedActionButton
                        action={candidate.action}
                        gameId={gameId}
                        view={view}
                        busy={busy}
                        readOnly={readOnly}
                        run={run}
                        onDone={onDone === undefined ? undefined : () => onDone(candidate.action)}
                      />
                    </li>
                  )
                })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}

/**
 * The card choice waiting after a culture advance. It is shown above the phase tabs,
 * whichever tab is open, because a choice that is hidden behind a tab is a choice a
 * player forgets. Nothing when no choice is waiting.
 */
export function PendingRewardSection({
  gameId,
  view,
  busy,
  readOnly,
  run,
  onKept,
}: PanelProps & { readonly onKept: () => void }): React.JSX.Element | null {
  const pending = view.you?.pendingRewards?.[0]
  if (view.you === null || pending === undefined) return null
  return (
    <RewardChoice
      gameId={gameId}
      playerId={view.you.playerId}
      rev={view.rev}
      reward={pending}
      busy={busy}
      readOnly={readOnly}
      run={run}
      onKept={onKept}
    />
  )
}

interface RewardChoiceProps {
  readonly gameId: string
  readonly playerId: string
  readonly rev: number
  readonly reward: PendingRewardView
  readonly busy: boolean
  readonly readOnly: boolean
  readonly run: Run
  /** Called after a successful choice, when this section is about to go away. */
  readonly onKept: () => void
}

/**
 * The card choice from a culture advance. The candidates come from the
 * projection, so a refresh shows the same cards and nothing is drawn again. One
 * press keeps one card; the engine discards the rest. The id is kept per reward
 * and card, so a retry of the same press is safe and another card, after the
 * server refused the first, is a new press.
 */
function RewardChoice({
  gameId,
  playerId,
  rev,
  reward,
  busy,
  readOnly,
  run,
  onKept,
}: RewardChoiceProps): React.JSX.Element {
  const [sending, setSending] = useState(false)
  const keep = (itemId: string): void => {
    // One choice at a time for the whole reward: a click on another card while the
    // first is in flight must not send a second request.
    const rewardKey = `${gameId}:${playerId}:chooseReward:${reward.id}`
    if (inFlight.has(rewardKey)) return
    inFlight.add(rewardKey)
    setSending(true)
    // The id is kept per reward and card: after a definitive refusal a different
    // card is a new press, while the same card retried after a lost response is not.
    const settle = (): void => {
      inFlight.delete(rewardKey)
      setSending(false)
    }
    pressOnce(`${rewardKey}:${itemId}`, run, (requestId) =>
      api.chooseReward(gameId, reward.id, itemId, requestId, rev),
    ).then((kept) => {
      settle()
      if (kept) onKept()
    }, settle)
  }
  const disabled = busy || readOnly || sending
  return (
    <section className="assisted-reward" aria-labelledby={`reward-${reward.id}`}>
      <h3 id={`reward-${reward.id}`} className="assisted-reward-title">
        Choose a card to keep
      </h3>
      <p className="muted">
        Keep one of these cards. The other cards are discarded.
        {reward.kind === 'greatPerson' &&
          ' Keeping a card also puts its marker next to your civilization sheet. Drag it onto the map when you place it.'}
      </p>
      <ul className="card-grid small assisted-reward-cards">
        {(reward.candidates ?? []).map((item) => (
          <ItemCard key={item.id} item={item}>
            <button
              type="button"
              className="small"
              disabled={disabled}
              aria-label={`Keep this card: ${itemName(item)}`}
              onClick={() => keep(item.id)}
            >
              Keep this card
            </button>
          </ItemCard>
        ))}
      </ul>
    </section>
  )
}
