/**
 * Assisted actions: things the game does for a player instead of asking them to
 * edit counters and move pieces by hand.
 *
 * New in this port, no old-system equivalent. Every action is one entry in
 * {@link ASSISTED_ACTIONS}: what decides whether it can be pressed
 * (`availability`), what pressing it does (`apply`) and how to take it back
 * (`reverse`). The server route, the projection and the undo vote all go
 * through the registry, so the rules are written once.
 *
 * What an action did is recorded in `GameState.assistedActions`, keyed on the
 * client's `requestId`. A repeated `requestId` changes nothing, and the once
 * per turn limit is the usage key on the player's `PlayerTurn.usedActions`.
 *
 * Import cycle, on purpose: `state.ts` builds the projection from this file, this
 * file removes board pieces through `actions/board.ts`, and that file uses
 * `state.ts` again. It is safe because this file imports only types from
 * `state.ts` (erased at build time) and uses nothing from `actions/board.ts` or
 * `state.ts` while the module loads, only inside functions that run later. A
 * top-level use of a `state.ts` value here, or a top-level call into
 * `actions/board.ts`, would run before the cycle has finished loading and throw
 * on an uninitialised binding. Keep it that way: no value imports from
 * `state.ts`, and nothing computed at load time from the board actions.
 */

import { movePieceUnchecked, removePiece } from './actions/board.js'
import { reshuffleItems } from './actions/draw.js'
import { blockadedPieceIds } from './blockade.js'
import {
  CULTURE_VICTORY_STEP,
  areaAt,
  boardAreas,
  cultureCellCenter,
  cultureStepOf,
  locationOf,
  playerAreas,
} from './board.js'
import type { BoardPiece } from './board.js'
import { activeWonderOwnerIds, coinSourcesOf, findCoinSource, withCoinSource } from './coins.js'
import {
  cultureAdvanceCost,
  cultureMarkerOf,
  cultureSpaceAt,
  rewardDrawCount,
} from './culture-track.js'
import type { CultureAdvanceCost, CultureMarker, CultureSpace } from './culture-track.js'
import type { EngineError } from './errors.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { appendLog } from './log.js'
import { nextId, shuffle } from './random.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import { SHEET_LABEL } from './sheet-name.js'
import type { SheetName } from './sheet-name.js'
import type {
  AssistedActionKind,
  AssistedActionRecord,
  AssistedEffect,
  AssistedStatus,
  AvailableAction,
  CultureCardKind,
  GameLogEntry,
  GameState,
  PendingReward,
  Playerhand,
  PlayerStats,
  PublicAssistedAction,
  SpentResource,
} from './state.js'
import { publicTurn, publicTurnKey, sameTurn, turnStatus } from './turn.js'
import type { PlayerTurn, TurnPhase } from './turn.js'

// These two read the player list directly, so this module does not need the
// value exports of `state.ts`, which in turn builds the projection from here.
const playerOf = (state: GameState, playerId: string): Playerhand | undefined =>
  state.players.find((player) => player.playerId === playerId)

const withPlayerHand = (state: GameState, player: Playerhand): GameState => ({
  ...state,
  players: state.players.map((existing) =>
    existing.playerId === player.playerId ? player : existing,
  ),
})

/** Why an action cannot be pressed: every status except `ready`. */
export interface BlockedAvailability {
  readonly status: Exclude<AssistedStatus, 'ready'>
  readonly reason: string
}

/** Whether an action can be pressed now. A union, so `status !== 'ready'` narrows to the reason it is blocked. */
export type AssistedAvailability =
  | { readonly status: 'ready'; readonly reason: string }
  | BlockedAvailability

const READY: AssistedAvailability = { status: 'ready', reason: 'Ready to use.' }

const blocked = (
  status: BlockedAvailability['status'],
  reason: string,
): BlockedAvailability => ({
  status,
  reason,
})

// ---------------------------------------------------------------------------
// City Management, the shared predicate
// ---------------------------------------------------------------------------

/**
 * The player's turn record while their City Management phase is open: Start of
 * Turn and Trade are done, City Management, Movement and Research are not.
 * `undefined` otherwise. `purchaseCoin` and every action that works "during City
 * Management" use this, so they cannot disagree about when that is.
 */
export function openCityManagementTurn(
  state: GameState,
  player: Playerhand,
): PlayerTurn | undefined {
  const turnNumber = turnStatus(state).currentTurn
  const turn = player.playerTurns.find((candidate) => candidate.turnNumber === turnNumber)
  if (
    turn === undefined ||
    !turn.done.SOT ||
    !turn.done.TRADE ||
    turn.done.CM ||
    turn.done.MOVEMENT ||
    turn.done.RESEARCH
  ) {
    return undefined
  }
  return turn
}

/**
 * Writes a usage key on the turn, on the player's own record and on the public
 * copy, together with the new stats. One place, so retries and phase re-marking
 * see the same thing.
 */
function useTurnAction(
  state: GameState,
  player: Playerhand,
  turn: PlayerTurn,
  usageKey: string,
  stats: PlayerStats,
): GameState {
  const updatedTurn = { ...turn, usedActions: [...turn.usedActions, usageKey] }
  const playerTurns = player.playerTurns.map((candidate) =>
    sameTurn(candidate, updatedTurn) ? updatedTurn : candidate,
  )
  return {
    ...withPlayerHand(state, { ...player, playerTurns, stats }),
    publicTurns: { ...state.publicTurns, [publicTurnKey(updatedTurn)]: publicTurn(updatedTurn) },
  }
}

/** The inverse of {@link useTurnAction}'s usage key: frees the use on that turn. */
function freeTurnAction(
  state: GameState,
  player: Playerhand,
  turnNumber: number,
  usageKey: string,
): GameState {
  const turn = player.playerTurns.find((candidate) => candidate.turnNumber === turnNumber)
  if (turn === undefined) return state
  const at = turn.usedActions.indexOf(usageKey)
  if (at === -1) return state
  const updatedTurn = {
    ...turn,
    usedActions: turn.usedActions.filter((_, index) => index !== at),
  }
  const playerTurns = player.playerTurns.map((candidate) =>
    sameTurn(candidate, updatedTurn) ? updatedTurn : candidate,
  )
  return {
    ...withPlayerHand(state, { ...player, playerTurns }),
    publicTurns: { ...state.publicTurns, [publicTurnKey(updatedTurn)]: publicTurn(updatedTurn) },
  }
}

