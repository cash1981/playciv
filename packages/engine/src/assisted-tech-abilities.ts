/**
 * The resource abilities of the techs that are not in the unit slice (issue #327, slice 2): the production boosts of
 * Animal Husbandry, Construction, Banking and Plastics (Wheat), Pottery (Any 2), Philosophy (Any 3), Education (four
 * different resources), Horseback Riding (Silk, Trade), Mysticism (Spy), the cancelling Spy abilities of Writing,
 * Civil Service and Mass Media, and Monarchy (Silk).
 *
 * They share one shape, so one factory ({@link techAbility}) builds them: the tech must be revealed, the phase open, the
 * card unused this turn (a confirmed repeat lifts only that), the payload is read and checked BEFORE anything is paid
 * (a refusal spends nothing), the resources are paid through the shared layer (`assisted-resources.ts`: a token first,
 * culture cards only for what tokens cannot cover) and the ability then does its own part. An undo takes the part back
 * or refuses with a reason, then returns exactly what was paid.
 *
 * What the game does not do: it never blocks the thing a cancel names (there is no pending action to stop; the other
 * player undoes it or corrects it by hand), and it does not track wonder obsolescence.
 */

import { anyGreatPersonMarkerLeft } from './great-person-effects.js'
import {
  gainGreatPerson,
  markerUndoBlock,
  removeGreatPersonMarker,
  removedMarkerText,
  restoreDrawnCards,
  countLinesIn,
} from './assisted-culture.js'
import { discardedName } from './gustavus.js'
import {
  ANY_RESOURCES,
  anyResourceName,
  anyResourcesAvailability,
  distinctResourcesAvailability,
  joinList,
  resourceAvailability,
  returnedText,
  returnResources,
  spendAnyResources,
  spendDistinctResources,
  spendResource,
} from './assisted-resources.js'
import {
  PHASE_REASON,
  REPEAT_NOTE,
  blocked,
  grantUndoBlock,
  lastLogId,
  openCityManagementTurn,
  playerOf,
  rejected,
  techBlock,
  useTurnAction,
  usedReason,
  withPlayerHand,
} from './assisted-core.js'
import type { ApplyContext, AssistedActionDefinition, AssistedAvailability, BlockedAvailability } from './assisted-core.js'
import { blockadedPieceIds } from './blockade.js'
import { activeWonderOwnerIds, coinSourcesOf, findCoinSource, totalCoins, withCoinSource } from './coins.js'
import type { CoinSourceKey } from './coins.js'
import { cityProductionsOf } from './city-production.js'
import type { EngineError } from './errors.js'
import { isUnit, itemName } from './item.js'
import type { UnitItem } from './item.js'
import { tradeCeilingOf } from './limits.js'
import { appendLog } from './log.js'
import { nextInt } from './random.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import { INVESTABLE_COIN_SOURCES, openPhaseOf } from './sot.js'
import type {
  AssistedActionKind,
  AssistedActionRecord,
  GameState,
  Playerhand,
  SpentResource,
  TechAbilityEffect,
  TechGrant,
} from './state.js'
import { createPlayerTurn, turnStatus } from './turn.js'
import type { PlayerTurn } from './turn.js'

const GROUP = 'Resource abilities'
const TRADE_REASON = 'Only available during your open Trade phase.'

type Payload = Readonly<Record<string, unknown>>
type EffectKind = TechAbilityEffect['kind']
type EffectOf<K extends EffectKind> = Extract<TechAbilityEffect, { readonly kind: K }>

type Payment =
  | { readonly kind: 'one'; readonly resource: string }
  /** `count` resource tokens of the player's own choosing (Gunpowder's rule). */
  | { readonly kind: 'any'; readonly count: number }
  /** `count` resource tokens of different kinds. */
  | { readonly kind: 'distinct'; readonly count: number }

/** What the ability did to the state besides the payment. */
interface Acted<E> {
  readonly state: GameState
  /** The end of the public line, with its own separator: ", so Capital D5 produces 3 more this turn". */
  readonly said: string
  readonly effect: E
  /** Lines only the player reads (a drawn card named). */
  readonly privateLines?: readonly string[]
  /** Board history entries to count into the public line, as a culture advance does for its marker. */
  readonly historyIds?: readonly (string | undefined)[]
}

