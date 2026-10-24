/**
 * What every assisted action shares: the definition type, the availability
 * vocabulary, and the helpers that write a turn's usage keys. Split out of
 * `assisted.ts` so the action files (`assisted.ts`, `assisted-cards.ts` and the
 * Start of Turn files) can use them without importing each other in a circle.
 *
 * Like `assisted.ts`, this file imports only types from `state.ts` and nothing
 * from the board actions, so it is safe inside the `state.ts` import cycle that
 * `assisted.ts` documents. Keep it that way.
 */

import { boardAreas, locationOf } from './board.js'
import type { BoardPiece } from './board.js'
import type { BuildPayload } from './build-options.js'
import type { CultureLevel } from './culture-track.js'
import type { EngineError } from './errors.js'
import type { Government } from './government.js'
import { nextId } from './random.js'
import type { Result } from './result.js'
import type { SheetName } from './sheet-name.js'
import type {
  AssistedActionKind,
  AssistedActionRecord,
  AssistedEffect,
  AssistedStatus,
  GameState,
  InvestmentCard,
  Playerhand,
  PlayerStats,
} from './state.js'
import { publicTurn, publicTurnKey, sameTurn, turnStatus } from './turn.js'
import type { PlayerTurn, TurnPhase } from './turn.js'

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
export const ROMAN = ['', 'I', 'II', 'III'] as const

export const levelSheet = (level: CultureLevel): SheetName =>
  level === 1 ? 'CULTURE_1' : level === 2 ? 'CULTURE_2' : 'CULTURE_3'

// These two read the player list directly, so this module does not need the
// value exports of `state.ts`, which in turn builds the projection from here.
export const playerOf = (state: GameState, playerId: string): Playerhand | undefined =>
  state.players.find((player) => player.playerId === playerId)

