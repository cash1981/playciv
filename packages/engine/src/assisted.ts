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
 * `state.ts`, and nothing computed at load time from the board actions. The
 * same goes for `build-options.ts`, which this file calls and which calls
 * `openCityManagementTurn` back.
 */

import { movePieceUnchecked, placeUnchecked, removePiece } from './actions/board.js'
import { reshuffleItems } from './actions/draw.js'
import { GREAT_PERSON_CARD_TYPES, blockadedPieceIds, cityFootprintsOf, mapCellOf } from './blockade.js'
import {
  AREA_LABEL_HEIGHT,
  CULTURE_VICTORY_STEP,
  areaAt,
  boardAreas,
  cultureCellCenter,
  cultureStepOf,
  findBoardAsset,
  locationOf,
  playerAreas,
  remainingBoardAssetCount,
} from './board.js'
import type { BoardPiece } from './board.js'
import {
  buildItemName,
  buildOptionsOf,
  buildSquareRefusal,
  figureAssetIdOf,
  sameBuildItem,
  squareCentre,
  squareLabel,
  unitSheetOf,
} from './build-options.js'
import type { BuildPayload, BuildSquare, PlacedBuildItem, UnitType } from './build-options.js'
import {
  buildingProgramMarkerOf,
  cityActionsOf,
  describeUpgrades,
  ownCityFootprint,
  upgradePlanOf,
} from './city-actions.js'
import { BUILDING_UPGRADES, buildingNameOf } from './building-data.js'
import { BUILDING_PROGRAM_ASSET_ID } from './city-production.js'
import { activeWonderOwnerIds, coinSourcesOf, findCoinSource, withCoinSource } from './coins.js'
import {
  cultureAdvanceCost,
  cultureMarkerOf,
  cultureSpaceAt,
  rewardDrawCount,
} from './culture-track.js'
import type { CultureAdvanceCost, CultureLevel, CultureMarker, CultureSpace } from './culture-track.js'
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
  GreatPersonMarker,
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
  // A confirmed repeat finds the key already there: it is never written twice, so
  // one undo of the key's last holder frees it (see `reverseAssistedAction`).
  const updatedTurn = turn.usedActions.includes(usageKey)
    ? turn
    : { ...turn, usedActions: [...turn.usedActions, usageKey] }
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

/** What `startBuildingProgram` carries: the city whose centre gets the marker. */
export interface StartBuildingProgramPayload {
  readonly cityPieceId: string
}

/**
 * What `upgradeBuildings` carries: the asset id of one basic building to flip
 * (`buildings/granary`), or nothing to flip every family that can be flipped.
 */
export interface UpgradeBuildingsPayload {
  readonly family?: string
}

/**
 * What an action may carry: `chooseReward` takes the reward and card, `build` takes
 * the city, item and square, `startBuildingProgram` the city and `upgradeBuildings`
 * an optional family.
 */
export type AssistedPayload =
  | ChooseRewardPayload
  | BuildPayload
  | StartBuildingProgramPayload
  | UpgradeBuildingsPayload

