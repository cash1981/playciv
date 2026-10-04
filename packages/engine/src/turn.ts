/**
 * Port of `no.asgari.civilization.server.model.PlayerTurn`.
 *
 * A turn has five phases. Each phase holds the current order and the history
 * of the versions its owner has *revealed*, so the players can see what was
 * published before. An order is published when it is posted, and every posted
 * version is kept.
 *
 * `TurnKey.java` is not ported. It was an attempt at a composite key for
 * `publicTurns`, but Java could not get Jackson to serialise the map and ended
 * up concatenating `turnNumber + username` into a string. That string is kept
 * as the key format.
 */

import type { BoardPiece } from './board.js'
import { areaAt, playerAreas, START_PLAYER_ID } from './board.js'
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
    // Turns saved before the done markers existed: a phase counts as done when it
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

/** Active players in seat (playernumber) order. */
export const bySeat = (players: readonly Playerhand[]): readonly Playerhand[] =>
  [...players].sort((a, b) => a.playernumber - b.playernumber)

/**
 * New in the port. Derived only from the public `done` flags, so it is safe to
 * expose to every viewer. `state.players` holds the active players; a withdrawn
 * player lives in `withdrawnPlayers` and never holds anybody up.
 *
 * The current turn is the lowest one that some active player has not finished
 * (Research not marked done), counting from `chatOrdersStartTurn`. It is that
 * baseline (1 in a game that never used the old baton) when nobody has anything
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
 * The seat after `playernumber`, clockwise: the next higher number, wrapping to
 * the lowest. `seats` are the active players in seat order, so a withdrawn
 * player is never picked and is skipped by falling through to the next seat.
 */
export const seatAfter = (seats: readonly Playerhand[], playernumber: number): Playerhand | undefined =>
  seats.find((player) => player.playernumber > playernumber) ?? seats[0]

/**
 * Who the start player is, derived so manual moves, undo and redo cannot leave it
 * stale: the owner of the player area that holds the centre of the
 * `markers/startplayer` piece (see `startMarkerOf` when there are several). With
 * no marker, or one outside every player's area, it is the last one the engine put in place (`startPlayerId`), and with
 * none of those seat 1. A start player who has withdrawn gives way to the next
 * seat. `undefined` when there are no active players.
 */
export function startPlayerOf(state: GameState): Playerhand | undefined {
  const seats = bySeat(state.players)
  const owner = startMarkerOf(state)?.owner
  if (owner !== undefined) return owner

  const lastKnown = state.startPlayerId
  if (lastKnown === null) return seats[0]
  const active = seats.find((player) => player.playerId === lastKnown)
  if (active !== undefined) return active
  const withdrawn = state.withdrawnPlayers.find((player) => player.playerId === lastKnown)
  return withdrawn === undefined ? seats[0] : seatAfter(seats, withdrawn.playernumber)
}

/**
 * The start player marker that counts, and who owns the area it is in. The
 * palette does not limit the marker, so there can be more than one, and the one
 * touched last wins: the last one in the piece list whose centre lies in a
 * player's area. Every move re-inserts a piece at the end, so that is the marker
 * somebody handled most recently, and it does not depend on which was placed
 * first. A marker outside every area is ignored while another one is inside.
 *
 * With none inside an area, `owner` is `undefined` and `piece` is the last
 * marker on the board, so a rule that moves the marker moves that one. Undefined
 * when the board has no marker. `startPlayerOf`, the rotation and the manual
 * move announcement all use this, so they cannot disagree about which marker
 * decides.
 */
export function startMarkerOf(
  state: GameState,
): { readonly piece: BoardPiece; readonly owner: Playerhand | undefined } | undefined {
  const seats = bySeat(state.players)
  const markers = state.board.pieces.filter((piece) => piece.assetId === START_PLAYER_ID)
  const areas = playerAreas(state.board, seats)
  for (const piece of [...markers].reverse()) {
    const area = areaAt(areas, piece.x + piece.width / 2, piece.y + piece.height / 2)
    const owner = seats.find((player) => player.playerId === area?.playerId)
    if (owner !== undefined) return { piece, owner }
  }
  const last = markers.at(-1)
  return last === undefined ? undefined : { piece: last, owner: undefined }
}

/**
 * Who started turn `turnNumber`. The marker is live, so for the newest started
 * turn that is the derived start player: a manual move or an undo shows at once.
 * A turn older than the newest started one was rolled back to (a Research was
 * unmarked), and the record keeps its starter. `null` when nobody can be named.
 */
