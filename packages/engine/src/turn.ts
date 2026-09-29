/**
 * Port of `no.asgari.civilization.server.model.PlayerTurn`.
 *
 * A turn has five phases. Each phase holds the current order and the history
 * of the versions its owner has *revealed*, so the players can see what was
 * published before. Saving never creates a version.
 *
 * `TurnKey.java` is not ported. It was an attempt at a composite key for
 * `publicTurns`, but Java could not get Jackson to serialise the map and ended
 * up concatenating `turnNumber + username` into a string. That string is kept
 * as the key format.
 */

import type { GameState, Playerhand } from './state.js'

export const TURN_PHASES = ['SOT', 'TRADE', 'CM', 'MOVEMENT', 'RESEARCH'] as const
export type TurnPhase = (typeof TURN_PHASES)[number]

export const TURN_PHASE_LABEL: Readonly<Record<TurnPhase, string>> = {
  SOT: 'start of turn',
  TRADE: 'trade',
  CM: 'city management',
  MOVEMENT: 'movement',
  RESEARCH: 'research',
}

/** One version of a phase its owner has published, and when they did it. */
export interface TurnOrderVersion {
  readonly markdown: string
  /** ISO timestamp supplied by the caller; the engine stays pure. */
  readonly at: string
}

export interface PlayerTurn {
  readonly turnNumber: number
  readonly username: string
  /** Java: `disabled` — set once the player has locked the turn. */
  readonly disabled: boolean
  readonly orders: Readonly<Record<TurnPhase, string>>
  /** Each phase is published independently by the player who owns the turn. */
  readonly revealed: Readonly<Record<TurnPhase, boolean>>
  /**
   * Chat orders (issue #215): the player has marked the phase finished. Kept
   * apart from `revealed` because a phase can take several messages, so
   * sending an order does not mean the phase is done. Public, like `revealed`.
   */
  readonly done: Readonly<Record<TurnPhase, boolean>>
  /**
   * Every version the owner has revealed for the phase, oldest first. Java kept
   * a `Set<String>` of *saved* orders here; that save-based history is replaced
   * by the reveal history, because only a reveal is public information.
   */
  readonly history: Readonly<Record<TurnPhase, readonly TurnOrderVersion[]>>
}

const emptyOrders = (): Record<TurnPhase, string> => ({
  SOT: '',
  TRADE: '',
  CM: '',
  MOVEMENT: '',
  RESEARCH: '',
})

const emptyHistory = (): Record<TurnPhase, readonly TurnOrderVersion[]> => ({
  SOT: [],
  TRADE: [],
  CM: [],
  MOVEMENT: [],
  RESEARCH: [],
})

const emptyRevealed = (): Record<TurnPhase, boolean> => ({
  SOT: false,
  TRADE: false,
  CM: false,
  MOVEMENT: false,
  RESEARCH: false,
})

const emptyDone = (): Record<TurnPhase, boolean> => ({
  SOT: false,
  TRADE: false,
  CM: false,
  MOVEMENT: false,
  RESEARCH: false,
})

export function createPlayerTurn(username: string, turnNumber: number): PlayerTurn {
  return {
    turnNumber,
    username,
    disabled: false,
    orders: emptyOrders(),
    revealed: emptyRevealed(),
    done: emptyDone(),
    history: emptyHistory(),
  }
}

/** Java: `equals` on PlayerTurn used turnNumber plus username. */
export function sameTurn(a: PlayerTurn, b: PlayerTurn): boolean {
  return a.turnNumber === b.turnNumber && a.username === b.username
}

/**
 * Java's `String.compareTo` compares UTF-16 code units rather than following
 * locale rules. That puts "Karandras1" before "cash1981", because capitals have
 * lower code points. `localeCompare` gives the opposite order.
 */
export function compareJavaStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/** Java: `compareTo` sorted on turn number, then username. */
export function compareTurns(a: PlayerTurn, b: PlayerTurn): number {
  return a.turnNumber - b.turnNumber || compareJavaStrings(a.username, b.username)
}

/**
 * Sets the order for one phase.
 *
 * Saving never creates a history version — only `revealTurnOrder` does — so
 * this no longer touches `history`.
 */