interface ApplyContext {
  readonly requestId: string
  readonly at: string | undefined
  /** Only `chooseReward`, `build`, `startBuildingProgram` and `upgradeBuildings` read it, each its own shape; every other action ignores it. */
  readonly payload: AssistedPayload | undefined
  /**
   * True when the action was `used` this turn and the player confirmed using it
   * again. It pays and applies as a first use; only the log line says so.
   */
  readonly confirmedRepeat: boolean
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

/** Added to the public line of a use the player confirmed after the card was used. */
const REPEAT_NOTE = ' (used again, confirmed by the player)'

/** The reason for `used`: it still blocks a plain press, but the player can override it. */
const usedReason = (label: string): string =>
  `${label} has already been used this turn. The rules allow it once per turn; you will be asked to confirm before using it again.`

export const PHASE_REASON = 'Only available during your open City Management phase.'

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
        return blocked('used', usedReason(card.techName))
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
        publicLog:
          `${player.username} used ${card.techName}: spent 1 ${card.resource} and gained ${card.culture} culture` +
          (context.confirmedRepeat ? REPEAT_NOTE : ''),
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
  allowRepeat = false,
): Result<CoinPurchasePlan, CoinPurchaseRejection> {
  const terms = COIN_PURCHASES[source]
  if (!player.techsChosen.some((tech) => tech.name === terms.techName && !tech.hidden)) {
    return err('TECH_NOT_REVEALED')
  }
  return planOpenCoinPurchase(state, player, source, allowRepeat)
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
  allowRepeat = false,
): Result<CoinPurchasePlan, OpenPurchaseRejection> {
  const terms = COIN_PURCHASES[source]
  const turn = openCityManagementTurn(state, player)
  if (turn === undefined) return err('PHASE_CLOSED')
  if (!allowRepeat && turn.usedActions.includes(coinUsageKey(source))) return err('ALREADY_USED')
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
  options: {
    readonly at?: string
    readonly requestId?: string
    /** The player confirmed using it again; only the assisted route passes it. */
    readonly confirmedRepeat?: boolean
  } = {},
): Result<{ readonly state: GameState; readonly logId: string }, EngineError> {
  const terms = COIN_PURCHASES[source]
  const plan = planCoinPurchase(state, player, source, options.confirmedRepeat === true)
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
    publicLog:
      `${player.username} spent ${terms.paidWith} to add 1 coin to ${terms.techName}` +
      (options.confirmedRepeat === true ? REPEAT_NOTE : ''),
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
          return blocked('used', usedReason(terms.techName))
        case 'INSUFFICIENT_RESOURCES':
          return blocked('needs-resource', `You need ${terms.paidWith} for this purchase.`)
        case 'AT_CAPACITY':
          return blocked('unavailable', `${terms.techName} is already at its coin capacity.`)
      }
    },

    apply(state, player, context) {
      const applied = applyCoinPurchase(state, player, source, {
        requestId: context.requestId,
        confirmedRepeat: context.confirmedRepeat,
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
  // A Great Person space with no card or no marker left still advances: the player receives nothing
  if (!cardsLeft && to.kind === 'event') {
    return err(blocked('unavailable', `${where} There are no ${SHEET_LABEL[sheetName]} cards left to draw.`))
  }

  return ok({ marker, to, cost, count: rewardDrawCount(state, player, to.kind), sheetName })
}

/**
 * Takes up to `count` cards of one sheet off the deck, the way the Draw button takes
 * the first of the sheet and reshuffles the discards when the deck has none of it.
 * Without an item log line per card: a line carrying the item would make the old
 * item undo a way to take back one card of the choice. Fewer cards than asked for is
 * fine once the first one is drawn (there is nothing left to draw); not even one is
 * the reshuffle's own error.
 *
 * With `filter` (the Great Person space) a card that is not valid is not drawn: it
 * is handed to `filter.reject`, which discards it and says so, and the draw goes on.
 * The rejected cards are kept aside and added to the discard pile at the end, so the
 * reshuffle cannot deal them again and the loop ends when the deck and the discards
 * are used up. Then even no card at all is a normal result, not an error.
 */
function drawCandidates(
  state: GameState,
  sheetName: SheetName,
  count: number,
  filter?: {
    readonly valid: (state: GameState, item: Item) => boolean
    readonly reject: (state: GameState, item: Item) => GameState
  },
): Result<
  {
    readonly state: GameState
    readonly items: readonly Item[]
    readonly rejected: readonly Item[]
    /** For each card taken, kept or rejected: the id of the card that stood right after it in `state.items` just before it was taken (`null` if it was last). */
    readonly positions: readonly { readonly itemId: string; readonly nextItemId: string | null }[]
  },
  EngineError
> {
  let current = state
  const items: Item[] = []
  const rejected: Item[] = []
  const positions: { itemId: string; nextItemId: string | null }[] = []
  while (items.length < count) {
    let index = current.items.findIndex((item) => item.sheetName === sheetName)
    if (index < 0) {
      const reshuffled = reshuffleItems(current, sheetName)
      if (!reshuffled.ok) {
        if (items.length === 0 && filter === undefined) return reshuffled
        break
      }
      current = reshuffled.value
      index = current.items.findIndex((item) => item.sheetName === sheetName)
    }
    const item = current.items[index]
    if (item === undefined) break
    positions.push({ itemId: item.id, nextItemId: current.items[index + 1]?.id ?? null })
    current = { ...current, items: [...current.items.slice(0, index), ...current.items.slice(index + 1)] }
    if (filter === undefined || filter.valid(current, item)) {
      items.push(item)
    } else {
      rejected.push(item)
      current = filter.reject(current, item)
    }
  }
  return ok({ state: current, items, rejected, positions })
}

/** Two shuffles of the deck, as an item undo does (`shuffleDeckTwice` in `actions/undo.ts`). */
function shuffleDeckTwice(state: GameState): GameState {
  const [once, afterFirst] = shuffle(state.items, state.rng)
  const [twice, rng] = shuffle(once, afterFirst)
  return { ...state, items: twice, rng }
}

// -- Great Person cards and their markers --------------------------------------

/**
 * The Great Person marker a card takes, by the card's `type`, through the table
 * the blockade rule already uses. A card whose type is not in the table has no
 * marker and is never valid.
 */
function markerAssetIdOf(item: Item): string | undefined {
  if (item.kind !== 'greatperson') return undefined
  return GREAT_PERSON_CARD_TYPES.find(([, cardType]) => cardType === item.type)?.[0]
}

/** Markers of one kind still in the supply: the box holds 3, and every piece on the board counts, in an area or not. */
function markersLeft(state: GameState, assetId: string): number {
  const asset = findBoardAsset(assetId)
  if (asset === undefined) return 0
  return remainingBoardAssetCount(asset, state.board.pieces, state.numOfPlayers) ?? 0
}

/** "scientist" or "merchant": the marker's artwork label, as the public line names a marker type. */
const markerLabelOf = (assetId: string): string =>
  (findBoardAsset(assetId)?.label ?? 'Great Person').toLowerCase()

/** True while at least one Great Person marker type still has a piece in the supply. */
const anyMarkerLeft = (state: GameState): boolean =>
  GREAT_PERSON_CARD_TYPES.some(([assetId]) => markersLeft(state, assetId) > 0)

/** A card is valid while the marker of its type is in the supply. */
function hasMarkerLeft(state: GameState, item: Item): boolean {
  const assetId = markerAssetIdOf(item)
  return assetId !== undefined && markersLeft(state, assetId) > 0
}

/** The player's own area, where a marker is put. */
const ownAreaOf = (state: GameState, playerId: string) =>
  playerAreas(state.board, state.players).find((area) => area.playerId === playerId)

/**
 * Puts the marker of `card`'s type in the player's own area, tidied into the next
 * free slot, as a board history entry. Not `placePiece`: the supply is checked
 * here, with a reason, and the caller has already checked access. `Err` carries a
 * sentence for the player; nothing is changed then.
 */
function takeGreatPersonMarker(
  state: GameState,
  player: Playerhand,
  card: Item,
  at: string | undefined,
): Result<{ readonly state: GameState; readonly marker: GreatPersonMarker }, string> {
  const assetId = markerAssetIdOf(card)
  if (assetId === undefined) return err('That card has no Great Person marker.')
  if (markersLeft(state, assetId) === 0) {
    return err(
      `No ${markerLabelOf(assetId)} marker is left. Choose another card, or take a ${markerLabelOf(assetId)} marker off the board first.`,
    )
  }
  const area = ownAreaOf(state, player.playerId)
  if (area === undefined) return err('You have no player area on the board to put the marker in.')

  const placed = placeUnchecked(state, {
    playerId: player.playerId,
    assetId,
    x: area.x + 20,
    y: area.y + AREA_LABEL_HEIGHT + 10,
    ...(at === undefined ? {} : { at }),
  })
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
    return err('The Great Person marker could not be placed.')
  }
  const piece = entry.change.piece
  return ok({
    state: placed,
    marker: { assetId, pieceId: piece.id, position: { x: piece.x, y: piece.y }, historyId: entry.id },
  })
}

/** Where a marker is checked before an undo: still on the board, and still in its owner's area. */
function markerUndoBlock(state: GameState, ownerId: string, marker: GreatPersonMarker): string | undefined {
  const piece = state.board.pieces.find((candidate) => candidate.id === marker.pieceId)
  if (piece === undefined) {
    return 'The Great Person marker is no longer on the board, so this cannot be undone.'
  }
  const inArea =
    areaAt(boardAreas(state.board, state.players), piece.x + piece.width / 2, piece.y + piece.height / 2)
      ?.playerId === ownerId
  if (!inArea) {
    return 'The Great Person marker has left its owner\'s player area. Move it back first.'
  }
  return undefined
}

/** Counts the lines written after a board change into its history entry, so stepping through the history shows them together. */
function countLinesIn(state: GameState, historyIds: readonly (string | undefined)[]): GameState {
  const ids = new Set(historyIds.filter((id): id is string => id !== undefined))
  return {
    ...state,
    board: {
      ...state.board,
      history: state.board.history.map((entry) =>
        ids.has(entry.id) ? { ...entry, logLength: state.log.length } : entry,
      ),
    },
  }
}

interface GreatPersonOrigin {
  readonly requestId: string
  readonly at: string | undefined
  /** Cards to draw: `rewardDrawCount` for the Great Person kind. */
  readonly count: number
  /** The Great Person space the advance moved onto. */
  readonly level: CultureLevel
  readonly step: number
}

/** The two reasons a Great Person space gives nothing, as the public line ends. */
const NONE_BECAUSE_NO_MARKER = 'gained no Great Person, because no marker was available'
const NONE_BECAUSE_NO_CARD = 'gained no Great Person, because no Great Person card could be drawn'

/** What gaining a Great Person did. The caller writes the public line with `phrase` and records `effect`. */
interface GreatPersonGain {
  readonly state: GameState
  readonly outcome: 'none' | 'kept' | 'choice'
  /** Ends the public line: "took a scientist great person marker into reserve", "drew 3 Great Person cards" or the reason nothing came. */
  readonly phrase: string
  /** The private line, naming the cards; empty when nothing secret happened. */
  readonly privateText: string
  readonly drawn: readonly string[]
  readonly rejected: readonly string[]
  readonly kept: string | null
  readonly marker: GreatPersonMarker | null
}

/**
 * Gaining a Great Person (Fame and Fortune p. 11 to 12), as the culture
 * advance's Great Person space does it: draw until `count` cards have a marker left, give
 * the valid cards to the hand hidden, and with exactly one take its marker at once;
 * with more, store a pending choice that `chooseReward` resolves. With no valid card
 * the player receives nothing. Pure: only a refusal to place the marker is an error.
 *
 * Faceup discard and redraw is only for a card whose own type is out while some type
 * is still available (p. 11 to 12). With no marker of any type left the player does not
 * receive a Great Person at all, so nothing is drawn: draining the deck would name every
 * card in a public line and leak which cards the hands hold.
 * Residual case, accepted as rare: some types have supply but every card still to draw is
 * of an exhausted type. The loop then names and discards those cards faceup, as the rule
 * does for each one drawn.
 */
function gainGreatPerson(
  state: GameState,
  player: Playerhand,
  origin: GreatPersonOrigin,
): Result<GreatPersonGain, string> {
  if (!anyMarkerLeft(state)) {
    return ok({
      state,
      outcome: 'none',
      phrase: NONE_BECAUSE_NO_MARKER,
      privateText: '',
      drawn: [],
      rejected: [],
      kept: null,
      marker: null,
    })
  }

  // The deck draw is the advance's own (`drawCandidates`, which reshuffles the discards
  // the way the Draw button does); only the validity filter is added. A rejected card
  // goes to the discard pile faceup, named in a public line.
  const drawnCards = drawCandidates(state, 'GREAT_PERSON', origin.count, {
    valid: hasMarkerLeft,
    reject: (current, item) => {
      const assetId = markerAssetIdOf(item)
      return appendLog(current, {
        username: player.username,
        playerId: player.playerId,
        publicLog:
          `${player.username} drew the Great Person card ${itemName(item)}, but ` +
          (assetId === undefined ? 'it has no marker type' : `no ${markerLabelOf(assetId)} marker is left`) +
          ', so it was discarded faceup',
        privateLog: '',
        createdAt: origin.at ?? null,
      })
    },
  })
  if (!drawnCards.ok) return err('No Great Person card could be drawn.')
  const discardedCards = drawnCards.value.rejected.map(
    (item): Item => ({ ...item, ownerId: player.playerId, hidden: true }),
  )
  const afterDraw: GameState = {
    ...drawnCards.value.state,
    discardedItems: [...drawnCards.value.state.discardedItems, ...discardedCards],
  }
  const rejectedIds = discardedCards.map((item) => item.id)
  const candidates = drawnCards.value.items.map((item): Item => ({ ...item, ownerId: player.playerId, hidden: true }))

  if (candidates.length === 0) {
    return ok({
      state: afterDraw,
      outcome: 'none',
      phrase: NONE_BECAUSE_NO_CARD,
      privateText: '',
      drawn: [],
      rejected: rejectedIds,
      kept: null,
      marker: null,
    })
  }

  const holder = playerOf(afterDraw, player.playerId) ?? player
  const reward: PendingReward = {
    id: origin.requestId,
    kind: 'greatPerson',
    level: origin.level,
    step: origin.step,
    candidateIds: candidates.map((item) => item.id),
    keep: 1,
  }
  const resolved = candidates.length === 1
  // A choice with no card left in the hand is dropped here, so it cannot pile up
  const pendingRewards = resolved
    ? livePendingRewards(holder)
    : [...livePendingRewards(holder), reward]
  const withHand = withPlayerHand(afterDraw, {
    ...holder,
    items: [...holder.items, ...candidates],
    pendingRewards,
  })
  const names = candidates.map(itemName).join(', ')
  const base = { drawn: reward.candidateIds, rejected: rejectedIds }

  if (!resolved) {
    return ok({
      ...base,
      state: withHand,
      outcome: 'choice',
      phrase: `drew ${plural(candidates.length, 'Great Person card')}`,
      privateText: `${player.username} drew ${names} (${SHEET_LABEL.GREAT_PERSON}), keeps one`,
      kept: null,
      marker: null,
    })
  }

  const [only] = candidates
  if (only === undefined) return err('No Great Person card was drawn.')
  const taken = takeGreatPersonMarker(withHand, player, only, origin.at)
  if (!taken.ok) return taken
  return ok({
    ...base,
    state: taken.value.state,
    outcome: 'kept',
    phrase: `took a ${markerLabelOf(taken.value.marker.assetId)} great person marker into reserve`,
    privateText: `${player.username} drew ${names} (${SHEET_LABEL.GREAT_PERSON}) and kept it`,
    kept: only.id,
    marker: taken.value.marker,
  })
}

/**
 * Takes the cards of a gain back to the deck: the kept one from the hand, the
 * rejected and discarded ones from the discard pile, a pending choice dropped, and
 * the deck shuffled twice the way an item undo does. Everything is checked first, so
 * a refusal changes nothing. A card that left the hand cannot be taken back, like a
 * missing hut.
 */
function restoreDrawnCards(
  state: GameState,
  player: Playerhand,
  recordId: string,
  ids: readonly string[],
  kept: string | null,
  sheetName: SheetName,
): Result<GameState, EngineError> {
  const inHand = (id: string): Item | undefined => player.items.find((item) => item.id === id)
  const inDiscard = (id: string): Item | undefined => state.discardedItems.find((item) => item.id === id)
  const inDeck = (id: string): boolean => state.items.some((item) => item.id === id)
  const toDeck: Item[] = []
  for (const id of ids) {
    const found = id === kept ? inHand(id) : (inDiscard(id) ?? inHand(id))
    if (found !== undefined) {
      toDeck.push(found)
    } else if (!inDeck(id) || id === kept) {
      return err({ kind: 'ITEM_NOT_FOUND', sheetName })
    }
  }

  const returnedIds = new Set(toDeck.map((item) => item.id))
  const withCards: GameState = {
    ...withPlayerHand(state, {
      ...player,
      items: player.items.filter((item) => !returnedIds.has(item.id)),
      pendingRewards: player.pendingRewards.filter((reward) => reward.id !== recordId),
    }),
    discardedItems: state.discardedItems.filter((item) => !returnedIds.has(item.id)),
    items: [...state.items, ...toDeck.map((item): Item => ({ ...item, hidden: true, ownerId: null }))],
  }
  return ok(toDeck.length === 0 ? withCards : shuffleDeckTwice(withCards))
}

/**
 * Takes a drawn unit card from the hand back into the deck, face down and without an
 * owner, and shuffles nothing. It goes right before the card that stood after it when
 * it was drawn (`card.nextItemId`), so another draw from above it, from any sheet,
 * does not move it behind a card of its own sheet. If that card has since left the
 * deck, it goes in front of the first card of its sheet that is left, or at the end of
 * the deck when there is none. A card that was the last one (`null`) goes back at the
 * end. The caller has checked that the card is in the hand.
 */
function restoreCardAt(
  state: GameState,
  player: Playerhand,
  card: { readonly itemId: string; readonly sheetName: SheetName; readonly nextItemId: string | null },
): GameState {
  const found = player.items.find((item) => item.id === card.itemId)
  if (found === undefined) return state
  const sheetFront = state.items.findIndex((item) => item.sheetName === card.sheetName)
  const neighbour = card.nextItemId === null ? -1 : state.items.findIndex((item) => item.id === card.nextItemId)
  const at =
    card.nextItemId === null
      ? state.items.length
      : neighbour >= 0
        ? neighbour
        : sheetFront >= 0
          ? sheetFront
          : state.items.length
  const restored: Item = { ...found, hidden: true, ownerId: null }
  return {
    ...withPlayerHand(state, { ...player, items: player.items.filter((item) => item.id !== card.itemId) }),
    items: [...state.items.slice(0, at), restored, ...state.items.slice(at)],
  }
}

/** Takes the marker of a gain off the board, through the board history. `Err` is the reason the undo must refuse. */
function removeGreatPersonMarker(
  state: GameState,
  record: AssistedActionRecord,
  marker: GreatPersonMarker,
  at: string | null,
): Result<GameState, string> {
  const removed = removePiece(state, {
    playerId: record.playerId,
    pieceId: marker.pieceId,
    ...(at === null ? {} : { at }),
  })
  return removed.ok ? ok(removed.value) : err('The Great Person marker could not be taken off the board.')
}

/** The sentence part for a removed marker, or an empty string. */
const removedMarkerText = (marker: GreatPersonMarker | null | undefined): string =>
  marker === null || marker === undefined ? '' : ` and the ${markerLabelOf(marker.assetId)} great person marker was removed`

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

    // A Great Person space goes through the Great Person step (valid cards, a marker);
    // a culture event draws as before.
    const paysWith = (state: GameState): GameState => {
      const paying = playerOf(state, player.playerId) ?? player
      return withPlayerHand(state, {
        ...paying,
        stats: {
          ...paying.stats,
          culture: paying.stats.culture - cost.culture,
          trade: paying.stats.trade - cost.trade,
        },
      })
    }
    const prefix = `${player.username} advanced on the culture track to space ${to.step} and `

    let paid: GameState
    let publicText: string
    let privateText: string
    let cards: {
      readonly drawn: readonly string[]
      readonly kept: string | null
      readonly extra: { readonly rejected: readonly string[]; readonly marker: GreatPersonMarker | null } | null
    }
    if (to.kind === 'greatPerson') {
      const gained = gainGreatPerson(moved, player, {
        requestId: context.requestId,
        at: context.at,
        count,
        level: to.level,
        step: to.step,
      })
      if (!gained.ok) return err(failed(gained.error))
      paid = paysWith(gained.value.state)
      publicText = prefix + gained.value.phrase
      privateText = gained.value.privateText
      cards = {
        drawn: gained.value.drawn,
        kept: gained.value.kept,
        extra: { rejected: gained.value.rejected, marker: gained.value.marker },
      }
    } else {
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
      paid = paysWith(
        withPlayerHand(drawn.value.state, {
          ...paying,
          items: [...paying.items, ...candidates],
          // A choice with no card left in the hand is dropped here, so it cannot pile up
          pendingRewards: resolved
            ? livePendingRewards(paying)
            : [...livePendingRewards(paying), reward],
        }),
      )
      const names = candidates.map(itemName).join(', ')
      publicText = prefix + `drew ${plural(candidates.length, `${rewardLabel(to)} card`)}`
      privateText = resolved
        ? `${player.username} drew ${names} (${SHEET_LABEL[sheetName]}) and kept it`
        : `${player.username} drew ${names} (${SHEET_LABEL[sheetName]}), keeps one`
      cards = { drawn: reward.candidateIds, kept: resolved ? (reward.candidateIds[0] ?? null) : null, extra: null }
    }

    const publicLine = appendLog(paid, {
      username: player.username,
      playerId: player.playerId,
      publicLog: publicText,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const logId = lastLogId(publicLine)
    const withPrivate =
      privateText === ''
        ? publicLine
        : appendLog(publicLine, {
            username: player.username,
            playerId: player.playerId,
            privateLog: privateText,
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
    // (reverseAssistedAction does the same for its own entry). So does the marker
    // a Great Person space put in the area.
    const counted = countLinesIn(logged, [move.id, cards.extra?.marker?.historyId])

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
        drawn: cards.drawn,
        kept: cards.kept,
        ...(cards.extra === null ? {} : cards.extra),
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

    // A Great Person space also put a marker in the owner's area, which has to be
    // there still. A record saved before the markers existed has none.
    const greatPersonMarker = effect.marker ?? null
    if (greatPersonMarker !== null) {
      const blockedBy = markerUndoBlock(state, record.playerId, greatPersonMarker)
      if (blockedBy !== undefined) return err(refused(blockedBy))
    }

    const paidBack: Playerhand = {
      ...player,
      stats: {
        ...player.stats,
        culture: player.stats.culture + effect.culture,
        trade: player.stats.trade + effect.trade,
      },
    }
    const restored = restoreDrawnCards(
      withPlayerHand(state, paidBack),
      paidBack,
      record.id,
      [...effect.drawn, ...(effect.rejected ?? [])],
      effect.kept,
      effect.sheetName,
    )
    if (!restored.ok) return restored

    let deck = restored.value
    if (greatPersonMarker !== null) {
      const removed = removeGreatPersonMarker(deck, record, greatPersonMarker, at)
      if (!removed.ok) return err(refused(removed.error))
      deck = removed.value
    }

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
        `${describeCost(effect)} returned and the drawn cards were put back in the deck` +
        removedMarkerText(greatPersonMarker),
    })
  },
}

// -- Build ---------------------------------------------------------------------

/** "a Library", "an Academy", "an army", "a mounted unit": by the first letter, with "a University" as the exception since it starts with a vowel but is said with a consonant. */
const withArticle = (label: string): string => `${/^[aeiou]/i.test(label) && !/^uni/i.test(label) ? 'an' : 'a'} ${label}`

/** The `build` payload, or `undefined` when the payload is another action's or missing. */
const buildPayloadOf = (payload: AssistedPayload | undefined): BuildPayload | undefined =>
  payload !== undefined && 'cityPieceId' in payload && 'item' in payload ? payload : undefined

/** What the part of a build that differs between items did: a piece put on a square, or a card drawn into the hand. */
type Made =
  | {
      readonly kind: 'placed'
      readonly state: GameState
      readonly square: { readonly column: number; readonly row: number; readonly label: string }
      readonly piece: BoardPiece
      readonly historyId: string
    }
  | {
      readonly kind: 'card'
      readonly state: GameState
      readonly card: Item
      readonly sheetName: SheetName
      /** The id of the card that stood right after it in the deck just before it was taken; `null` if it was last. */
      readonly nextItemId: string | null
    }

/**
 * Puts a building or a figure centred on its square, through the board history.
 * A building's asset is its own; a figure's is of the player's colour. `Err` is a
 * sentence for the player and nothing is changed.
 */
function placeBuilt(
  state: GameState,
  player: Playerhand,
  item: PlacedBuildItem,
  square: BuildSquare,
  at: { readonly at?: string },
): Result<Made, string> {
  const assetId =
    item.kind === 'building'
      ? item.assetId
      : player.color === null
        ? undefined
        : figureAssetIdOf(player.color.toLowerCase(), item.kind)
  const name = buildItemName(item)
  const asset = assetId === undefined ? undefined : findBoardAsset(assetId)
  if (assetId === undefined || asset === undefined) return err(`The ${name} has no artwork to put on the board.`)

  const centre = squareCentre(state.board, square)
  const placed = placeUnchecked(state, {
    playerId: player.playerId,
    assetId,
    x: centre.x - asset.width / 2,
    y: centre.y - asset.height / 2,
    ...at,
  })
  const entry = placed?.board.history.at(-1)
  if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
    return err(`The ${name} could not be placed.`)
  }
  const piece = entry.change.piece
  const landed = mapCellOf(placed.board, piece)
  if (landed === null || landed.column !== square.column || landed.row !== square.row) {
    return err(`The ${name} could not be placed on ${square.label}.`)
  }
  return ok({
    kind: 'placed',
    state: placed,
    square: { column: square.column, row: square.row, label: square.label },
    piece,
    historyId: entry.id,
  })
}