// ---------------------------------------------------------------------------
// Spending a resource
// ---------------------------------------------------------------------------

const normalize = (name: string): string => name.trim().toLowerCase()

/**
 * The token a resource would be paid with, without paying it. A hut in the
 * player's hand comes first, then a `resources/<name>` piece whose centre lies
 * in the player's own area. A piece outside every area is nobody's and is never
 * taken. Generic over Incense, Iron, Silk, Wheat and Uranium.
 */
export function findResourceToken(
  state: GameState,
  playerId: string,
  resource: string,
): SpentResource | undefined {
  const player = playerOf(state, playerId)
  if (player === undefined) return undefined

  const wanted = normalize(resource)
  const hut = player.items.find(
    (item) => item.kind === 'hut' && !item.used && normalize(item.name) === wanted,
  )
  if (hut !== undefined) return { kind: 'hut', resource, itemId: hut.id }

  const areas = playerAreas(state.board, state.players)
  const piece = state.board.pieces.find(
    (candidate) =>
      candidate.category === 'resource' &&
      candidate.assetId === `resources/${wanted}` &&
      areaAt(areas, candidate.x + candidate.width / 2, candidate.y + candidate.height / 2)
        ?.playerId === playerId,
  )
  return piece === undefined ? undefined : { kind: 'piece', resource, piece }
}

export interface SpendOutcome {
  readonly state: GameState
  /** Exactly what was spent, so an undo can put the same token back. */
  readonly spent: SpentResource
}

/**
 * Pays one resource token. A hut goes to `discardedItems` (hidden, as
 * `discardItem` leaves it); a piece is removed from the board through the board
 * history, which is "back to stock" because supply is counted from the pieces on
 * the board. `NO_RESOURCE` when the player has neither.
 */
export function spendResource(
  state: GameState,
  playerId: string,
  resource: string,
  at?: string,
): Result<SpendOutcome, 'NO_RESOURCE'> {
  const player = playerOf(state, playerId)
  const token = findResourceToken(state, playerId, resource)
  if (player === undefined || token === undefined) return err('NO_RESOURCE')

  if (token.kind === 'hut') {
    const hut = player.items.find((item) => item.id === token.itemId)
    if (hut === undefined) return err('NO_RESOURCE')
    const next: GameState = {
      ...withPlayerHand(state, {
        ...player,
        items: player.items.filter((item) => item.id !== hut.id),
      }),
      discardedItems: [...state.discardedItems, { ...hut, hidden: true }],
    }
    return ok({ state: next, spent: token })
  }

  const removed = removePiece(state, {
    playerId,
    pieceId: token.piece.id,
    ...(at === undefined ? {} : { at }),
  })
  if (!removed.ok) return err('NO_RESOURCE')
  return ok({ state: removed.value, spent: token })
}

/** Puts a spent token back: the hut into the hand, or the piece onto the board where it was. */
function returnResource(
  state: GameState,
  player: Playerhand,
  spent: SpentResource,
  at: string | null,
): Result<GameState, EngineError> {
  if (spent.kind === 'hut') {
    const inDiscard = state.discardedItems.find((item) => item.id === spent.itemId)
    const inDeck = state.items.find((item) => item.id === spent.itemId)
    const item = inDiscard ?? inDeck
    if (item === undefined) return err({ kind: 'ITEM_NOT_FOUND', sheetName: 'HUTS' })
    return ok({
      ...withPlayerHand(state, { ...player, items: [...player.items, { ...item, hidden: true }] }),
      discardedItems: state.discardedItems.filter((candidate) => candidate.id !== item.id),
      items: state.items.filter((candidate) => candidate.id !== item.id),
    })
  }
  return ok(placeBack(state, player, spent.piece, at))
}

/**
 * Puts the exact piece back, same id and same place, as a board history entry
 * so the history bar and board replay see it. It lands on top of the stack, which
 * is what replaying a `place` change does. Not through `placePiece`: that would
 * make a new piece, snap it into the next free slot and refuse it when the
 * supply count is full, and an undo must not be refused halfway.
 */
