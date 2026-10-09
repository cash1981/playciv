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

import { removePiece } from './actions/board.js'
import { blockadedPieceIds } from './blockade.js'
import { areaAt, boardAreas, locationOf, playerAreas } from './board.js'
import type { BoardPiece } from './board.js'
import { activeWonderOwnerIds, coinSourcesOf, findCoinSource, withCoinSource } from './coins.js'
import type { EngineError } from './errors.js'
import { appendLog } from './log.js'
import { nextId } from './random.js'
import type { Result } from './result.js'
import { err, ok } from './result.js'
import type {
  AssistedActionKind,
  AssistedActionRecord,
  AssistedEffect,
  AssistedStatus,
  AvailableAction,
  GameLogEntry,
  GameState,
  Playerhand,
  PlayerStats,
  PublicAssistedAction,
  SpentResource,
} from './state.js'
import { publicTurn, publicTurnKey, sameTurn, turnStatus } from './turn.js'
import type { PlayerTurn } from './turn.js'

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

interface ApplyContext {
  readonly requestId: string
  readonly at: string | undefined
}

interface AssistedActionDefinition {
  readonly kind: AssistedActionKind
  readonly label: string
  readonly usageKey: string
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

// -- Chivalry ---------------------------------------------------------------

const CHIVALRY_CULTURE = 5
const CHIVALRY_RESOURCE = 'Incense'

const chivalry: AssistedActionDefinition = {
  kind: 'chivalry',
  label: 'Chivalry',
  usageKey: 'card:Chivalry',

  availability(state, playerId) {
    const player = playerOf(state, playerId)
    if (player === undefined) return blocked('unavailable', 'You are not a player in this game.')
    const tech = techBlock(player, 'Chivalry')
    if (tech !== undefined) return tech
    const turn = openCityManagementTurn(state, player)
    if (turn === undefined) return blocked('wrong-phase', PHASE_REASON)
    if (turn.usedActions.includes(chivalry.usageKey)) {
      return blocked('used', 'Chivalry has already been used this turn.')
    }
    if (findResourceToken(state, playerId, CHIVALRY_RESOURCE) === undefined) {
      return blocked(
        'needs-resource',
        'You need an Incense token: an Incense hut in your hand or an Incense piece in your player area.',
      )
    }
    return READY
  },

  apply(state, player, context) {
    const turn = openCityManagementTurn(state, player)
    const spend = spendResource(state, player.playerId, CHIVALRY_RESOURCE, context.at)
    if (turn === undefined || !spend.ok) {
      return err(
        rejected('chivalry', blocked('needs-resource', 'You need an Incense token to use Chivalry.')),
      )
    }
    const afterSpend = spend.value.state
    const paying = playerOf(afterSpend, player.playerId) ?? player
    const stats = { ...paying.stats, culture: paying.stats.culture + CHIVALRY_CULTURE }
    const used = useTurnAction(afterSpend, paying, turn, chivalry.usageKey, stats)
    const logged = appendLog(used, {
      username: player.username,
      playerId: player.playerId,
      publicLog: `${player.username} used Chivalry: spent 1 ${CHIVALRY_RESOURCE} and gained ${CHIVALRY_CULTURE} culture`,
      privateLog: '',
      createdAt: context.at ?? null,
      assistedActionId: context.requestId,
    })
    return ok({
      state: logged,
      effect: { kind: 'chivalry', culture: CHIVALRY_CULTURE, spent: spend.value.spent },
      logId: lastLogId(logged),
    })
  },

  reverse(state, player, record, at) {
    const effect = record.effect
    if (effect.kind !== 'chivalry') return err({ kind: 'NOTHING_TO_UNDO', logId: record.logId })
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
      text: `${player.username}'s Chivalry was undone: ${effect.culture} culture removed and the ${effect.spent.resource} token returned`,
    })
  },
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
    label: terms.techName,
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

/** Every assisted action, in the order the projection lists them. */
export const ASSISTED_ACTIONS: readonly AssistedActionDefinition[] = [
  chivalry,
  coinPurchase('democracy'),
  coinPurchase('printingPress'),
]

export const ASSISTED_ACTION_KINDS: readonly AssistedActionKind[] = ASSISTED_ACTIONS.map(
  (definition) => definition.kind,
)

export function isAssistedActionKind(value: unknown): value is AssistedActionKind {
  return typeof value === 'string' && (ASSISTED_ACTION_KINDS as readonly string[]).includes(value)
}

const definitionOf = (kind: AssistedActionKind): AssistedActionDefinition | undefined =>
  ASSISTED_ACTIONS.find((definition) => definition.kind === kind)

const lastLogId = (state: GameState): string => state.log.at(-1)?.id ?? ''

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
  return ASSISTED_ACTIONS.map((definition) => ({
    action: definition.kind,
    label: definition.label,
    ...definition.availability(state, playerId),
  }))
}

/** What everyone may read of the actions performed: who, when, the public line. No effect. */
export function publicAssistedActions(state: GameState): readonly PublicAssistedAction[] {
  return state.assistedActions.map((record) => ({
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

  const applied = definition.apply(state, player, { requestId: input.requestId, at: input.at })
  if (!applied.ok) return applied

  const turnNumber = turnStatus(state).currentTurn
  const record: AssistedActionRecord = {
    id: input.requestId,
    kind: input.action,
    playerId: input.playerId,
    turnNumber,
    phase: 'CM',
    usageKey: definition.usageKey,
    at: input.at ?? null,
    logId: applied.value.logId,
    status: 'applied',
    effect: applied.value.effect,
  }
  return ok({ ...applied.value.state, assistedActions: [...applied.value.state.assistedActions, record] })
}

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
  const freed = freeTurnAction(reversed.value.state, current, record.turnNumber, record.usageKey)
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