/**
 * Draws one card of the unit's sheet into the player's hand, hidden, the way the
 * Draw button does (the discards are reshuffled when the deck has none). Like the
 * Great Person cards it writes no item log line: a line carrying the item would
 * make the old item undo a way to take the card back without the trade and the
 * marker. `Err` is a sentence for the player.
 */
function drawBuiltUnit(state: GameState, player: Playerhand, unitType: UnitType): Result<Made, string> {
  const sheetName = unitSheetOf(unitType)
  const drawn = drawCandidates(state, sheetName, 1)
  const first = drawn.ok ? drawn.value.items[0] : undefined
  const position = drawn.ok ? drawn.value.positions.find((entry) => entry.itemId === first?.id) : undefined
  if (!drawn.ok || first === undefined || position === undefined) return err(`No ${unitType} unit cards are left in the deck or the discard pile.`)
  const card: Item = { ...first, ownerId: player.playerId, hidden: true }
  const holder = playerOf(drawn.value.state, player.playerId) ?? player
  return ok({
    kind: 'card',
    state: withPlayerHand(drawn.value.state, { ...holder, items: [...holder.items, card] }),
    card,
    sheetName,
    nextItemId: position.nextItemId,
  })
}

/**
 * A city builds a building, an army or scout figure, or a military unit.
 * Everything is decided from the fresh state: the options are recomputed for the
 * city and the request must be one of them, so a square taken, a supply used up,
 * trade spent or a phase closed since the player looked is refused with the
 * reason. One step puts the piece on its square or the card in the hand, pays
 * the trade, uses up the Building Program marker and writes the public line; one
 * undo vote takes all of it back. A unit has no square and its public line names
 * the type only, never the card.
 */