export function withOrder(turn: PlayerTurn, phase: TurnPhase, order: string): PlayerTurn {
  return {
    ...turn,
    orders: { ...turn.orders, [phase]: order },
    // A changed order must be explicitly published again.
    revealed: { ...turn.revealed, [phase]: false },
  }
}

const isVersion = (entry: unknown): entry is TurnOrderVersion =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof (entry as { readonly markdown?: unknown }).markdown === 'string' &&
  typeof (entry as { readonly at?: unknown }).at === 'string'

/**
 * Backfills the phase flags on games saved before turn-order reveal existed and
 * normalises `history`.
 *
 * Java's history stored every saved order (including the current one) as a bare
 * string. Those cannot be read back as reveal versions — they were never
 * published as a version and each contained the current order — so legacy
 * string entries are dropped. Entries already shaped `{ markdown, at }` are
 * kept, which makes the migration idempotent. A missing or `undefined` history
 * becomes empty lists.
 */
export function migratePlayerTurn(turn: PlayerTurn): PlayerTurn {
  const revealed = Object.fromEntries(
    TURN_PHASES.map((phase) => [phase, turn.revealed?.[phase] ?? true]),
  ) as Record<TurnPhase, boolean>
  // Older saves carry bare strings here, which the declared type does not
  // allow; read it as unknown and filter.
  const legacyHistory = (turn as { readonly history?: Partial<Record<TurnPhase, readonly unknown[]>> })
    .history
  const versionsFor = (phase: TurnPhase): readonly TurnOrderVersion[] =>
    (legacyHistory?.[phase] ?? []).filter(isVersion)
  return {
    ...turn,
    revealed,
    // Turns saved before chat orders existed: a phase counts as done when it
    // was published, the same rule that backfills `revealed` above.
    done: Object.fromEntries(
      TURN_PHASES.map((phase) => [phase, turn.done?.[phase] ?? revealed[phase]]),
    ) as Record<TurnPhase, boolean>,
    history: {
      SOT: versionsFor('SOT'),
      TRADE: versionsFor('TRADE'),
      CM: versionsFor('CM'),
      MOVEMENT: versionsFor('MOVEMENT'),
      RESEARCH: versionsFor('RESEARCH'),
    },
  }
}

/** Masks the current text of unpublished phases before a turn is sent out. */
export function publicTurn(turn: PlayerTurn): PlayerTurn {
  const orders = { ...turn.orders }
  for (const phase of TURN_PHASES) {
    // Missing flags are treated as public for callers holding an old state
    // object that has not passed through migration yet.
    if (turn.revealed?.[phase] !== false) continue
    orders[phase] = ''
  }
  // A previously revealed version is public information and stays in
  // `history`, even after the phase is edited and made private again.
  return { ...turn, orders }
}

/**
 * Java: the key in `PBF.publicTurns`, built as `turnNumber + username`.
 * Note that it is ambiguous: turn 11 for "a" and turn 1 for "1a" give the same
 * key. The format is kept for compatibility with existing Mongo documents.
 */
export function publicTurnKey(turn: PlayerTurn): string {
  return `${turn.turnNumber}${turn.username}`
}

/** Java: `PlayerTurn.endTurn()` bumped the turn number. */
export function nextTurnNumber(turn: PlayerTurn): number {
  return turn.turnNumber + 1
}

/**
 * New in the port, no Java counterpart. The phase a player should currently be
 * working on: the first phase of their given turn not yet revealed, or `SOT`
 * once every phase of that turn has been revealed (they are between rounds,
 * waiting to start the next one). A missing turn (nothing saved yet) is also
 * `SOT`. Never `null`, so a caller always has something concrete to point a
 * player at.
 *
 * Reads only the `revealed` flags, which are already public (`publicTurn`
 * masks order text, not these booleans), so this is safe to expose to anyone.
 *
 * A flag missing from a legacy, not-yet-migrated `revealed` map is treated as
 * revealed (blocking only on an explicit `false`), the same rule
 * `activeTurnStatus` uses to decide a turn is fully done — so the two never
 * disagree about whether a round is complete.
 */
export function currentPhaseStatus(turn: PlayerTurn | undefined): TurnPhase {
  if (turn === undefined) return 'SOT'
  return TURN_PHASES.find((phase) => turn.revealed[phase] === false) ?? 'SOT'
}