export const withPlayerHand = (state: GameState, player: Playerhand): GameState => ({
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
  | { readonly status: 'ready'; readonly reason: string; readonly warning?: string }
  | BlockedAvailability

export const READY: AssistedAvailability = { status: 'ready', reason: 'Ready to use.' }

export const blocked = (
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
export function useTurnAction(
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
  // The record does not exist yet in a Start of Turn before the player wrote or marked anything
  const known = player.playerTurns.some((candidate) => sameTurn(candidate, updatedTurn))
  const playerTurns = known
    ? player.playerTurns.map((candidate) => (sameTurn(candidate, updatedTurn) ? updatedTurn : candidate))
    : [...player.playerTurns, updatedTurn]
  return {
    ...withPlayerHand(state, { ...player, playerTurns, stats }),
    publicTurns: { ...state.publicTurns, [publicTurnKey(updatedTurn)]: publicTurn(updatedTurn) },
  }
}

/** The inverse of {@link useTurnAction}'s usage key: frees the use on that turn. */
export function freeTurnAction(
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

export interface Applied {
  readonly state: GameState
  readonly effect: AssistedEffect
  /** The public line the action wrote, the last one in the log. */
  readonly logId: string
}

export interface Reversed {
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
 * What `devoteToTheArts` carries: the city, the scouts whose squares are sent to it, and
 * optionally the culture the player typed instead of the estimate.
 */
export interface DevoteToTheArtsPayload {
  readonly cityPieceId: string
  readonly scoutPieceIds?: readonly string[]
  readonly culture?: number
}

/** What `harvest` carries: the city, the resource, and the scout when the resource is under one rather than in the outskirts. */
export interface HarvestPayload {
  readonly cityPieceId: string
  readonly resource: string
  readonly scoutPieceId?: string
}

/**
 * What `upgradeBuildings` carries: the asset id of one basic building to flip
 * (`buildings/granary`), or nothing to flip every family that can be flipped.
 */
export interface UpgradeBuildingsPayload {
  readonly family?: string
}

/**
 * What `playCard` carries: the card, the players it names (a card that names every
 * other player ignores them) and the resource it is played as, when it has one.
 */
export interface PlayCardPayload {
  readonly itemId: string
  readonly targets: readonly string[]
  readonly resource?: string
}

/**
 * What an action may carry: `chooseReward` takes the reward and card, `build` takes
 * the city, item and square, `startBuildingProgram` the city, `upgradeBuildings`
 * an optional family and `playCard` the card, who it names and its resource.
 */
/** What `switchGovernment` carries: the government to become, or `Anarchy`. */
export interface GovernmentPayload {
  readonly government: Government
}

/** What `invest` carries: the coin counter the coin comes from, and the card that gets the marker. */
export interface InvestPayload {
  readonly source: string
  readonly card: InvestmentCard
}

/** What `feudalismHarvest` carries: the city whose outskirts are harvested, and the resource. */
export interface FeudalismHarvestPayload {
  readonly cityPieceId: string
  readonly resource: string
}

/** What `foundCity` carries: the figure that stands where the city goes. */
export interface FoundCityPayload {
  readonly figurePieceId: string
}

/** What `assignScout` carries: the scout, and the city to send its square to (`null` stops it). */
export interface AssignScoutPayload {
  readonly scoutPieceId: string
  readonly cityPieceId: string | null
}

export type AssistedPayload =
  | ChooseRewardPayload
  | BuildPayload
  | StartBuildingProgramPayload
  | DevoteToTheArtsPayload
  | HarvestPayload
  | UpgradeBuildingsPayload
  | PlayCardPayload
  | GovernmentPayload
  | InvestPayload
  | FeudalismHarvestPayload
  | FoundCityPayload
  | AssignScoutPayload

export interface ApplyContext {
  readonly requestId: string
  readonly at: string | undefined
  /** Only `chooseReward`, `build`, `startBuildingProgram`, `upgradeBuildings` and `playCard` read it, each its own shape; every other action ignores it. */
  readonly payload: AssistedPayload | undefined
  /**
   * True when the action was `used` this turn and the player confirmed using it
   * again. It pays and applies as a first use; only the log line says so.
   */
  readonly confirmedRepeat: boolean
  /**
   * The player answered yes to "this city has already acted this turn, act again?". Read only by the
   * four city actions, which refuse a second action of one city without it.
   */
  readonly confirmedAnotherCityAction: boolean
}

export type AssistedActionDefinition = {
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
  /**
   * The phase tab the action belongs to, and that must be open to press it. `'ANY'`
   * is for an action that is not bound to one phase (it works whenever the tech or
   * card allows); its record then keeps the phase the player is working on.
   */
  readonly phase: TurnPhase | 'ANY'
  /** The heading the action is listed under in its tab. */
  readonly group: string
  /** What the button says when "Use <label>" is not it ("Draw two level II events"). */
  readonly buttonText?: string
  /**
   * What an applied record is called in the public list and in an undo request, when
   * that is more than the action's label (a card played is called by its name).
   * Public, so it may name only what the log line already named.
   */
  readonly labelOf?: (record: AssistedActionRecord) => string
  /**
   * The rule allows it once and nothing grants another use (a government change, the
   * invested coin, a social policy, a wonder), so a player cannot override `used` by
   * confirming and the button is disabled instead.
   */
  readonly strictOnce?: boolean
  availability(state: GameState, playerId: string): AssistedAvailability
  apply(state: GameState, player: Playerhand, context: ApplyContext): Result<Applied, EngineError>
  /**
   * Takes the action back. `pieceMayHaveMoved` is set when the owner removes the
   * placed piece by hand: the piece is then wherever it was moved to, so a build
   * and a Building Program start do not insist that it is still on its square.
   */
  reverse(
    state: GameState,
    player: Playerhand,
    record: AssistedActionRecord,
    at: string | null,
    pieceMayHaveMoved?: boolean,
  ): Result<Reversed, EngineError>
}

export const rejected = (action: string, availability: BlockedAvailability): EngineError => ({
  kind: 'ASSISTED_ACTION_REJECTED',
  action,
  status: availability.status,
  reason: availability.reason,
})

/** The tech must be chosen, and revealed because a hidden one is private. */
export function techBlock(player: Playerhand, techName: string): BlockedAvailability | undefined {
  const tech = player.techsChosen.find((candidate) => candidate.name === techName)
  if (tech === undefined) return blocked('not-owned', `You do not have ${techName}.`)
  if (tech.hidden) return blocked('unavailable', `Reveal ${techName} before using it.`)
  return undefined
}

/** Added to the public line of a use the player confirmed after the card was used. */
export const REPEAT_NOTE = ' (used again, confirmed by the player)'

/** The reason for `used`: it still blocks a plain press, but the player can override it. */
export const usedReason = (label: string): string =>
  `${label} has already been used this turn. The rules allow it once per turn; you will be asked to confirm before using it again.`

export const PHASE_REASON = 'Only available during your open City Management phase.'

export const lastLogId = (state: GameState): string => state.log.at(-1)?.id ?? ''

/**
 * Why a free tech cannot be taken back, or `undefined` when it can. A grant that a tech was learned with
 * stays on the player marked with that tech (`usedFor`): removing the tech frees it again, so the
 * refusal says what to do and it works.
 */
export function grantUndoBlock(player: Playerhand, grantId: string): string | undefined {
  const grant = player.techGrants.find((candidate) => candidate.id === grantId)
  if (grant === undefined) return 'The free tech this gave is no longer on your list, so it cannot be taken back.'
  return grant.usedFor === undefined
    ? undefined
    : `You learned ${grant.usedFor} with it. Remove ${grant.usedFor} first, then undo this.`
}

/**
 * Puts the exact piece back, same id and same place, as a board history entry
 * so the history bar and board replay see it. It lands on top of the stack, which
 * is what replaying a `place` change does. Not through `placePiece`: that would
 * make a new piece, snap it into the next free slot and refuse it when the
 * supply count is full, and an undo must not be refused halfway.
 */
export function placeBack(
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

/** The assisted actions that are a city's action for the turn (base rules p. 15: build, devote to the arts or harvest; W&W p. 7: start a Building Program). */
export const CITY_ACTION_LABELS: Readonly<Partial<Record<AssistedActionKind, string>>> = {
  build: 'Build',
  startBuildingProgram: 'Start Building Program',
  devoteToTheArts: 'Devote to the Arts',
  harvest: 'Harvest',
}

/**
 * The city actions this city has taken this turn that are still in force (not undone), by name, oldest
 * first. A city may take one a turn as a rule; the game does not forbid more, it asks first.
 */
export function cityActionsTakenThisTurn(state: GameState, player: Playerhand, cityPieceId: string): readonly string[] {
  const turn = turnStatus(state).currentTurn
  return state.assistedActions.flatMap((record) => {
    const label = CITY_ACTION_LABELS[record.kind]
    const effect = record.effect
    if (
      label === undefined ||
      record.status !== 'applied' ||
      record.playerId !== player.playerId ||
      record.turnNumber !== turn ||
      !('cityPieceId' in effect) ||
      effect.cityPieceId !== cityPieceId
    ) {
      return []
    }
    return [label]
  })
}

export const SECOND_ACTION_NOTE = ' (a second action of this city this turn, confirmed by the player)'

/**
 * What the city's earlier actions this turn mean for one more: nothing to say, a note for the log
 * when the player confirmed it, or the refusal that makes the client ask first.
 */
export function earlierCityActions(
  state: GameState,
  player: Playerhand,
  city: { readonly cityPieceId: string; readonly label: string },
  confirmed: boolean,
): { readonly refusal: BlockedAvailability | undefined; readonly note: string } {
  const taken = cityActionsTakenThisTurn(state, player, city.cityPieceId)
  if (taken.length === 0) return { refusal: undefined, note: '' }
  if (confirmed) return { refusal: undefined, note: SECOND_ACTION_NOTE }
  return {
    refusal: blocked(
      'used',
      `${city.label} has already acted this turn (${taken.join(', ')}). A city takes one action each turn; you are asked to confirm before it takes another.`,
    ),
    note: '',
  }
}