const build: AssistedActionDefinition = {
  kind: 'build',
  techName: null,
  label: 'Build',
  button: false,
  usageKey: null,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (openCityManagementTurn(state, player) === undefined) return blocked('wrong-phase', PHASE_REASON)
    if (player.color === null || cityFootprintsOf(state, player.color.toLowerCase()).length === 0) {
      return blocked('unavailable', 'You have no city on the map to build with.')
    }
    return { status: 'ready', reason: 'Choose a city, what to build and where.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError => rejected('build', blocked('unavailable', reason))
    const payload = buildPayloadOf(context.payload)
    if (payload === undefined) return err(failed('Say which city, what to build and which square.'))
    const { item } = payload
    // The server checks the shape; the engine is also called with whatever a caller sent
    if (!['building', 'army', 'scout', 'unit'].includes(item.kind)) {
      return err(failed('That is not something that can be built.'))
    }

    const city = buildOptionsOf(state, player).find((candidate) => candidate.cityPieceId === payload.cityPieceId)
    if (city === undefined) return err(failed('That city is not yours, or it is no longer on the map.'))
    if (city.status !== 'ready') return err(rejected('build', blocked('wrong-phase', city.reason)))

    const label = buildItemName(item)
    const choice = city.choices.find((candidate) => sameBuildItem(candidate.item, item))
    if (choice === undefined) {
      const why = city.unavailable.find((candidate) => sameBuildItem(candidate.item, item))
      return err(
        failed(
          why === undefined
            ? item.kind === 'building'
              ? `${item.assetId} is not a building that can be built.`
              : `A ${label} cannot be built.`
            : `${why.label} cannot be built in ${city.label} now. ${why.reason}`,
        ),
      )
    }

    // A square is chosen for a building or a figure and for nothing else
    let square: BuildSquare | undefined
    if (payload.item.kind === 'unit') {
      if (payload.target !== undefined) {
        return err(failed(`${choice.label} is a card and has no square. Send no square.`))
      }
    } else {
      const target = payload.target
      if (target === undefined) return err(failed('Pick one of the highlighted squares.'))
      square = choice.squares.find((candidate) => candidate.column === target.column && candidate.row === target.row)
      if (square === undefined) {
        const why = buildSquareRefusal(state, player, city.cityPieceId, payload.item, target)
        return err(failed(`${why ?? 'That square is not one of the legal squares.'} Pick one of the highlighted squares.`))
      }
    }
    if (choice.tradeToPay > 0 && payload.rush !== true) {
      return err(
        failed(
          `${choice.label} costs ${choice.cost} and ${city.label} has ${city.production}. Confirm paying ${choice.tradeToPay} trade to build it.`,
        ),
      )
    }
    const at = context.at === undefined ? {} : { at: context.at }

    // The marker a city with the Building Program must use (Wisdom and Warfare p. 7), found before anything is placed
    const footprint = ownCityFootprint(state, player, city.cityPieceId)
    const marker = footprint === undefined ? undefined : buildingProgramMarkerOf(state, footprint)

    // The one step that differs: a piece on a square, or a card in the hand
    let made: Made
    if (payload.item.kind === 'unit') {
      const drawn = drawBuiltUnit(state, player, payload.item.unitType)
      if (!drawn.ok) return err(failed(drawn.error))
      made = drawn.value
    } else {
      if (square === undefined) return err(failed('Pick one of the highlighted squares.'))
      const placed = placeBuilt(state, player, payload.item, square, at)
      if (!placed.ok) return err(failed(placed.error))
      made = placed.value
    }

    let board = made.state
    let removal: { readonly piece: BoardPiece; readonly historyId: string } | null = null
    if (marker !== undefined) {
      const removed = removePiece(made.state, { playerId: player.playerId, pieceId: marker.id, ...at })
      const removedEntry = removed.ok ? removed.value.board.history.at(-1) : undefined
      if (!removed.ok || removedEntry === undefined) {
        return err(failed('The Building Program marker could not be taken off the board.'))
      }
      board = removed.value
      removal = { piece: marker, historyId: removedEntry.id }
    }

    const paying = playerOf(board, player.playerId) ?? player
    const paid = withPlayerHand(board, {
      ...paying,
      stats: { ...paying.stats, trade: paying.stats.trade - choice.tradeToPay },
    })
    const where =
      made.kind === 'placed'
        ? ` on square ${made.square.label}` +
          (square?.note === undefined ? '' : ' (an enemy figure is there, so the outcome is to be settled by hand)')
        : ''
    const logged = appendLog(paid, {
      username: player.username,
      playerId: player.playerId,
      publicLog:
        `${player.username} built ${withArticle(label)} in ${city.label}${where}` +
        (choice.tradeToPay > 0 ? `, paying ${choice.tradeToPay} trade for the missing production` : '') +
        (removal === null ? '' : ', using up the Building Program marker'),
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    const logId = lastLogId(logged)
    // The card is named in a private line only, as the Great Person draw does; the public line has the type
    const withPrivate =
      made.kind === 'card'
        ? appendLog(logged, {
            username: player.username,
            playerId: player.playerId,
            privateLog: `${player.username} drew ${itemName(made.card)} (${SHEET_LABEL[made.sheetName]}) for ${withArticle(label)} built in ${city.label}`,
            createdAt: context.at ?? null,
          })
        : logged
    // The board changes were recorded before the line existed: count it in, as the culture advance does
    const counted = countLinesIn(withPrivate, [made.kind === 'placed' ? made.historyId : undefined, removal?.historyId])

    if (made.kind === 'card') {
      if (payload.item.kind !== 'unit') return err(failed('That is not a unit.'))
      return ok({
        state: counted,
        effect: {
          kind: 'build',
          cityPieceId: city.cityPieceId,
          item: payload.item,
          card: {
            itemId: made.card.id,
            sheetName: made.sheetName,
            nextItemId: made.nextItemId,
          },
          trade: choice.tradeToPay,
          marker: removal,
        },
        logId,
      })
    }
    if (payload.item.kind === 'unit') return err(failed('A unit is not put on a square.'))
    return ok({
      state: counted,
      effect: {
        kind: 'build',
        cityPieceId: city.cityPieceId,
        item: payload.item,
        square: made.square,
        pieceId: made.piece.id,
        position: { x: made.piece.x, y: made.piece.y },
        historyId: made.historyId,
        trade: choice.tradeToPay,
        marker: removal,
      },
      logId,
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'build') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason,
    })
    const label = buildItemName(effect.item)
    const refunded: Playerhand = {
      ...player,
      stats: { ...player.stats, trade: player.stats.trade + effect.trade },
    }
    const markerText = effect.marker === null ? '' : ' and the Building Program marker was put back'
    const tradeText = effect.trade > 0 ? `, ${effect.trade} trade returned` : ''

    if ('card' in effect) {
      // Everything is checked before anything is changed, so a refusal leaves the game as it was.
      if (!player.items.some((candidate) => candidate.id === effect.card.itemId)) {
        return err(refused(`The ${label} card is no longer in your hand, so the build cannot be undone.`))
      }
      // The same card goes back in front of the card that stood after it, and nothing is shuffled, so
      // the next draw returns the same card: build and undo is no way to redraw, and it
      // reveals no further card to the player.
      const restored = restoreCardAt(withPlayerHand(state, refunded), refunded, effect.card)
      const withMarker =
        effect.marker === null ? restored : placeBack(restored, refunded, effect.marker.piece, at)
      return ok({
        state: withMarker,
        text:
          `${player.username}'s ${label} was undone: the card was put back in the deck` +
          tradeText +
          markerText,
      })
    }

    // Everything is checked before anything is changed, so a refusal leaves the game as it was.
    const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
    if (piece === undefined) {
      return err(refused(`The ${label} is no longer on the board, so the build cannot be undone.`))
    }
    const cell = mapCellOf(state.board, piece)
    if (cell === null || cell.column !== effect.square.column || cell.row !== effect.square.row) {
      return err(refused(`The ${label} has left ${effect.square.label}. Move it back first.`))
    }

    const removed = removePiece(withPlayerHand(state, refunded), {
      playerId: record.playerId,
      pieceId: effect.pieceId,
      ...(at === null ? {} : { at }),
    })
    if (!removed.ok) return err(refused(`The ${label} could not be taken off the board.`))
    const restored =
      effect.marker === null ? removed.value : placeBack(removed.value, refunded, effect.marker.piece, at)

    return ok({
      state: restored,
      text:
        `${player.username}'s ${label} on ${effect.square.label} was undone: the ${effect.item.kind === 'building' ? 'building' : 'figure'} was removed` +
        tradeText +
        markerText,
    })
  },
}

// -- Start a Building Program -----------------------------------------------------

/** The `startBuildingProgram` payload, or `undefined` when the payload is another action's or missing. */
const startPayloadOf = (payload: AssistedPayload | undefined): StartBuildingProgramPayload | undefined =>
  payload !== undefined && 'cityPieceId' in payload && !('item' in payload) ? payload : undefined

/**
 * Puts the Building Program marker on a city's centre (Wisdom and Warfare p. 7), so
 * the next build there doubles the outskirts. Free, and a city holds one marker at a
 * time: a marker on either centre of a metropolis counts. The marker goes on the
 * anchor centre square through the board history. The build action uses the marker up
 * and restores it on its undo, so the two undo in either order as long as the marker
 * is back where it was: undoing the start while a build has used the marker up is
 * refused with the vote left open.
 */
const startBuildingProgram: AssistedActionDefinition = {
  kind: 'startBuildingProgram',
  techName: null,
  label: 'Start Building Program',
  button: false,
  usageKey: null,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    if (openCityManagementTurn(state, player) === undefined) return blocked('wrong-phase', PHASE_REASON)
    if (player.color === null || cityFootprintsOf(state, player.color.toLowerCase()).length === 0) {
      return blocked('unavailable', 'You have no city on the map to start a Building Program in.')
    }
    return { status: 'ready', reason: 'Choose a city.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError => rejected('startBuildingProgram', blocked('unavailable', reason))
    const payload = startPayloadOf(context.payload)
    if (payload === undefined) return err(failed('Say which city.'))

    const city = cityActionsOf(state, player).find((candidate) => candidate.cityPieceId === payload.cityPieceId)
    const footprint = ownCityFootprint(state, player, payload.cityPieceId)
    const anchor = footprint?.centers[0]
    if (city === undefined || anchor === undefined) return err(failed('That city is not yours, or it is no longer on the map.'))
    const option = city.startBuildingProgram
    if (option.status === 'wrong-phase') return err(rejected('startBuildingProgram', blocked('wrong-phase', option.reason)))
    if (option.status !== 'ready') return err(failed(`${city.label}: ${option.reason}`))

    const asset = findBoardAsset(BUILDING_PROGRAM_ASSET_ID)
    if (asset === undefined) return err(failed('The Building Program marker has no artwork to put on the board.'))
    const centre = squareCentre(state.board, anchor)
    const at = context.at === undefined ? {} : { at: context.at }
    const placed = placeUnchecked(state, {
      playerId: player.playerId,
      assetId: BUILDING_PROGRAM_ASSET_ID,
      x: centre.x - asset.width / 2,
      y: centre.y - asset.height / 2,
      ...at,
    })
    const entry = placed?.board.history.at(-1)
    if (placed === undefined || entry === undefined || entry.change.kind !== 'place') {
      return err(failed('The Building Program marker could not be placed.'))
    }
    const piece = entry.change.piece
    const landed = mapCellOf(placed.board, piece)
    if (landed === null || landed.column !== anchor.column || landed.row !== anchor.row) {
      return err(failed(`The Building Program marker could not be placed on the centre of ${city.label}.`))
    }

    const logged = appendLog(placed, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} started a Building Program in ${city.label}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: countLinesIn(logged, [entry.id]),
      effect: {
        kind: 'startBuildingProgram',
        cityPieceId: city.cityPieceId,
        cityLabel: city.label,
        square: { column: anchor.column, row: anchor.row, label: squareLabel(anchor) },
        pieceId: piece.id,
        position: { x: piece.x, y: piece.y },
        historyId: entry.id,
      },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'startBuildingProgram') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason,
    })
    // Everything is checked before anything is changed, so a refusal leaves the game as it was.
    const piece = state.board.pieces.find((candidate) => candidate.id === effect.pieceId)
    if (piece === undefined) {
      return err(
        refused(
          `The Building Program marker of ${effect.cityLabel} is no longer on the board (a build may have used it up), so this cannot be undone.`,
        ),
      )
    }
    const cell = mapCellOf(state.board, piece)
    if (cell === null || cell.column !== effect.square.column || cell.row !== effect.square.row) {
      return err(refused(`The Building Program marker has left the centre of ${effect.cityLabel}. Move it back first.`))
    }
    const removed = removePiece(state, {
      playerId: record.playerId,
      pieceId: effect.pieceId,
      ...(at === null ? {} : { at }),
    })
    if (!removed.ok) return err(refused('The Building Program marker could not be taken off the board.'))
    return ok({
      state: removed.value,
      text: `${player.username}'s Building Program in ${effect.cityLabel} was undone: the marker was removed`,
    })
  },
}