function placeBack(
  state: GameState,
  player: Playerhand,
  piece: BoardPiece,
  at: string | null,
): GameState {
  if (state.board.pieces.some((candidate) => candidate.id === piece.id)) return state
  const [id, rng] = nextId(state.rng)
  const areas = boardAreas(state.board, state.players)
  return {
    ...state,
    rng,
    board: {
      ...state.board,
      pieces: [...state.board.pieces, piece],
      history: [
        ...state.board.history,
        {
          id,
          at,
          playerId: player.playerId,
          username: player.username,
          description: `${player.username} put back ${piece.label} at ${locationOf(state.board, areas, piece)}`,
          change: { kind: 'place', piece, onTop: true },
          logLength: state.log.length,
        },
      ],
      redo: [],
    },
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

interface Applied {
  readonly state: GameState
  readonly effect: AssistedEffect
  /** The public line the action wrote, the last one in the log. */
  readonly logId: string
}

interface Reversed {
  readonly state: GameState
  /** The public sentence for the new log line. */
  readonly text: string
}

/** What `chooseReward` carries: which pending reward and which of its cards to keep. */
export interface ChooseRewardPayload {
  readonly rewardId: string
  readonly itemId: string
}

interface ApplyContext {
  readonly requestId: string
  readonly at: string | undefined
  /** Only `chooseReward` reads it; every other action ignores it. */
  readonly payload: ChooseRewardPayload | undefined
}

type AssistedActionDefinition = {
  readonly kind: AssistedActionKind
  /** The tech card this action belongs to, as the tech dialog names it. `null` for an action that is not a card. */
  readonly techName: string | null
  readonly label: string
  /**
   * Whether it is an entry of `availableActions`, a button. `chooseReward` is
   * not: it answers a choice the viewer already has and carries a payload.
   */
  readonly button: boolean
  /**
   * How often it can be done. A key (the default for a card) is written on the
   * turn and allows it once per turn; `null`, as for the culture advance, means
   * repeatable: it is never `used`, and each press needs its own `requestId`.
   */
  readonly usageKey: string | null
  availability(state: GameState, playerId: string): AssistedAvailability
  apply(state: GameState, player: Playerhand, context: ApplyContext): Result<Applied, EngineError>
  reverse(
    state: GameState,
    player: Playerhand,
    record: AssistedActionRecord,
    at: string | null,
  ): Result<Reversed, EngineError>
}

const rejected = (action: string, availability: BlockedAvailability): EngineError => ({
  kind: 'ASSISTED_ACTION_REJECTED',
  action,
  status: availability.status,
  reason: availability.reason,
})

/** The tech must be chosen, and revealed because a hidden one is private. */
function techBlock(player: Playerhand, techName: string): BlockedAvailability | undefined {
  const tech = player.techsChosen.find((candidate) => candidate.name === techName)
  if (tech === undefined) return blocked('not-owned', `You do not have ${techName}.`)
  if (tech.hidden) return blocked('unavailable', `Reveal ${techName} before using it.`)
  return undefined
}

const PHASE_REASON = 'Only available during your open City Management phase.'

// -- Incense cards: Chivalry, Currency, Metal Casting -----------------------

/**
 * The cards that read "Incense, City Management: gain N culture". One row each,
 * and one definition built from it, so a fourth card of the kind is a table
 * entry and not a copy of the code. Each card has its own usage key, so Currency
 * and Chivalry can both be used in the same turn, each once, each spending its
 * own Incense.
 */
interface ResourceCultureCard {
  readonly kind: CultureCardKind
  readonly techName: string
  readonly resource: string
  readonly culture: number
}

const RESOURCE_CULTURE_CARDS: readonly ResourceCultureCard[] = [
  { kind: 'chivalry', techName: 'Chivalry', resource: 'Incense', culture: 5 },
  { kind: 'currency', techName: 'Currency', resource: 'Incense', culture: 3 },
  { kind: 'metalCasting', techName: 'Metal Casting', resource: 'Incense', culture: 7 },
]

function resourceCultureCard(card: ResourceCultureCard): AssistedActionDefinition {
  const usageKey = `card:${card.techName}`
  return {
    kind: card.kind,
    techName: card.techName,
    label: card.techName,
    button: true,
    usageKey,

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const tech = techBlock(player, card.techName)
      if (tech !== undefined) return tech
      const turn = openCityManagementTurn(state, player)
      if (turn === undefined) return blocked('wrong-phase', PHASE_REASON)
      if (turn.usedActions.includes(usageKey)) {
        return blocked('used', `${card.techName} has already been used this turn.`)
      }
      if (findResourceToken(state, playerId, card.resource) === undefined) {
        return blocked(
          'needs-resource',
          `You need an ${card.resource} token: an ${card.resource} hut in your hand or an ${card.resource} piece in your player area.`,
        )
      }
      return READY
    },

    apply(state, player, context) {
      const turn = openCityManagementTurn(state, player)
      const spend = spendResource(state, player.playerId, card.resource, context.at)
      if (turn === undefined || !spend.ok) {
        return err(
          rejected(
            card.kind,
            blocked('needs-resource', `You need an ${card.resource} token to use ${card.techName}.`),
          ),
        )
      }
      const afterSpend = spend.value.state
      const paying = playerOf(afterSpend, player.playerId) ?? player
      const stats = { ...paying.stats, culture: paying.stats.culture + card.culture }
      const used = useTurnAction(afterSpend, paying, turn, usageKey, stats)
      const logged = appendLog(used, {
        username: player.username,
        playerId: player.playerId,
        publicLog: `${player.username} used ${card.techName}: spent 1 ${card.resource} and gained ${card.culture} culture`,
        privateLog: '',
        createdAt: context.at ?? null,
        assistedActionId: context.requestId,
      })
      return ok({
        state: logged,
        effect: { kind: card.kind, culture: card.culture, spent: spend.value.spent },
        logId: lastLogId(logged),
      })
    },

    reverse(state, player, record, at) {
      const effect = record.effect
      if (effect.kind !== card.kind) return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const stats = { ...player.stats, culture: Math.max(0, player.stats.culture - effect.culture) }
      const returned = returnResource(
        withPlayerHand(state, { ...player, stats }),
        { ...player, stats },
        effect.spent,
        at,
      )
      if (!returned.ok) return returned
      return ok({
        state: returned.value,
        text: `${player.username}'s ${card.techName} was undone: ${effect.culture} culture removed and the ${effect.spent.resource} token returned`,
      })
    },
  }
}

// -- Democracy and Printing Press -------------------------------------------

type CoinPurchaseSource = 'democracy' | 'printingPress'
type CoinPurchaseRejection = Extract<
  EngineError,
  { kind: 'COIN_PURCHASE_REJECTED' }
>['reason']
/** What can stop a purchase once the tech is known to be revealed. */
type OpenPurchaseRejection = Exclude<CoinPurchaseRejection, 'TECH_NOT_REVEALED'>

interface CoinPurchaseTerms {
  readonly techName: string
  readonly resource: 'trade' | 'culture'
  readonly cost: number
  readonly paidWith: string
}

const COIN_PURCHASES: Readonly<Record<CoinPurchaseSource, CoinPurchaseTerms>> = {
  democracy: { techName: 'Democracy', resource: 'trade', cost: 6, paidWith: '6 trade' },
  printingPress: { techName: 'Printing Press', resource: 'culture', cost: 5, paidWith: '5 culture' },
}

const coinUsageKey = (source: CoinPurchaseSource): string => `coin-purchase:${source}`

interface CoinPurchasePlan {
  readonly turn: PlayerTurn
  readonly current: number
}

/**
 * Whether the purchase can go ahead, in the order `purchaseCoin` always checked
 * it. The reasons are its existing ones, so its route and its tests are
 * untouched; the registry maps the same reasons to availability statuses.
 */
function planCoinPurchase(
  state: GameState,
  player: Playerhand,
  source: CoinPurchaseSource,
): Result<CoinPurchasePlan, CoinPurchaseRejection> {
  const terms = COIN_PURCHASES[source]
  if (!player.techsChosen.some((tech) => tech.name === terms.techName && !tech.hidden)) {
    return err('TECH_NOT_REVEALED')
  }
  return planOpenCoinPurchase(state, player, source)
}

/**
 * The checks after the tech is known to be revealed. Split out so the
 * availability, which has already handled an unrevealed tech with its own
 * wording, matches on reasons that can actually occur.
 */
function planOpenCoinPurchase(
  state: GameState,
  player: Playerhand,
  source: CoinPurchaseSource,
): Result<CoinPurchasePlan, OpenPurchaseRejection> {
  const terms = COIN_PURCHASES[source]
  const turn = openCityManagementTurn(state, player)
  if (turn === undefined) return err('PHASE_CLOSED')
  if (turn.usedActions.includes(coinUsageKey(source))) return err('ALREADY_USED')
  if (player.stats[terms.resource] < terms.cost) return err('INSUFFICIENT_RESOURCES')

  const current = coinSourcesOf(state, player)[source]
  const coinSource = findCoinSource(source)
  if (coinSource === undefined) return err('AT_CAPACITY')
  const internetOwners = activeWonderOwnerIds(
    state.board.pieces,
    'wonders/internet',
    blockadedPieceIds(state),
  )
  const max =
    coinSource.max === null ? null : coinSource.max + (internetOwners.has(player.playerId) ? 2 : 0)
  if (max !== null && current >= max) return err('AT_CAPACITY')
  return ok({ turn, current })
}

/**
 * Pays for one Democracy or Printing Press coin. The body `purchaseCoin` had,
 * moved here so the registry and the old route share it. A `requestId` links the
 * log line to an assisted action record; the old route passes none.
 */
export function applyCoinPurchase(
  state: GameState,
  player: Playerhand,
  source: CoinPurchaseSource,
  options: { readonly at?: string; readonly requestId?: string } = {},
): Result<{ readonly state: GameState; readonly logId: string }, EngineError> {
  const terms = COIN_PURCHASES[source]
  const plan = planCoinPurchase(state, player, source)
  if (!plan.ok) return err({ kind: 'COIN_PURCHASE_REJECTED', source, reason: plan.error })

  const stats: PlayerStats = {
    ...player.stats,
    [terms.resource]: player.stats[terms.resource] - terms.cost,
    coinSources: withCoinSource(player.stats.coinSources, source, plan.value.current + 1),
  }
  const used = useTurnAction(state, player, plan.value.turn, coinUsageKey(source), stats)
  const logged = appendLog(used, {
    username: player.username,
    playerId: player.playerId,
    publicLog: `${player.username} spent ${terms.paidWith} to add 1 coin to ${terms.techName}`,
    privateLog: '',
    createdAt: options.at ?? null,
    ...(options.requestId === undefined ? {} : { assistedActionId: options.requestId }),
  })
  return ok({ state: logged, logId: lastLogId(logged) })
}

function coinPurchase(source: CoinPurchaseSource): AssistedActionDefinition {
  const terms = COIN_PURCHASES[source]
  const definition: AssistedActionDefinition = {
    kind: source,
    techName: terms.techName,
    label: terms.techName,
    button: true,
    usageKey: coinUsageKey(source),

    availability(state, playerId) {
      const player = playerOf(state, playerId)
      if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
      const tech = techBlock(player, terms.techName)
      if (tech !== undefined) return tech
      const plan = planOpenCoinPurchase(state, player, source)
      if (plan.ok) {
        return { status: 'ready', reason: `Spend ${terms.paidWith} to add 1 coin to ${terms.techName}.` }
      }
      switch (plan.error) {
        case 'PHASE_CLOSED':
          return blocked('wrong-phase', PHASE_REASON)
        case 'ALREADY_USED':
          return blocked('used', `${terms.techName} has already been used this turn.`)
        case 'INSUFFICIENT_RESOURCES':
          return blocked('needs-resource', `You need ${terms.paidWith} for this purchase.`)
        case 'AT_CAPACITY':
          return blocked('unavailable', `${terms.techName} is already at its coin capacity.`)
      }
    },

    apply(state, player, context) {
      const applied = applyCoinPurchase(state, player, source, {
        requestId: context.requestId,
        ...(context.at === undefined ? {} : { at: context.at }),
      })
      if (!applied.ok) return applied
      return ok({
        state: applied.value.state,
        effect: { kind: 'coinPurchase', source, resource: terms.resource, cost: terms.cost },
        logId: applied.value.logId,
      })
    },

    reverse(state, player, record) {
      const effect = record.effect
      if (effect.kind !== 'coinPurchase') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
      const current = player.stats.coinSources[effect.source]
      const stats: PlayerStats = {
        ...player.stats,
        [effect.resource]: player.stats[effect.resource] + effect.cost,
        coinSources: withCoinSource(player.stats.coinSources, effect.source, Math.max(0, current - 1)),
      }
      return ok({
        state: withPlayerHand(state, { ...player, stats }),
        text: `${player.username}'s ${terms.techName} purchase was undone: ${terms.paidWith} returned and 1 coin removed`,
      })
    },
  }
  return definition
}

// -- The culture advance and its reward ---------------------------------------

const ROMAN = ['', 'I', 'II', 'III'] as const

/** "space 8 (culture II event)" or "space 7 (Great Person)". */
function describeSpace(space: CultureSpace): string {
  const what = space.kind === 'event' ? `culture ${ROMAN[space.level]} event` : 'Great Person'
  return `space ${space.step} (${what})`
}

/** "5 culture and 3 trade", "3 culture", or "nothing" when a discount took it all. */
function describeCost(cost: CultureAdvanceCost): string {
  const parts = [
    ...(cost.culture > 0 ? [`${cost.culture} culture`] : []),
    ...(cost.trade > 0 ? [`${cost.trade} trade`] : []),
  ]
  return parts.length === 0 ? 'nothing' : parts.join(' and ')
}

/** The deck a space draws from: its level's culture deck, or the Great Person deck. */
function rewardSheet(space: CultureSpace): SheetName {
  if (space.kind === 'greatPerson') return 'GREAT_PERSON'
  return space.level === 1 ? 'CULTURE_1' : space.level === 2 ? 'CULTURE_2' : 'CULTURE_3'
}

/** "culture II" or "Great Person", as the public line names the cards. */
function rewardLabel(space: Pick<CultureSpace, 'kind' | 'level'>): string {
  return space.kind === 'event' ? `culture ${ROMAN[space.level]}` : 'Great Person'
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/**
 * The pending rewards that still have a candidate in the hand. A choice whose
 * cards have all left (put back in the deck, traded, discarded by hand) has
 * nothing to choose any more: it blocks nothing and is not shown. Exported for
 * the projection.
 */
export function livePendingRewards(player: Playerhand): readonly PendingReward[] {
  return player.pendingRewards.filter((reward) =>
    reward.candidateIds.some((id) => player.items.some((item) => item.id === id)),
  )
}

interface AdvancePlan {
  readonly marker: CultureMarker
  readonly to: CultureSpace
  readonly cost: CultureAdvanceCost
  readonly count: number
  readonly sheetName: SheetName
}

/**
 * Whether the player can advance now, and onto what. The order of the checks is
 * the order the reasons are given in: phase, the marker, the end of the track, a
 * choice still waiting, the price, and last the deck, so the reason that comes
 * first is the one the player can do something about first.
 */
function planAdvance(state: GameState, player: Playerhand): Result<AdvancePlan, BlockedAvailability> {
  if (openCityManagementTurn(state, player) === undefined) return err(blocked('wrong-phase', PHASE_REASON))
  const marker = cultureMarkerOf(state, player)
  if (marker === undefined) {
    return err(blocked('unavailable', 'Your leader marker is not on the culture track.'))
  }
  const to = cultureSpaceAt(marker.step + 1)
  if (to === undefined) {
    return err(blocked('unavailable', 'Your marker is already on the Culture Victory space.'))
  }

  const cost = cultureAdvanceCost(state, player, to.step)
  const where = `Advance to ${describeSpace(to)}: ${describeCost(cost)}.`
  if (livePendingRewards(player).length > 0) {
    return err(blocked('unavailable', `${where} Choose the card to keep from your last advance first.`))
  }

  const lackingCulture = Math.max(0, cost.culture - player.stats.culture)
  const lackingTrade = Math.max(0, cost.trade - player.stats.trade)
  if (lackingCulture > 0 || lackingTrade > 0) {
    return err(
      blocked(
        'needs-resource',
        `${where} You are missing ${describeCost({ culture: lackingCulture, trade: lackingTrade })}.`,
      ),
    )
  }

  const sheetName = rewardSheet(to)
  const cardsLeft = [...state.items, ...state.discardedItems].some((item) => item.sheetName === sheetName)
  if (!cardsLeft) {
    return err(blocked('unavailable', `${where} There are no ${SHEET_LABEL[sheetName]} cards left to draw.`))
  }

  return ok({ marker, to, cost, count: rewardDrawCount(state, player, to.kind), sheetName })
}

/**
 * Takes up to `count` cards of one sheet off the deck, the way the Draw button
 * takes the first of the sheet and reshuffles the discards when the deck has none
 * of it. Without an item log line per card: a line carrying the item would make
 * the old item undo a way to take back one card of the choice. Fewer cards than
 * asked for is fine once the first one is drawn (there is nothing left to draw);
 * not even one is the reshuffle's own error.
 */
function drawCandidates(
  state: GameState,
  sheetName: SheetName,
  count: number,
): Result<{ readonly state: GameState; readonly items: readonly Item[] }, EngineError> {
  let current = state
  const items: Item[] = []
  for (let drawn = 0; drawn < count; drawn += 1) {
    let index = current.items.findIndex((item) => item.sheetName === sheetName)
    if (index < 0) {
      const reshuffled = reshuffleItems(current, sheetName)
      if (!reshuffled.ok) {
        if (items.length === 0) return reshuffled
        break
      }
      current = reshuffled.value
      index = current.items.findIndex((item) => item.sheetName === sheetName)
    }
    const item = current.items[index]
    if (item === undefined) break
    items.push(item)
    current = { ...current, items: [...current.items.slice(0, index), ...current.items.slice(index + 1)] }
  }
  return ok({ state: current, items })
}

/** Two shuffles of the deck, as an item undo does (`shuffleDeckTwice` in `actions/undo.ts`). */
function shuffleDeckTwice(state: GameState): GameState {
  const [once, afterFirst] = shuffle(state.items, state.rng)
  const [twice, rng] = shuffle(once, afterFirst)
  return { ...state, items: twice, rng }
}

const cultureAdvance: AssistedActionDefinition = {
  kind: 'cultureAdvance',
  techName: null,
  label: 'Culture advance',
  button: true,
  usageKey: null,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const plan = planAdvance(state, player)
    if (!plan.ok) return plan.error
    return {
      status: 'ready',
      reason: `Advance to ${describeSpace(plan.value.to)}: ${describeCost(plan.value.cost)}.`,
    }
  },

  apply(state, player, context) {
    const plan = planAdvance(state, player)
    if (!plan.ok) return err(rejected('cultureAdvance', plan.error))
    const { marker, to, cost, count, sheetName } = plan.value
    const failed = (reason: string): EngineError =>
      rejected('cultureAdvance', blocked('unavailable', reason))
    const at = context.at === undefined ? {} : { at: context.at }

    // The marker moves exactly one space, through the board's own move so the
    // history records it. Only the horizontal position changes, so it keeps its lane.
    const target = cultureCellCenter(state.board, to.step)
    const moved = movePieceUnchecked(state, {
      playerId: player.playerId,
      pieceId: marker.piece.id,
      x: Math.round(target.x - marker.piece.width / 2),
      y: marker.piece.y,
      snap: false,
      ...at,
    })
    const move = moved?.board.history.at(-1)
    const placed = moved?.board.pieces.find((piece) => piece.id === marker.piece.id)
    if (moved === undefined || move === undefined || placed === undefined) {
      return err(failed('Your leader marker could not be moved.'))
    }
    if (cultureStepOf(moved.board, placed) !== to.step) {
      return err(failed('Your leader marker could not be moved onto that space.'))
    }

    const drawn = drawCandidates(moved, sheetName, count)
    if (!drawn.ok) return drawn
    const candidates = drawn.value.items.map((item): Item => ({ ...item, ownerId: player.playerId, hidden: true }))

    const paying = playerOf(drawn.value.state, player.playerId) ?? player
    const resolved = candidates.length === 1
    const reward: PendingReward = {
      id: context.requestId,
      kind: to.kind,
      level: to.level,
      step: to.step,
      candidateIds: candidates.map((item) => item.id),
      keep: 1,
    }
    const paid = withPlayerHand(drawn.value.state, {
      ...paying,
      stats: {
        ...paying.stats,
        culture: paying.stats.culture - cost.culture,
        trade: paying.stats.trade - cost.trade,
      },
      items: [...paying.items, ...candidates],
      // A choice with no card left in the hand is dropped here, so it cannot pile up
      pendingRewards: resolved
        ? livePendingRewards(paying)
        : [...livePendingRewards(paying), reward],
    })

    const label = rewardLabel(to)
    const publicLine = appendLog(paid, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} advanced on the culture track to space ${to.step} ` +
        `and drew ${plural(candidates.length, `${label} card`)}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const logId = lastLogId(publicLine)
    const names = candidates.map(itemName).join(', ')
    const withPrivate = appendLog(publicLine, {
      username: player.username,
      playerId: player.playerId,
      privateLog: resolved
        ? `${player.username} drew ${names} (${SHEET_LABEL[sheetName]}) and kept it`
        : `${player.username} drew ${names} (${SHEET_LABEL[sheetName]}), keeps one`,
      createdAt: context.at ?? null,
    })
    // Reaching the last panel changes nothing else: no winner, no end of the game.
    const logged =
      to.step === CULTURE_VICTORY
        ? appendLog(withPrivate, {
            username: player.username,
            playerId: player.playerId,
            publicLog: `${player.username} has reached the Culture Victory space on the culture track`,
            createdAt: context.at ?? null,
          })
        : withPrivate

    // The marker move was recorded before the advance lines existed: count them in,
    // so stepping through the board history shows the move with the advance line
    // (reverseAssistedAction does the same for its own entry).
    const counted: GameState = {
      ...logged,
      board: {
        ...logged.board,
        history: logged.board.history.map((entry) =>
          entry.id === move.id ? { ...entry, logLength: logged.log.length } : entry,
        ),
      },
    }

    return ok({
      state: counted,
      effect: {
        kind: 'cultureAdvance',
        fromStep: marker.step,
        toStep: to.step,
        culture: cost.culture,
        trade: cost.trade,
        markerPieceId: marker.piece.id,
        markerFrom: { x: marker.piece.x, y: marker.piece.y },
        markerTo: { x: placed.x, y: placed.y },
        historyId: move.id,
        reward: to.kind,
        level: to.level,
        sheetName,
        drawn: reward.candidateIds,
        kept: resolved ? (reward.candidateIds[0] ?? null) : null,
      },
      logId,
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'cultureAdvance') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason,
    })

    // Everything is checked before anything is changed, so a refusal leaves the game as it was.
    const marker = state.board.pieces.find((piece) => piece.id === effect.markerPieceId)
    if (marker === undefined) {
      return err(refused('The leader marker is no longer on the board, so the advance cannot be undone.'))
    }
    if (cultureStepOf(state.board, marker) !== effect.toStep) {
      return err(
        refused(
          `The leader marker is no longer on space ${effect.toStep}. Move it back, or undo the later advances first.`,
        ),
      )
    }

    const inHand = (id: string): Item | undefined => player.items.find((item) => item.id === id)
    const inDiscard = (id: string): Item | undefined => state.discardedItems.find((item) => item.id === id)
    const inDeck = (id: string): boolean => state.items.some((item) => item.id === id)
    const toDeck: Item[] = []
    for (const id of effect.drawn) {
      // A kept card that has left the hand (traded, discarded) cannot be taken back, like a missing hut.
      const found = id === effect.kept ? inHand(id) : (inDiscard(id) ?? inHand(id))
      if (found !== undefined) {
        toDeck.push(found)
      } else if (!inDeck(id) || id === effect.kept) {
        return err({ kind: 'ITEM_NOT_FOUND', sheetName: effect.sheetName })
      }
    }

    const returnedIds = new Set(toDeck.map((item) => item.id))
    const withCards: GameState = {
      ...withPlayerHand(state, {
        ...player,
        stats: {
          ...player.stats,
          culture: player.stats.culture + effect.culture,
          trade: player.stats.trade + effect.trade,
        },
        items: player.items.filter((item) => !returnedIds.has(item.id)),
        pendingRewards: player.pendingRewards.filter((reward) => reward.id !== record.id),
      }),
      discardedItems: state.discardedItems.filter((item) => !returnedIds.has(item.id)),
      items: [...state.items, ...toDeck.map((item): Item => ({ ...item, hidden: true, ownerId: null }))],
    }
    const deck = toDeck.length === 0 ? withCards : shuffleDeckTwice(withCards)

    const movedBack = movePieceUnchecked(deck, {
      playerId: record.playerId,
      pieceId: effect.markerPieceId,
      x: effect.markerFrom.x,
      y: effect.markerFrom.y,
      snap: false,
      ...(at === null ? {} : { at }),
    })
    if (movedBack === undefined) return err(refused('The leader marker could not be moved back.'))

    return ok({
      state: movedBack,
      text:
        `${player.username}'s culture advance was undone: the leader marker is back on space ${effect.fromStep}, ` +
        `${describeCost(effect)} returned and the drawn cards were put back in the deck`,
    })
  },
}

