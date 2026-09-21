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
  // Older saves carry bare strings here, which the declared type does not
  // allow; read it as unknown and filter.
  const legacyHistory = (turn as { readonly history?: Partial<Record<TurnPhase, readonly unknown[]>> })
    .history
  const versionsFor = (phase: TurnPhase): readonly TurnOrderVersion[] =>
    (legacyHistory?.[phase] ?? []).filter(isVersion)
  return {
    ...turn,
    revealed: Object.fromEntries(
      TURN_PHASES.map((phase) => [phase, turn.revealed?.[phase] ?? true]),
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