interface TechAbility<K extends EffectKind, Plan> {
  readonly kind: AssistedActionKind
  readonly techName: string
  /** Which effect record the action writes. */
  readonly effectKind: K
  readonly phase: 'CM' | 'TRADE' | 'ANY'
  readonly buttonText?: string
  readonly payment: Payment
  /** Refusals that do not depend on what the player chose; used by the availability and checked again on apply. */
  block?(state: GameState, player: Playerhand): BlockedAvailability | undefined
  /** Reads and checks the payload before anything is paid. The sentence is the reason for a refusal. */
  plan(state: GameState, player: Playerhand, payload: Payload): Result<Plan, string>
  /** Does the part that is not the payment, on the state after paying. */
  act(
    state: GameState,
    player: Playerhand,
    plan: Plan,
    spent: readonly SpentResource[],
    context: ApplyContext,
  ): Result<Acted<EffectOf<K>>, string>
  /** Takes it back, or says why it cannot be. `said` ends the undo line ("and the extra production was taken off"). */
  undo(
    state: GameState,
    player: Playerhand,
    effect: EffectOf<K>,
    record: AssistedActionRecord,
    at: string | null,
  ): Result<{ readonly state: GameState; readonly said: string }, string>
}

const usageKeyOf = (techName: string): string => `card:${techName}`

function currentTurnOf(state: GameState, player: Playerhand): PlayerTurn {
  const turnNumber = turnStatus(state).currentTurn
  return player.playerTurns.find((turn) => turn.turnNumber === turnNumber) ?? createPlayerTurn(player.username, turnNumber)
}

/** The turn record while the phase the ability needs is open, `undefined` otherwise. */
function turnFor(state: GameState, player: Playerhand, phase: 'CM' | 'TRADE' | 'ANY'): PlayerTurn | undefined {
  if (phase === 'CM') return openCityManagementTurn(state, player)
  if (phase === 'TRADE') return openPhaseOf(state, player.playerId) === 'TRADE' ? currentTurnOf(state, player) : undefined
  return currentTurnOf(state, player)
}

const phaseReason = (phase: 'CM' | 'TRADE' | 'ANY'): string => (phase === 'TRADE' ? TRADE_REASON : PHASE_REASON)

/** The other player a payload names, or the reason there is none. */
function otherPlayer(state: GameState, player: Playerhand, payload: Payload): Result<Playerhand, string> {
  const id = payload['targetId']
  if (typeof id !== 'string' || id === '') return err('Choose another player.')
  if (id === player.playerId) return err('Choose another player, not yourself.')
  const target = playerOf(state, id)
  return target === undefined ? err('That player is not in this game.') : ok(target)
}

/** The resource names a payment takes from the payload: exactly `count`, known, and different for `distinct`. */
function namedResources(payload: Payload, payment: Extract<Payment, { readonly count: number }>): Result<readonly string[], string> {
  const named = payload['resources']
  const asked = `Name exactly ${payment.count} ${payment.kind === 'distinct' ? 'different ' : ''}resources to pay: ${ANY_RESOURCES.join(', ')}.`
  if (!Array.isArray(named) || named.length !== payment.count) return err(asked)
  const names = (named as readonly unknown[]).map(anyResourceName)
  if (names.some((name) => name === undefined)) return err(asked)
  const known = names as readonly string[]
  if (payment.kind === 'distinct' && new Set(known).size !== known.length) return err(asked)
  return ok(known)
}

interface Paid {
  readonly state: GameState
  readonly spent: readonly SpentResource[]
  readonly said: string
}