const chooseReward: AssistedActionDefinition = {
  kind: 'chooseReward',
  techName: null,
  label: 'Choose reward',
  button: false,
  usageKey: null,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (player.pendingRewards.length === 0) {
      return blocked('unavailable', 'You have no card choice waiting.')
    }
    return { status: 'ready', reason: 'Choose the card to keep.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError =>
      rejected('chooseReward', blocked('unavailable', reason))
    const payload = context.payload
    if (payload === undefined) return err(failed('Say which reward and which card.'))

    const reward = player.pendingRewards.find((candidate) => candidate.id === payload.rewardId)
    if (reward === undefined) {
      return err(failed('That card choice is not waiting any more. It may already have been made.'))
    }
    if (!livePendingRewards(player).includes(reward)) {
      // Every candidate has left the hand: nothing is left to choose, so the entry
      // is removed instead of blocking the next advance for good.
      const cleared = withPlayerHand(state, {
        ...player,
        pendingRewards: player.pendingRewards.filter((candidate) => candidate.id !== reward.id),
      })
      const line = appendLog(cleared, {
        username: player.username,
        playerId: player.playerId,
        publicLog: `${player.username} had no card left to choose, so the card choice was dropped`,
        privateLog: '',
        createdAt: context.at ?? null,
      })
      return ok({
        state: line,
        effect: { kind: 'chooseReward', rewardId: reward.id, itemId: null },
        logId: lastLogId(line),
      })
    }
    if (!reward.candidateIds.includes(payload.itemId)) {
      return err(failed('That card is not one of the choices.'))
    }
    const kept = player.items.find((item) => item.id === payload.itemId)
    if (kept === undefined) return err(failed('That card is no longer in your hand.'))

    // The others leave the hand for the discard pile, as `discardItem` leaves them
    // (`hidden: true` is only the stored flag). The discard pile is public: the
    // revealed and discarded feed lists them by name, attributed to the player,
    // exactly as for any discard. Only the card kept stays secret.
    const others = player.items.filter(
      (item) => item.id !== kept.id && reward.candidateIds.includes(item.id),
    )
    const otherIds = new Set(others.map((item) => item.id))
    const discarded = withPlayerHand(
      {
        ...state,
        discardedItems: [...state.discardedItems, ...others.map((item): Item => ({ ...item, hidden: true }))],
        assistedActions: state.assistedActions.map((record) =>
          record.id === reward.id && record.effect.kind === 'cultureAdvance'
            ? { ...record, effect: { ...record.effect, kept: kept.id } }
            : record,
        ),
      },
      {
        ...player,
        items: player.items.filter((item) => !otherIds.has(item.id)),
        pendingRewards: player.pendingRewards.filter((candidate) => candidate.id !== reward.id),
      },
    )

    const publicLine = appendLog(discarded, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} kept a card`,
      privateLog: '',
      createdAt: context.at ?? null,
    })
    const logId = lastLogId(publicLine)
    const logged = appendLog(publicLine, {
      username: player.username,
      playerId: player.playerId,
      privateLog:
        `${player.username} kept ${itemName(kept)}` +
        (others.length === 0 ? '' : ` and discarded ${others.map(itemName).join(', ')}`),
      createdAt: context.at ?? null,
    })
    return ok({
      state: logged,
      effect: { kind: 'chooseReward', rewardId: reward.id, itemId: kept.id },
      logId,
    })
  },

  // Choosing is undone by undoing the advance, whose line is the one the vote targets.
  reverse(_state, _player, record) {
    return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
  },
}

/** Every assisted action, in the order the projection lists them. */
export const ASSISTED_ACTIONS: readonly AssistedActionDefinition[] = [
  ...RESOURCE_CULTURE_CARDS.map(resourceCultureCard),
  coinPurchase('democracy'),
  coinPurchase('printingPress'),
  cultureAdvance,
  chooseReward,
]

/** The actions that are buttons, in the order of `availableActions`. `chooseReward` answers a choice and is not one. */
export const ASSISTED_ACTION_KINDS: readonly AssistedActionKind[] = ASSISTED_ACTIONS.filter(
  (definition) => definition.button,
).map((definition) => definition.kind)

/**
 * Which assisted action belongs to which tech card, by the tech's name. The tech
 * dialog uses it to show the button for any registered card, so a new card needs
 * no change in the web code.
 */
export const ASSISTED_TECH_ACTIONS: ReadonlyMap<string, AssistedActionKind> = new Map(
  ASSISTED_ACTIONS.flatMap((definition): [string, AssistedActionKind][] =>
    definition.techName === null ? [] : [[definition.techName, definition.kind]],
  ),
)

/** Any registered action, buttons and `chooseReward` alike: what the route accepts. */
export function isAssistedActionKind(value: unknown): value is AssistedActionKind {
  return typeof value === 'string' && ASSISTED_ACTIONS.some((definition) => definition.kind === value)
}

const definitionOf = (kind: AssistedActionKind): AssistedActionDefinition | undefined =>
  ASSISTED_ACTIONS.find((definition) => definition.kind === kind)

const lastLogId = (state: GameState): string => state.log.at(-1)?.id ?? ''

/** The track's last position, the Culture Victory panel. */
const CULTURE_VICTORY = CULTURE_VICTORY_STEP

// ---------------------------------------------------------------------------
// Availability and the projection
// ---------------------------------------------------------------------------

/** Whether `kind` can be pressed by `playerId` right now, and why not when it cannot. */
export function assistedAvailability(
  state: GameState,
  playerId: string,
  kind: AssistedActionKind,
): AssistedAvailability {
  return (
    definitionOf(kind)?.availability(state, playerId) ??
    blocked('unavailable', 'Unknown action.')
  )
}

/**
 * The viewer's own button state, one entry per registered action. Meant for the
 * viewer's own `you` only: it depends on their hand and on which resource tokens
 * they hold.
 */
export function availableActionsFor(state: GameState, playerId: string): readonly AvailableAction[] {
  if (playerOf(state, playerId) === undefined) return []
  return ASSISTED_ACTIONS.filter((definition) => definition.button).map((definition) => ({
    action: definition.kind,
    label: definition.label,
    ...definition.availability(state, playerId),
  }))
}

/**
 * What everyone may read of the actions performed: who, when, the public line. No
 * effect. A choice of reward is left out: it is the answer to an advance that is
 * listed, and its line is not a target for an undo.
 */
export function publicAssistedActions(state: GameState): readonly PublicAssistedAction[] {
  return state.assistedActions.filter((record) => record.kind !== 'chooseReward').map((record) => ({
    id: record.id,
    kind: record.kind,
    label: definitionOf(record.kind)?.label ?? record.kind,
    playerId: record.playerId,
    username: playerOf(state, record.playerId)?.username ?? '',
    turnNumber: record.turnNumber,
    phase: record.phase,
    status: record.status,
    text: state.log.find((entry) => entry.id === record.logId)?.publicLog ?? '',
    logId: record.logId,
  }))
}

// ---------------------------------------------------------------------------
// Performing
// ---------------------------------------------------------------------------

export interface PerformAssistedActionInput {
  readonly playerId: string
  readonly action: AssistedActionKind
  /** Chosen by the client and kept until the request settles; makes a retry harmless. */
  readonly requestId: string
  /** ISO timestamp for the log and the board history. The engine itself stays pure. */
  readonly at?: string
  /** What `chooseReward` needs: which reward and which card. Other actions take none. */
  readonly payload?: ChooseRewardPayload
}

/**
 * Performs one assisted action, atomically: either every change is made or none
 * is. A `requestId` that is already recorded returns the state as it is, so a
 * retry, a refresh or a second tab cannot do it twice. A new `requestId` for an
 * action that is out of uses is refused with `status: 'used'`.
 */
export function performAssistedAction(
  state: GameState,
  input: PerformAssistedActionInput,
): Result<GameState, EngineError> {
  const definition = definitionOf(input.action)
  if (definition === undefined) {
    return err(rejected(String(input.action), blocked('unavailable', 'Unknown action.')))
  }
  const player = playerOf(state, input.playerId)
  if (player === undefined) return err({ kind: 'NO_ACCESS', playerId: input.playerId })
  if (input.requestId.trim() === '') {
    return err(rejected(input.action, blocked('unavailable', 'A request id is required.')))
  }

  const existing = state.assistedActions.find((record) => record.id === input.requestId)
  if (existing !== undefined) {
    if (existing.playerId === input.playerId && existing.kind === input.action) return ok(state)
    return err(rejected(input.action, blocked('unavailable', 'This request id was already used.')))
  }

  const availability = definition.availability(state, input.playerId)
  if (availability.status !== 'ready') return err(rejected(input.action, availability))

  const applied = definition.apply(state, player, {
    requestId: input.requestId,
    at: input.at,
    payload: input.payload,
  })
  if (!applied.ok) return applied

  const status = turnStatus(state)
  const record: AssistedActionRecord = {
    id: input.requestId,
    kind: input.action,
    playerId: input.playerId,
    turnNumber: status.currentTurn,
    // A reward can be chosen after City Management has closed; every other action needs it open
    phase: definition.kind === 'chooseReward' ? openPhaseOf(status, input.playerId) : 'CM',
    usageKey: definition.usageKey,
    at: input.at ?? null,
    logId: applied.value.logId,
    status: 'applied',
    effect: applied.value.effect,
  }
  return ok({ ...applied.value.state, assistedActions: [...applied.value.state.assistedActions, record] })
}

/** The phase the player is working on, for the record of an action that does not need City Management. */
const openPhaseOf = (status: ReturnType<typeof turnStatus>, playerId: string): TurnPhase =>
  status.players.find((candidate) => candidate.playerId === playerId)?.phase ?? 'CM'

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** The record an assisted log line reports, if it has one. */
export function assistedRecordOf(
  state: GameState,
  entry: GameLogEntry,
): AssistedActionRecord | undefined {
  if (entry.assistedActionId === undefined) return undefined
  return state.assistedActions.find((record) => record.id === entry.assistedActionId)
}

/** How an undo request or vote names the action: public, the same as its own line. */
export function assistedSubject(state: GameState, record: AssistedActionRecord): string {
  const label = definitionOf(record.kind)?.label ?? record.kind
  return `${label} used by ${playerOf(state, record.playerId)?.username ?? 'a player'}`
}

/**
 * Runs the reversal once the undo vote has passed: the stats, the exact token,
 * the usage key, the record marked `undone`, and a new public line saying what
 * was reversed. The original line stays. An action already undone is refused.
 */
export function reverseAssistedAction(
  state: GameState,
  recordId: string,
  at?: string,
): Result<GameState, EngineError> {
  const record = state.assistedActions.find((candidate) => candidate.id === recordId)
  if (record === undefined) return err({ kind: 'NOTHING_TO_UNDO', logId: recordId })
  if (record.status === 'undone') {
    return err({ kind: 'ASSISTED_ACTION_ALREADY_UNDONE', logId: record.logId })
  }
  const definition = definitionOf(record.kind)
  const player = playerOf(state, record.playerId)
  if (definition === undefined) return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: record.playerId })

  const reversed = definition.reverse(state, player, record, at ?? null)
  if (!reversed.ok) return reversed

  const current = playerOf(reversed.value.state, record.playerId) ?? player
  const freed =
    record.usageKey === null
      ? reversed.value.state
      : freeTurnAction(reversed.value.state, current, record.turnNumber, record.usageKey)
  const marked: GameState = {
    ...freed,
    assistedActions: freed.assistedActions.map((candidate) =>
      candidate.id === record.id ? { ...candidate, status: 'undone' as const } : candidate,
    ),
  }
  const logged = appendLog(marked, {
    username: 'System',
    publicLog: `System: ${reversed.value.text}`,
    createdAt: at ?? null,
  })
  // A board change the reversal made was recorded before this line existed: count
  // the line in, so stepping through the history shows it with the change (the
  // same as the start player line in `actions/board.ts`).
  if (logged.board.history.length === state.board.history.length) return ok(logged)
  const last = logged.board.history.at(-1)
  if (last === undefined) return ok(logged)
  return ok({
    ...logged,
    board: {
      ...logged.board,
      history: [...logged.board.history.slice(0, -1), { ...last, logLength: logged.log.length }],
    },
  })
}