// ---------------------------------------------------------------------------
// Chat orders (issue #215): who is waiting for whom
// ---------------------------------------------------------------------------

/** Where one active player stands in the current turn. */
export interface PlayerTurnStatus {
  readonly playerId: string
  readonly username: string
  /** The first phase not marked done, or `null` once every phase is done. */
  readonly phase: TurnPhase | null
}

export interface WaitingFor {
  readonly username: string
  readonly phase: TurnPhase
}

export interface TurnStatus {
  /** Lowest turn where some active player has not marked Research done. */
  readonly currentTurn: number
  /** Every active player, in playernumber order. Withdrawn players are absent. */
  readonly players: readonly PlayerTurnStatus[]
  /** The players whose `phase` is not `null`, in the same order. */
  readonly waitingFor: readonly WaitingFor[]
}

const isDone = (turn: PlayerTurn | undefined, phase: TurnPhase): boolean =>
  turn?.done?.[phase] === true

const turnOf = (player: Playerhand, turnNumber: number): PlayerTurn | undefined =>
  player.playerTurns.find((turn) => turn.turnNumber === turnNumber)

const firstOpenPhase = (turn: PlayerTurn | undefined): TurnPhase | null =>
  TURN_PHASES.find((phase) => !isDone(turn, phase)) ?? null

const bySeat = (players: readonly Playerhand[]): readonly Playerhand[] =>
  [...players].sort((a, b) => a.playernumber - b.playernumber)

/**
 * New in the port. Derived only from the public `done` flags, so it is safe to
 * expose to every viewer. `state.players` holds the active players; a withdrawn
 * player lives in `withdrawnPlayers` and never holds anybody up.
 *
 * The current turn is the lowest one that some active player has not finished
 * (Research not marked done), counting from `chatOrdersStartTurn`. It is that
 * baseline (1 in a game that never played classic) when nobody has anything
 * yet, and it moves on by itself once the last player marks Research done.
 */
export function turnStatus(state: GameState): TurnStatus {
  const players = bySeat(state.players)
  const highest = players.reduce(
    (best, player) =>
      player.playerTurns.reduce((inner, turn) => Math.max(inner, turn.turnNumber), best),
    0,
  )

  // Turns before the baseline count as finished for everybody, so a player who
  // never wrote an early turn cannot pin the current turn to it.
  let currentTurn = Math.max(1, state.chatOrdersStartTurn)
  while (
    currentTurn <= highest &&
    players.every((player) => isDone(turnOf(player, currentTurn), 'RESEARCH'))
  ) {
    currentTurn += 1
  }

  const statuses = players.map((player): PlayerTurnStatus => ({
    playerId: player.playerId,
    username: player.username,
    phase: firstOpenPhase(turnOf(player, currentTurn)),
  }))
  const waitingFor = statuses.flatMap((status): readonly WaitingFor[] =>
    status.phase === null ? [] : [{ username: status.username, phase: status.phase }],
  )
  return { currentTurn, players: statuses, waitingFor }
}

/**
 * Who "has the turn" when chat orders are on. There is no baton: it is the
 * first player, in seat order starting from the start player, who has not
 * marked the earliest open phase done. The earliest open phase is the first one
 * some active player has not marked done in the current turn.
 *
 * `startPlayerNumber` is the seat that holds the start player marker. It is 1
 * until the marker is tracked (slice 3 of the brief).
 *
 * `undefined` when there are no active players.
 */
export function turnHolder(state: GameState, startPlayerNumber = 1): Playerhand | undefined {
  const seats = bySeat(state.players)
  const { currentTurn } = turnStatus(state)
  const earliest = TURN_PHASES.find((phase) =>
    seats.some((player) => !isDone(turnOf(player, currentTurn), phase)),
  )
  if (earliest === undefined) return undefined

  // No seat at or after the start number (it is above every seat): begin at seat 1.
  const found = seats.findIndex((player) => player.playernumber >= startPlayerNumber)
  const from = found === -1 ? 0 : found
  const ordered = [...seats.slice(from), ...seats.slice(0, from)]
  return ordered.find((player) => !isDone(turnOf(player, currentTurn), earliest))
}