export function startPlayerName(state: GameState, turnNumber: number): string | null {
  const newest = Object.keys(state.turnStarters).reduce((best, key) => Math.max(best, Number(key)), 0)
  const recorded = state.turnStarters[turnNumber]
  if (recorded !== undefined && turnNumber < newest) return recorded
  return startPlayerOf(state)?.username ?? null
}

/**
 * Who "has the turn". There is no baton: it is the
 * first player, in seat order starting from the start player, who has not
 * marked the earliest open phase done. The earliest open phase is the first one
 * some active player has not marked done in the current turn.
 *
 * The seat it starts from is the start player of the current turn (see
 * `startPlayerName`), or `startPlayerNumber` when a caller passes one.
 *
 * `undefined` when there are no active players.
 */
export function turnHolder(state: GameState, startPlayerNumber?: number): Playerhand | undefined {
  const seats = bySeat(state.players)
  const { currentTurn } = turnStatus(state)
  const earliest = TURN_PHASES.find((phase) =>
    seats.some((player) => !isDone(turnOf(player, currentTurn), phase)),
  )
  if (earliest === undefined) return undefined

  const starter = seats.find((player) => player.username === startPlayerName(state, currentTurn))
  const startNumber = startPlayerNumber ?? starter?.playernumber ?? 1
  // No seat at or after the start number (it is above every seat): begin at seat 1.
  const found = seats.findIndex((player) => player.playernumber >= startNumber)
  const from = found === -1 ? 0 : found
  const ordered = [...seats.slice(from), ...seats.slice(0, from)]
  return ordered.find((player) => !isDone(turnOf(player, currentTurn), earliest))
}

/** One published version of a phase's order. */
export interface PublicOrderVersion {
  readonly username: string
  readonly turnNumber: number
  readonly phase: TurnPhase
  readonly markdown: string
  /** When the owner published it. */
  readonly at: string
  /** Position among that phase's versions, oldest first. */
  readonly index: number
}

/**
 * Every revealed version of every order, oldest first, read from the public copy
 * only (`publicTurns`), never from a player's own turns: a draft that was never
 * revealed is masked there and has no history entry, so it cannot be returned by
 * accident. The server copies these into the timeline when it migrates a game
 * from the old Turn orders panel. A version without a usable `at` is left out
 * rather than given a made-up time. Orders revealed before versions were kept (old
 * saves) have none and are not returned here; `publicOrdersWithoutVersions` has them.
 */
export function publicOrderVersions(state: GameState): readonly PublicOrderVersion[] {
  const versions = Object.values(state.publicTurns).flatMap((turn) =>
    TURN_PHASES.flatMap((phase) =>
      (turn.history?.[phase] ?? []).flatMap((version, index): readonly PublicOrderVersion[] =>
        typeof version.at === 'string' && !Number.isNaN(Date.parse(version.at))
          ? [{ username: turn.username, turnNumber: turn.turnNumber, phase, markdown: version.markdown, at: version.at, index }]
          : [],
      ),
    ),
  )
  return sortVersions(versions)
}

const sortVersions = (versions: readonly PublicOrderVersion[]): readonly PublicOrderVersion[] =>
  [...versions].sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      a.turnNumber - b.turnNumber ||
      TURN_PHASES.indexOf(a.phase) - TURN_PHASES.indexOf(b.phase) ||
      compareJavaStrings(a.username, b.username) ||
      a.index - b.index,
  )

const usableTime = (at: string | null | undefined): at is string =>
  typeof at === 'string' && !Number.isNaN(Date.parse(at))

/** Used when neither the reveal log nor the game says when an old reveal happened. */
const EPOCH = '1970-01-01T00:00:00.000Z'

/**
 * Orders that were revealed before versions were kept: a phase of a public turn
 * that is revealed, holds text, and has an empty history (`migratePlayerTurn`
 * drops the bare strings old saves kept there, so the text survives only in
 * `publicTurns[key].orders[phase]`). Each becomes one version, so the migration
 * can put it in the timeline. `publicOrderVersions` does not return these and
 * keeps its meaning.
 *
 * `at` comes from the reveal's own log line, `Turn N - <user> revealed <phase>
 * phase`, taking the newest match with a usable time because the text shown is the
 * last one revealed. With no such line it is the game's `createdAt`, and when that
 * is unusable too, the epoch `1970-01-01T00:00:00.000Z`: a stored time is never
 * invented from the clock.
 *
 * Only `publicTurns` is read, never a player's own turns, so an unrevealed draft
 * (blank or masked in the public copy) cannot be returned. Oldest first, in the
 * order `publicOrderVersions` uses.
 */
