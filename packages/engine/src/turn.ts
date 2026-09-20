/**
 * Port of `no.asgari.civilization.server.model.PlayerTurn`.
 *
 * A turn has five phases. Each phase holds a current order and a history of
 * earlier orders, so the players can see what changed.
 *
 * `TurnKey.java` is not ported. It was an attempt at a composite key for
 * `publicTurns`, but Java could not get Jackson to serialise the map and ended
 * up concatenating `turnNumber + username` into a string. That string is kept
 * as the key format.
 */

export const TURN_PHASES = ['SOT', 'TRADE', 'CM', 'MOVEMENT', 'RESEARCH'] as const
export type TurnPhase = (typeof TURN_PHASES)[number]

export const TURN_PHASE_LABEL: Readonly<Record<TurnPhase, string>> = {
  SOT: 'start of turn',
  TRADE: 'trade',
  CM: 'city management',
  MOVEMENT: 'movement',
  RESEARCH: 'research',
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
   * Java used a `Set<String>` per phase, so without order. Insertion order is
   * kept here, since a history without order is worth little.
   */
  readonly history: Readonly<Record<TurnPhase, readonly string[]>>
}

const emptyOrders = (): Record<TurnPhase, string> => ({
  SOT: '',
  TRADE: '',
  CM: '',
  MOVEMENT: '',
  RESEARCH: '',
})

const emptyHistory = (): Record<TurnPhase, readonly string[]> => ({
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

export function createPlayerTurn(username: string, turnNumber: number): PlayerTurn {
  return {
    turnNumber,
    username,
    disabled: false,
    orders: emptyOrders(),
    revealed: emptyRevealed(),
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

/** Sets the order for one phase and adds it to the history. */
export function withOrder(turn: PlayerTurn, phase: TurnPhase, order: string): PlayerTurn {
  const existing = turn.history[phase]
  return {
    ...turn,
    orders: { ...turn.orders, [phase]: order },
    // A changed order must be explicitly published again.
    revealed: { ...turn.revealed, [phase]: false },
    history: {
      ...turn.history,
      // Java used a Set, so the same order twice made only one entry
      [phase]: existing.includes(order) ? existing : [...existing, order],
    },
  }
}

/** Backfills the phase flags on games saved before turn-order reveal existed. */
export function migratePlayerTurn(turn: PlayerTurn): PlayerTurn {
  return {
    ...turn,
    revealed: Object.fromEntries(
      TURN_PHASES.map((phase) => [phase, turn.revealed?.[phase] ?? true]),
    ) as Record<TurnPhase, boolean>,
  }
}

/** Masks unpublished phases before a turn is sent to another player. */
export function publicTurn(turn: PlayerTurn): PlayerTurn {
  const orders = { ...turn.orders }
  const history = { ...turn.history }
  for (const phase of TURN_PHASES) {
    // Missing flags are treated as public for callers holding an old state
    // object that has not passed through migration yet.
    if (turn.revealed?.[phase] !== false) continue
    orders[phase] = ''
    history[phase] = []
  }
  return { ...turn, orders, history }
}

/**
 * Java: the key in `PBF.publicTurns`, built as `turnNumber + username`.
 * Note that it is ambiguous: turn 11 for "a" and turn 1 for "1a" give the same
 * key. The format is kept for compatibility with existing Mongo documents.
 */
export function publicTurnKey(turn: PlayerTurn): string {
  return `${turn.turnNumber}${turn.username}`
}

/**
 * Java: `TurnAction.getAllPublicTurns` stripped the current order from the
 * history before returning — but did it by mutating the stored objects, so a
 * read corrupted data. Here it is a pure projection.
 */
export function withoutCurrentOrderInHistory(turn: PlayerTurn): PlayerTurn {
  const history = { ...turn.history }
  for (const phase of TURN_PHASES) {
    history[phase] = turn.history[phase].filter((order) => order !== turn.orders[phase])
  }
  return { ...turn, history }
}

/** Java: `PlayerTurn.endTurn()` bumped the turn number. */
export function nextTurnNumber(turn: PlayerTurn): number {
  return turn.turnNumber + 1
}