/** Pays the ability's resources, or says why not: `unavailable` for names that do not fit, `needs-resource` for tokens and cards the player lacks. */
function pay(state: GameState, player: Playerhand, payment: Payment, payload: Payload, at: string | undefined): Result<Paid, BlockedAvailability> {
  if (payment.kind === 'one') {
    const paid = spendResource(state, player.playerId, payment.resource, at)
    return paid.ok
      ? ok({ state: paid.value.state, spent: [paid.value.spent], said: paid.value.said })
      : err(
          blocked(
            'needs-resource',
            `You need ${/^[AEIOU]/.test(payment.resource) && payment.resource !== 'Uranium' ? 'an' : 'a'} ${payment.resource} token, or a culture card that can be played as one.`,
          ),
        )
  }
  const names = namedResources(payload, payment)
  if (!names.ok) return err(blocked('unavailable', names.error))
  const paid =
    payment.kind === 'any'
      ? spendAnyResources(state, player.playerId, names.value, at)
      : spendDistinctResources(state, player.playerId, names.value, undefined, at)
  if (!paid.ok) {
    return err(
      blocked(
        'needs-resource',
        `You cannot pay ${payment.count} ${payment.kind === 'distinct' ? 'different ' : ''}resources: you hold too few resource tokens or culture cards that can be played as ${payment.kind === 'distinct' ? `a ${paid.error.missing}` : 'a resource'}.`,
      ),
    )
  }
  return ok(paid.value)
}

function paymentAvailability(state: GameState, playerId: string, payment: Payment): AssistedAvailability {
  if (payment.kind === 'one') return resourceAvailability(state, playerId, payment.resource)
  return payment.kind === 'any'
    ? anyResourcesAvailability(state, playerId, payment.count)
    : distinctResourcesAvailability(state, playerId, payment.count)
}