export function publicOrdersWithoutVersions(state: GameState): readonly PublicOrderVersion[] {
  const revealedAt = (username: string, turnNumber: number, phase: TurnPhase): string => {
    const wanted = `Turn ${turnNumber} - ${username} revealed ${TURN_PHASE_LABEL[phase]} phase`.toLowerCase()
    for (let index = state.log.length - 1; index >= 0; index -= 1) {
      const entry = state.log[index]
      if (entry === undefined || !usableTime(entry.createdAt)) continue
      if (entry.publicLog.toLowerCase().includes(wanted)) return entry.createdAt
    }
    return usableTime(state.createdAt) ? state.createdAt : EPOCH
  }
  const versions = Object.values(state.publicTurns).flatMap((turn) =>
    TURN_PHASES.flatMap((phase): readonly PublicOrderVersion[] => {
      const markdown = turn.orders[phase] ?? ''
      if (turn.revealed?.[phase] !== true || markdown.trim() === '' || (turn.history?.[phase] ?? []).length > 0) {
        return []
      }
      return [
        {
          username: turn.username,
          turnNumber: turn.turnNumber,
          phase,
          markdown,
          at: revealedAt(turn.username, turn.turnNumber, phase),
          index: 0,
        },
      ]
    }),
  )
  return sortVersions(versions)
}

/** One order a player wrote in the old Turn orders panel and never published. */
export interface UnpublishedDraft {
  readonly playerId: string
  readonly turnNumber: number
  readonly phase: TurnPhase
  readonly markdown: string
}

/**
 * Every draft that was never published, in player, turn and phase order: a
 * non-blank `orders[phase]` while `revealed[phase]` is not true. This reads the
 * players' own turns, so it is private data. It is for the migration only, and
 * its result must go nowhere but back into the owner's own `gamenote`.
 */
export function unpublishedDrafts(state: GameState): readonly UnpublishedDraft[] {
  return [...state.players, ...state.withdrawnPlayers].flatMap((player) =>
    [...player.playerTurns]
      .sort((a, b) => a.turnNumber - b.turnNumber)
      .flatMap((turn) =>
        TURN_PHASES.flatMap((phase): readonly UnpublishedDraft[] => {
          const markdown = (turn.orders[phase] ?? '').trim()
          return markdown === '' || turn.revealed[phase] === true
            ? []
            : [{ playerId: player.playerId, turnNumber: turn.turnNumber, phase, markdown }]
        }),
      ),
  )
}

const draftSection = (draft: UnpublishedDraft): string =>
  `### Turn ${draft.turnNumber}, ${TURN_PHASE_LABEL[draft.phase]} (unpublished draft)\n\n${draft.markdown}`

/**
 * The drafts `draftsToPrivateNote` would add: those whose section the owner's note
 * does not already hold, word for word. The migration reports this count, so a
 * second run says nothing is left to move.
 */
export function pendingDrafts(state: GameState): readonly UnpublishedDraft[] {
  const noteOf = new Map(
    [...state.players, ...state.withdrawnPlayers].map((player) => [player.playerId, player.gamenote ?? ''] as const),
  )
  return unpublishedDrafts(state).filter((draft) => !(noteOf.get(draft.playerId) ?? '').includes(draftSection(draft)))
}

/**
 * Moves the unpublished drafts of the old Turn orders panel into their owners'
 * private note (`gamenote`), which is what the private tab of the timeline shows.
 * Each draft becomes a markdown section headed `### Turn N, <phase> (unpublished
 * draft)`, added after whatever the note already says and separated by a blank
 * line. A section the note already holds, word for word, is not added again, so a
 * second run changes nothing. `publicTurns` and the players' own turns are left
 * alone: nothing another player sees changes.
 */
export function draftsToPrivateNote(state: GameState): GameState {
  const drafts = pendingDrafts(state)
  if (drafts.length === 0) return state
  const withNote = (player: Playerhand): Playerhand => {
    const note = player.gamenote ?? ''
    const sections = drafts
      .filter((draft) => draft.playerId === player.playerId)
      .map(draftSection)
    if (sections.length === 0) return player
    return { ...player, gamenote: [note.trimEnd(), ...sections].filter((part) => part !== '').join('\n\n') }
  }
  return {
    ...state,
    players: state.players.map(withNote),
    withdrawnPlayers: state.withdrawnPlayers.map(withNote),
  }
}