// -- Upgrade buildings -------------------------------------------------------------

/** The `upgradeBuildings` payload, or `undefined` when there is none or it is another action's. No payload means every family. */
const upgradePayloadOf = (payload: AssistedPayload | undefined): UpgradeBuildingsPayload | undefined =>
  payload !== undefined && 'family' in payload ? payload : undefined

/**
 * Flips the basic buildings of the player's cities to the upgraded form whose tech is
 * revealed (base rules p. 22): "they immediately flip over any of the corresponding
 * basic buildings that they've already produced in their cities". Each flipped
 * building keeps its square; the two forms share one supply, so the count never
 * changes, and nothing is paid, produced or marked as a city action. Allowed in any
 * phase of the player's turn, since the tech may be learned in Research. A flip is a
 * removal and a placement through the board history, per building, in board order.
 */
const upgradeBuildings: AssistedActionDefinition = {
  kind: 'upgradeBuildings',
  techName: null,
  label: 'Upgrade buildings',
  button: false,
  usageKey: null,

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const plan = upgradePlanOf(state, player)
    if (!plan.ok) return blocked('unavailable', plan.error)
    return { status: 'ready', reason: 'Choose what to upgrade.' }
  },

  apply(state, player, context) {
    const failed = (reason: string): EngineError => rejected('upgradeBuildings', blocked('unavailable', reason))
    const family = upgradePayloadOf(context.payload)?.family
    // The server checks the shape; the engine is also called with whatever a caller sent, and a bad family must not read as "all"
    if (family !== undefined && typeof family !== 'string') return err(failed('family must be the asset id of a basic building.'))
    const plan = upgradePlanOf(state, player, family)
    if (!plan.ok) return err(failed(plan.error))

    const at = context.at === undefined ? {} : { at: context.at }
    const flipped: Extract<AssistedEffect, { kind: 'upgradeBuildings' }>['flipped'][number][] = []
    let next = state
    for (const { piece, cell, upgradedAssetId } of plan.value) {
      const asset = findBoardAsset(upgradedAssetId)
      const name = buildItemName({ kind: 'building', assetId: upgradedAssetId })
      if (asset === undefined) return err(failed(`The ${name} has no artwork to put on the board.`))
      const removed = removePiece(next, { playerId: player.playerId, pieceId: piece.id, ...at })
      const removedEntry = removed.ok ? removed.value.board.history.at(-1) : undefined
      if (!removed.ok || removedEntry === undefined) {
        return err(failed(`The ${buildItemName({ kind: 'building', assetId: piece.assetId })} on ${squareLabel(cell)} could not be taken off the board.`))
      }
      // The two forms differ by a few pixels, so the centre is kept: the new piece stands on the same square
      const placed = placeUnchecked(removed.value, {
        playerId: player.playerId,
        assetId: upgradedAssetId,
        x: piece.x + piece.width / 2 - asset.width / 2,
        y: piece.y + piece.height / 2 - asset.height / 2,
        rotation: piece.rotation,
        ...at,
      })
      const placedEntry = placed?.board.history.at(-1)
      if (placed === undefined || placedEntry === undefined || placedEntry.change.kind !== 'place') {
        return err(failed(`The ${name} could not be placed on ${squareLabel(cell)}.`))
      }
      const created = placedEntry.change.piece
      const landed = mapCellOf(placed.board, created)
      if (landed === null || landed.column !== cell.column || landed.row !== cell.row) {
        return err(failed(`The ${name} could not be placed on ${squareLabel(cell)}.`))
      }
      flipped.push({
        from: piece,
        square: { column: cell.column, row: cell.row, label: squareLabel(cell) },
        pieceId: created.id,
        position: { x: created.x, y: created.y },
        removedHistoryId: removedEntry.id,
        placedHistoryId: placedEntry.id,
      })
      next = placed
    }

    const logged = appendLog(next, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} upgraded ${describeUpgrades(
        flipped.map((flip) => ({ basicAssetId: flip.from.assetId, squareLabel: flip.square.label })),
      )}`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: countLinesIn(logged, flipped.flatMap((flip) => [flip.removedHistoryId, flip.placedHistoryId])),
      effect: { kind: 'upgradeBuildings', flipped },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'upgradeBuildings') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
    const refused = (reason: string): EngineError => ({
      kind: 'ASSISTED_UNDO_BLOCKED',
      logId: record.logId,
      reason,
    })
    // Every upgraded piece is checked before anything is changed, so a refusal leaves the game as it was.
    for (const flip of effect.flipped) {
      const name = buildingNameOf(BUILDING_UPGRADES[flip.from.assetId] ?? flip.from.assetId) ?? 'upgraded building'
      const piece = state.board.pieces.find((candidate) => candidate.id === flip.pieceId)
      if (piece === undefined) {
        return err(refused(`The ${name} on ${flip.square.label} is no longer on the board, so the upgrade cannot be undone.`))
      }
      const cell = mapCellOf(state.board, piece)
      if (cell === null || cell.column !== flip.square.column || cell.row !== flip.square.row) {
        return err(refused(`The ${name} has left ${flip.square.label}. Move it back first.`))
      }
    }

    // In the order they were flipped, so the basic pieces keep their relative order on the board
    let next = state
    for (const flip of effect.flipped) {
      const removed = removePiece(next, {
        playerId: record.playerId,
        pieceId: flip.pieceId,
        ...(at === null ? {} : { at }),
      })
      if (!removed.ok) return err(refused(`The upgraded building on ${flip.square.label} could not be taken off the board.`))
      next = placeBack(removed.value, player, flip.from, at)
    }
    return ok({
      state: next,
      text:
        `${player.username}'s upgrade of ${describeUpgrades(
          effect.flipped.map((flip) => ({ basicAssetId: flip.from.assetId, squareLabel: flip.square.label })),
        )} was undone: the basic buildings were put back`,
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
    const payload =
      context.payload !== undefined && 'rewardId' in context.payload ? context.payload : undefined
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

    // A Great Person is kept together with its marker. A reward from before the
    // markers existed (its record has no `rejected` list) keeps the old, by-hand step.
    const origin = state.assistedActions.find((record) => record.id === reward.id)
    const takesMarker =
      reward.kind === 'greatPerson' &&
      origin !== undefined &&
      origin.effect.kind === 'cultureAdvance' &&
      origin.effect.rejected !== undefined
    let board = state
    let marker: GreatPersonMarker | null = null
    if (takesMarker) {
      const taken = takeGreatPersonMarker(state, player, kept, context.at)
      if (!taken.ok) return err(failed(taken.error))
      board = taken.value.state
      marker = taken.value.marker
    }

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
        ...board,
        discardedItems: [...board.discardedItems, ...others.map((item): Item => ({ ...item, hidden: true }))],
        assistedActions: board.assistedActions.map((record) =>
          record.id === reward.id && record.effect.kind === 'cultureAdvance'
            ? {
                ...record,
                effect: { ...record.effect, kept: kept.id, ...(marker === null ? {} : { marker }) },
              }
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
      publicLog:
        marker === null
          ? `${player.username} kept a card`
          : `${player.username} took a ${markerLabelOf(marker.assetId)} great person marker into reserve`,
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
      state: countLinesIn(logged, [marker?.historyId]),
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
  build,
  startBuildingProgram,
  upgradeBuildings,
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
    ...(record.confirmedRepeat === true ? { confirmedRepeat: true } : {}),
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
  /** What `chooseReward` needs (which reward and which card) or `build` needs (which city, item and square). Other actions take none. */
  readonly payload?: AssistedPayload
  /**
   * The player answered yes to "you have already used this, use it again?". It
   * lifts exactly one refusal, `used`; every other refusal stands.
   */
  readonly confirmedRepeat?: boolean
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
  // Some Great Persons and culture cards allow a second use and are not built, so
  // the player may override `used` and nothing else. The reducers re-check the
  // rest (resource, capacity, cost) when they apply.
  const repeat = availability.status === 'used' && input.confirmedRepeat === true
  if (availability.status !== 'ready' && !repeat) return err(rejected(input.action, availability))

  const applied = definition.apply(state, player, {
    requestId: input.requestId,
    at: input.at,
    payload: input.payload,
    confirmedRepeat: repeat,
  })
  if (!applied.ok) return applied

  const status = turnStatus(state)
  const record: AssistedActionRecord = {
    id: input.requestId,
    kind: input.action,
    playerId: input.playerId,
    turnNumber: status.currentTurn,
    // A reward can be chosen after City Management has closed, and an upgrade is done in whatever phase the tech was learned in; every other action needs it open
    phase:
      definition.kind === 'chooseReward' || definition.kind === 'upgradeBuildings'
        ? openPhaseOf(status, input.playerId)
        : 'CM',
    usageKey: definition.usageKey,
    at: input.at ?? null,
    logId: applied.value.logId,
    status: 'applied',
    effect: applied.value.effect,
    ...(repeat ? { confirmedRepeat: true } : {}),
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
  const marked: GameState = {
    ...reversed.value.state,
    assistedActions: reversed.value.state.assistedActions.map((candidate) =>
      candidate.id === record.id ? { ...candidate, status: 'undone' as const } : candidate,
    ),
  }
  // A confirmed repeat shares the first use's key, so the key is freed only when no
  // other applied record of this player and turn still holds it.
  const stillHeld = marked.assistedActions.some(
    (candidate) =>
      candidate.status === 'applied' &&
      candidate.playerId === record.playerId &&
      candidate.turnNumber === record.turnNumber &&
      candidate.usageKey === record.usageKey,
  )
  const freed =
    record.usageKey === null || stillHeld
      ? marked
      : freeTurnAction(marked, current, record.turnNumber, record.usageKey)
  const logged = appendLog(freed, {
    username: 'System',
    publicLog: `System: ${reversed.value.text}`,
    createdAt: at ?? null,
  })
  // The board changes the reversal made were recorded before this line existed:
  // count the line in, so stepping through the history shows them with it (the
  // same as the start player line in `actions/board.ts`).
  const firstNew = state.board.history.length
  if (logged.board.history.length === firstNew) return ok(logged)
  return ok({
    ...logged,
    board: {
      ...logged.board,
      history: logged.board.history.map((entry, index) =>
        index < firstNew ? entry : { ...entry, logLength: logged.log.length },
      ),
    },
  })
}