function techAbility<K extends EffectKind, Plan>(spec: TechAbility<K, Plan>): AssistedActionDefinition {
  const usageKey = usageKeyOf(spec.techName)
  return {
    kind: spec.kind,
    techName: spec.techName,
    label: spec.techName,
    button: true,
    usageKey,
    phase: spec.phase,
    group: GROUP,
    ...(spec.buttonText === undefined ? {} : { buttonText: spec.buttonText }),

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const tech = techBlock(player, spec.techName)
      if (tech !== undefined) return tech
      const turn = turnFor(state, player, spec.phase)
      if (turn === undefined) return blocked('wrong-phase', phaseReason(spec.phase))
      if (turn.usedActions.includes(usageKey)) return blocked('used', usedReason(spec.techName))
      const stopped = spec.block?.(state, player)
      if (stopped !== undefined) return stopped
      return paymentAvailability(state, playerId, spec.payment)
    },

    apply(state, player, context) {
      const turn = turnFor(state, player, spec.phase)
      if (turn === undefined) return err(rejected(spec.kind, blocked('wrong-phase', phaseReason(spec.phase))))
      const stopped = spec.block?.(state, player)
      if (stopped !== undefined) return err(rejected(spec.kind, stopped))
      const refuse = (status: BlockedAvailability['status'], reason: string): EngineError =>
        rejected(spec.kind, blocked(status, reason))
      const payload: Payload = (context.payload ?? {}) as unknown as Payload

      // Everything is checked before anything is paid, so a refusal spends nothing
      const planned = spec.plan(state, player, payload)
      if (!planned.ok) return err(refuse('unavailable', planned.error))
      const paid = pay(state, player, spec.payment, payload, context.at)
      if (!paid.ok) return err(rejected(spec.kind, paid.error))

      const paying = playerOf(paid.value.state, player.playerId) ?? player
      const acted = spec.act(paid.value.state, paying, planned.value, paid.value.spent, context)
      if (!acted.ok) return err(refuse('unavailable', acted.error))

      const after = playerOf(acted.value.state, player.playerId) ?? paying
      const marked = useTurnAction(acted.value.state, after, turn, usageKey, after.stats)
      const logged = appendLog(marked, {
        username: player.username,
        playerId: player.playerId,
        publicLog:
          `${player.username} used ${spec.techName}: ${paid.value.said}${acted.value.said}` +
          (context.confirmedRepeat ? REPEAT_NOTE : ''),
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      const logId = lastLogId(logged)
      // What only the player may read follows the public line: a card is named here and never there
      const withPrivate = (acted.value.privateLines ?? []).reduce(
        (current, line) =>
          appendLog(current, { username: player.username, playerId: player.playerId, privateLog: line, createdAt: context.at ?? null }),
        logged,
      )
      return ok({
        state: countLinesIn(withPrivate, acted.value.historyIds ?? []),
        effect: acted.value.effect,
        logId,
      })
    },

    reverse(state, player, record, at) {
      const effect = record.effect
      if (effect.kind !== spec.effectKind) return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const typed = effect as EffectOf<K>
      const undone = spec.undo(state, player, typed, record, at)
      if (!undone.ok) return err({ kind: 'ASSISTED_UNDO_BLOCKED', logId: record.logId, reason: undone.error })
      const holder = playerOf(undone.value.state, player.playerId) ?? player
      const returned = returnResources(undone.value.state, holder, typed.spent, at)
      if (!returned.ok) return returned
      return ok({
        state: returned.value,
        text: `${player.username}'s ${spec.techName} was undone: ${joinList(typed.spent.map(returnedText))} returned${undone.value.said}`,
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Production boosts: Animal Husbandry, Construction, Banking, Plastics
// ---------------------------------------------------------------------------

interface BoostSpec {
  readonly kind: AssistedActionKind
  readonly techName: string
  readonly amount: number
}

/** The four production boosts: one Wheat, one city produces this much extra this turn (the tech cards). */
export const PRODUCTION_BOOSTS: readonly BoostSpec[] = [
  { kind: 'animalHusbandry', techName: 'Animal Husbandry', amount: 3 },
  { kind: 'construction', techName: 'Construction', amount: 5 },
  { kind: 'banking', techName: 'Banking', amount: 7 },
  { kind: 'plastics', techName: 'Plastics', amount: 10 },
]

function productionBoost(spec: BoostSpec): AssistedActionDefinition {
  return techAbility<'productionBoost', { readonly pieceId: string; readonly label: string }>({
    kind: spec.kind,
    techName: spec.techName,
    effectKind: 'productionBoost',
    phase: 'CM',
    buttonText: `Use ${spec.techName} (Wheat: +${spec.amount} production)`,
    payment: { kind: 'one', resource: 'Wheat' },

    plan(state, player, payload) {
      const pieceId = payload['cityPieceId']
      const city = typeof pieceId === 'string' ? cityProductionsOf(state, player).find((candidate) => candidate.pieceId === pieceId) : undefined
      return city === undefined ? err('Choose one of your cities on the map.') : ok({ pieceId: city.pieceId, label: city.label })
    },

    // The bonus is not stored on the city: `cityProductionsOf` reads it from this record while it is applied
    act(state, _player, city, spent) {
      return ok({
        state,
        said: `, so ${city.label} produces ${spec.amount} extra production this turn`,
        effect: { kind: 'productionBoost', tech: spec.techName, cityPieceId: city.pieceId, cityLabel: city.label, amount: spec.amount, spent },
      })
    },

    undo(state, _player, effect) {
      return ok({ state, said: ` and the extra ${effect.amount} production was taken off ${effect.cityLabel}` })
    },
  })
}

// ---------------------------------------------------------------------------
// Pottery: Any 2, one coin on the tech
// ---------------------------------------------------------------------------

/** The coins a counter may hold: its printed limit, and 2 more for the owner of an active Internet (as Democracy's purchase). */
function coinCapacityOf(state: GameState, player: Playerhand, key: CoinSourceKey): number | null {
  const source = findCoinSource(key)
  if (source === undefined || source.max === null) return null
  const internet = activeWonderOwnerIds(state.board.pieces, 'wonders/internet', blockadedPieceIds(state))
  return source.max + (internet.has(player.playerId) ? 2 : 0)
}

const pottery = techAbility<'pottery', null>({
  kind: 'pottery',
  techName: 'Pottery',
  effectKind: 'pottery',
  phase: 'CM',
  buttonText: 'Use Pottery (any 2 resources: +1 coin)',
  payment: { kind: 'any', count: 2 },

  block(state, player) {
    const max = coinCapacityOf(state, player, 'pottery')
    return max !== null && player.stats.coinSources.pottery >= max
      ? blocked('unavailable', 'Pottery is already at its coin capacity.')
      : undefined
  },

  plan: () => ok(null),

  act(state, player, _plan, spent) {
    const coins = player.stats.coinSources.pottery + 1
    const stats = { ...player.stats, coinSources: withCoinSource(player.stats.coinSources, 'pottery', coins) }
    const next = withPlayerHand(state, { ...player, stats })
    return ok({
      state: next,
      said: ` and added 1 coin (${totalCoins(coinSourcesOf(next, { ...player, stats }))}) to Pottery`,
      effect: { kind: 'pottery', spent },
    })
  },

  undo(state, player) {
    if (player.stats.coinSources.pottery < 1) return err('Pottery holds no coin any more, so there is none to take off.')
    const stats = { ...player.stats, coinSources: withCoinSource(player.stats.coinSources, 'pottery', player.stats.coinSources.pottery - 1) }
    return ok({ state: withPlayerHand(state, { ...player, stats }), said: ' and 1 coin was removed from Pottery' })
  },
})

// ---------------------------------------------------------------------------
// Philosophy: Any 3, a random Great Person
// ---------------------------------------------------------------------------

const philosophy = techAbility<'philosophy', null>({
  kind: 'philosophy',
  techName: 'Philosophy',
  effectKind: 'philosophy',
  phase: 'CM',
  buttonText: 'Use Philosophy (any 3 resources: a great person)',
  payment: { kind: 'any', count: 3 },

  block: (state) =>
    anyGreatPersonMarkerLeft(state) ? undefined : blocked('unavailable', 'No Great Person marker is left, so no great person can be gained.'),

  plan: () => ok(null),

  // A Great Person is gained as a culture advance's Great Person space gains one (supply, marker and shuffle rules
  // included). The card is private: the public line has the marker type and the logged item number, the name goes to
  // the player's own log
  act(state, player, _plan, spent, context) {
    const gained = gainGreatPerson(state, player, { requestId: context.requestId, at: context.at, count: 1, level: 1, step: 0 })
    if (!gained.ok) return err(gained.error)
    if (gained.value.outcome === 'none') return err(`No great person could be gained: ${gained.value.phrase.replace(/^gained no Great Person, because /, '')}.`)
    return ok({
      state: gained.value.state,
      said: `, and ${gained.value.phrase}`,
      privateLines: gained.value.privateText === '' ? [] : [`Philosophy: ${gained.value.privateText}`],
      historyIds: [gained.value.marker?.historyId],
      effect: {
        kind: 'philosophy',
        spent,
        drawn: gained.value.drawn,
        rejected: gained.value.rejected,
        kept: gained.value.kept,
        marker: gained.value.marker,
      },
    })
  },

  // The card goes back to the deck (which is shuffled, as every undo of a draw does) if it is still in the hand
  undo(state, player, effect, record, at) {
    if (effect.marker !== null) {
      const blockedBy = markerUndoBlock(state, record.playerId, effect.marker)
      if (blockedBy !== undefined) return err(blockedBy)
    }
    const restored = restoreDrawnCards(state, player, record.id, [...effect.drawn, ...effect.rejected], effect.kept, 'GREAT_PERSON')
    if (!restored.ok) return err('The Great Person card is no longer in your hand, so Philosophy cannot be undone.')
    let deck = restored.value
    if (effect.marker !== null) {
      const removed = removeGreatPersonMarker(deck, record, effect.marker, at)
      if (!removed.ok) return err(removed.error)
      deck = removed.value
    }
    return ok({ state: deck, said: ` and the great person card was put back in the deck${removedMarkerText(effect.marker)}` })
  },
})

// ---------------------------------------------------------------------------
// Education: four different resources, a free tech in City Management
// ---------------------------------------------------------------------------

/**
 * The free tech is a `TechGrant` that is spent in City Management (`phase: 'CM'`) by revealing the tech the player
 * chose, in place of the Start of Turn the other grants wait for.
 */
const education = techAbility<'education', null>({
  kind: 'education',
  techName: 'Education',
  effectKind: 'education',
  phase: 'CM',
  buttonText: 'Use Education (4 different resources: a free tech)',
  payment: { kind: 'distinct', count: 4 },

  plan: () => ok(null),

  act(state, player, _plan, spent, context) {
    const grant: TechGrant = {
      id: context.requestId,
      source: 'Education',
      level: null,
      turnNumber: turnStatus(state).currentTurn,
      phase: 'CM',
    }
    return ok({
      state: withPlayerHand(state, { ...player, techGrants: [...player.techGrants, grant] }),
      said: ', and may learn a new tech of their choice for free: choose and reveal it in the tech tree during City Management',
      effect: { kind: 'education', spent, grantId: grant.id },
    })
  },

  undo(state, player, effect) {
    const spentGrant = grantUndoBlock(player, effect.grantId)
    if (spentGrant !== undefined) return err(spentGrant)
    return ok({
      state: withPlayerHand(state, { ...player, techGrants: player.techGrants.filter((grant) => grant.id !== effect.grantId) }),
      said: ' and the free tech was taken back',
    })
  },
})

// ---------------------------------------------------------------------------
// Horseback Riding: Silk in the Trade phase, 9 trade for the player and 6 for another
// ---------------------------------------------------------------------------

const HORSEBACK_SELF = 9
const HORSEBACK_OTHER = 6

const roomFor = (player: Playerhand, gain: number): number =>
  Math.max(0, Math.min(gain, tradeCeilingOf(player.civilization?.name) - player.stats.trade))

const horsebackRiding = techAbility<'horsebackRiding', Playerhand>({
  kind: 'horsebackRiding',
  techName: 'Horseback Riding',
  effectKind: 'horsebackRiding',
  phase: 'TRADE',
  buttonText: `Use Horseback Riding (Silk: +${HORSEBACK_SELF} trade, another player +${HORSEBACK_OTHER})`,
  payment: { kind: 'one', resource: 'Silk' },

  plan: otherPlayer,

  // Each gain stops at the end of the trade track; what was added is what an undo takes off
  act(state, player, target, spent) {
    const gained = roomFor(player, HORSEBACK_SELF)
    const targetGained = roomFor(target, HORSEBACK_OTHER)
    const mine = { ...player, stats: { ...player.stats, trade: player.stats.trade + gained } }
    const theirs = { ...target, stats: { ...target.stats, trade: target.stats.trade + targetGained } }
    return ok({
      state: withPlayerHand(withPlayerHand(state, mine), theirs),
      said: `, gaining ${gained} (${mine.stats.trade}) trade, and ${target.username} gained ${targetGained} (${theirs.stats.trade}) trade`,
      effect: { kind: 'horsebackRiding', spent, gained, targetId: target.playerId, targetGained },
    })
  },

  // Refused when a player has spent the trade since: the gain cannot be taken off what is no longer there
  undo(state, player, effect) {
    const target = playerOf(state, effect.targetId)
    if (target === undefined) return err('The other player is no longer in the game.')
    if (player.stats.trade < effect.gained) return err(`You have spent some of the ${effect.gained} trade since, so it cannot be taken back. Correct the trade by hand.`)
    if (target.stats.trade < effect.targetGained) return err(`${target.username} has spent some of the ${effect.targetGained} trade since, so it cannot be taken back.`)
    const mine = { ...player, stats: { ...player.stats, trade: player.stats.trade - effect.gained } }
    const theirs = { ...target, stats: { ...target.stats, trade: target.stats.trade - effect.targetGained } }
    return ok({
      state: withPlayerHand(withPlayerHand(state, mine), theirs),
      said: `, ${effect.gained} (${mine.stats.trade}) trade removed from ${player.username} and ${effect.targetGained} (${theirs.stats.trade}) from ${target.username}`,
    })
  },
})

// ---------------------------------------------------------------------------
// Mysticism: a Spy forces an opponent to discard a coin token of the player's choice
// ---------------------------------------------------------------------------

/** The counters that hold coin tokens, the ones a coin can be invested from (the printed "1 coin" and wonder coins are not tokens). */
const COIN_TOKEN_SOURCES: readonly string[] = INVESTABLE_COIN_SOURCES

const mysticism = techAbility<'mysticism', { readonly target: Playerhand; readonly source: CoinSourceKey; readonly label: string }>({
  kind: 'mysticism',
  techName: 'Mysticism',
  effectKind: 'mysticism',
  phase: 'CM',
  buttonText: 'Use Mysticism (Spy: an opponent discards a coin)',
  payment: { kind: 'one', resource: 'Spy' },

  plan(state, player, payload) {
    const target = otherPlayer(state, player, payload)
    if (!target.ok) return target
    const source = payload['source']
    const known = typeof source === 'string' && COIN_TOKEN_SOURCES.includes(source) ? findCoinSource(source) : undefined
    if (known === undefined) return err(`Choose one of the counters that hold coin tokens: ${COIN_TOKEN_SOURCES.map((key) => findCoinSource(key)?.label ?? key).join(', ')}.`)
    if (coinSourcesOf(state, target.value)[known.key as CoinSourceKey] < 1) return err(`${target.value.username} holds no coin on ${known.label}.`)
    return ok({ target: target.value, source: known.key as CoinSourceKey, label: known.label })
  },

  act(state, _player, plan, spent) {
    const { target, source, label } = plan
    const counters = withCoinSource(target.stats.coinSources, source, target.stats.coinSources[source] - 1)
    const theirs = { ...target, stats: { ...target.stats, coinSources: counters } }
    return ok({
      state: withPlayerHand(state, theirs),
      said: `, so ${target.username} discards a coin from ${label} (${totalCoins(coinSourcesOf(state, theirs))} left)`,
      effect: { kind: 'mysticism', spent, targetId: target.playerId, source },
    })
  },

  undo(state, _player, effect) {
    const target = playerOf(state, effect.targetId)
    if (target === undefined) return err('The other player is no longer in the game.')
    const label = findCoinSource(effect.source)?.label ?? effect.source
    const key = effect.source as CoinSourceKey
    const theirs = {
      ...target,
      stats: { ...target.stats, coinSources: withCoinSource(target.stats.coinSources, key, target.stats.coinSources[key] + 1) },
    }
    return ok({ state: withPlayerHand(state, theirs), said: ` and the coin was given back to ${target.username} on ${label}` })
  },
})

// ---------------------------------------------------------------------------
// Writing, Civil Service, Mass Media: a Spy cancels something of another player
// ---------------------------------------------------------------------------

interface CancelSpec {
  readonly kind: AssistedActionKind
  readonly techName: string
  readonly phase: 'ANY'
  /** What it cancels, for the line: "a city action". */
  readonly what: string
  /** A rule that goes with it ("the resources spent on it are lost"), or `''`. */
  readonly rule: string
}

const CANCELS: readonly CancelSpec[] = [
  { kind: 'writing', techName: 'Writing', phase: 'ANY', what: 'a city action', rule: '' },
  { kind: 'civilService', techName: 'Civil Service', phase: 'ANY', what: 'a culture event', rule: '' },
  { kind: 'massMedia', techName: 'Mass Media', phase: 'ANY', what: 'a resource ability', rule: ', and the resources spent on it are lost' },
]

const MAX_NOTE = 80

/**
 * The game has no pending action to stop, so the cancel is paid and logged and the cancelled thing is settled by hand:
 * the other player takes it back with the undo vote, or corrects it. The line says so.
 */
function cancelAbility(spec: CancelSpec): AssistedActionDefinition {
  return techAbility<'cancelAbility', { readonly target: Playerhand; readonly note: string }>({
    kind: spec.kind,
    techName: spec.techName,
    effectKind: 'cancelAbility',
    phase: spec.phase,
    buttonText: `Use ${spec.techName} (Spy: cancel ${spec.what})`,
    payment: { kind: 'one', resource: 'Spy' },

    plan(state, player, payload) {
      const target = otherPlayer(state, player, payload)
      if (!target.ok) return target
      const note = payload['note']
      if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE)) return err(`The note must be text of at most ${MAX_NOTE} characters.`)
      return ok({ target: target.value, note: (note ?? '').trim() })
    },

    act(state, _player, plan, spent) {
      return ok({
        state,
        said:
          `, cancelling ${spec.what} of ${plan.target.username}${plan.note === '' ? '' : ` (${plan.note})`}${spec.rule}. ` +
          'The game does not stop it: settle it by hand, or undo it with the vote',
        effect: { kind: 'cancelAbility', tech: spec.techName, spent, targetId: plan.target.playerId, note: plan.note },
      })
    },

    undo(state) {
      return ok({ state, said: `; ${spec.what} that was cancelled is not brought back by the game` })
    },
  })
}

// ---------------------------------------------------------------------------
// Monarchy: Silk, obsolete an ancient wonder (logged) or kill one random unit card of another player
// ---------------------------------------------------------------------------

type MonarchyPlan =
  | { readonly mode: 'obsolete' }
  | { readonly mode: 'kill'; readonly target: Playerhand; readonly units: readonly UnitItem[] }

/** The unit cards in a hand that a kill may take: not one placed in a battle's arena. */
const unitCardsOf = (player: Playerhand): readonly UnitItem[] => player.items.filter(isUnit).filter((unit) => !unit.inBattle)

const monarchy = techAbility<'monarchy', MonarchyPlan>({
  kind: 'monarchy',
  techName: 'Monarchy',
  effectKind: 'monarchy',
  phase: 'CM',
  buttonText: 'Use Monarchy (Silk: obsolete a wonder, or kill a random unit)',
  payment: { kind: 'one', resource: 'Silk' },

  plan(state, player, payload) {
    const mode = payload['mode']
    if (mode === 'obsolete') return ok({ mode })
    if (mode !== 'kill') return err('Choose obsolete or kill.')
    const target = otherPlayer(state, player, payload)
    if (!target.ok) return target
    const units = unitCardsOf(target.value)
    if (units.length === 0) return err(`${target.value.username} holds no unit card to kill.`)
    return ok({ mode, target: target.value, units })
  },

  act(state, _player, plan, spent) {
    if (plan.mode === 'obsolete') {
      return ok({
        state,
        said: ', obsoleting 1 ancient wonder (by hand: obsolescence is not tracked)',
        effect: { kind: 'monarchy', spent, mode: 'obsolete' },
      })
    }
    // The random unit comes from the game's seed, so a replay of the same state kills the same card
    const [index, rng] = nextInt(state.rng, plan.units.length)
    const killed = plan.units[index]
    if (killed === undefined) return err(`${plan.target.username} holds no unit card to kill.`)
    const victim = plan.target
    const inBattlehand = victim.battlehand.some((unit) => unit.id === killed.id)
    const next = withPlayerHand({ ...state, rng }, {
      ...victim,
      items: victim.items.filter((item) => item.id !== killed.id),
      battlehand: victim.battlehand.filter((unit) => unit.id !== killed.id),
    })
    return ok({
      // A discard is open information, so the line names the unit in full with its item number, as Gustavus Adolphus' discards do
      state: { ...next, discardedItems: [...next.discardedItems, { ...killed, hidden: true }] },
      said: `, killing ${discardedName(killed)} from ${victim.username}'s hand`,
      effect: { kind: 'monarchy', spent, mode: 'kill', targetId: victim.playerId, killed, ...(inBattlehand ? { inBattlehand: true as const } : {}) },
    })
  },

  undo(state, _player, effect) {
    if (effect.mode === 'obsolete' || effect.killed === undefined || effect.targetId === undefined) {
      return ok({ state, said: '; the obsolete wonder is not changed by the game' })
    }
    const victim = playerOf(state, effect.targetId)
    if (victim === undefined) return err('The other player is no longer in the game.')
    const killed = effect.killed
    if (!state.discardedItems.some((item) => item.id === killed.id)) {
      return err(`${itemName(killed)} is no longer in the discard pile, so it cannot be returned to ${victim.username}.`)
    }
    const back = withPlayerHand(state, {
      ...victim,
      items: [...victim.items, killed],
      battlehand: effect.inBattlehand === true ? [...victim.battlehand, killed] : victim.battlehand,
    })
    return ok({
      state: { ...back, discardedItems: back.discardedItems.filter((item) => item.id !== killed.id) },
      said: ` and ${discardedName(killed)} was returned to ${victim.username}'s hand`,
    })
  },
})

/** Every action of this file, in the order the projection lists them. */
export const TECH_ABILITY_ACTIONS: readonly AssistedActionDefinition[] = [
  ...PRODUCTION_BOOSTS.map(productionBoost),
  pottery,
  philosophy,
  education,
  horsebackRiding,
  mysticism,
  ...CANCELS.map(cancelAbility),
  monarchy,
]
