/**
 * Port of `no.asgari.civilization.server.action.UndoAction`.
 *
 * One deliberate change: Java decided HOW to put an item back by searching for
 * substrings in the log line — `privateLog.contains("discarded")`,
 * `contains("drew")`, `contains("barbarian")`. The log entry carries a
 * `logType`, which is the same information without string matching, and that
 * is used here instead.
 *
 * Java's barbarian branch was dead code anyway: it required the log line to
 * contain "drew", but barbarian logs say "has drawn". Barbarian logs also carry
 * no item, so an undo of one could never be started. The branch is not ported.
 */

import { assistedRecordOf, assistedSubject, reverseAssistedAction } from '../assisted.js'
import { civTileAssetId, leaderAssetId } from '../board.js'
import { techCoinSource, withCoinSource } from '../coins.js'
import type { EngineError } from '../errors.js'
import { DEFAULT_GOVERNMENT } from '../government.js'
import type { CivItem, Item, TechItem } from '../item.js'
import { isUnit, itemName } from '../item.js'
import {
  appendAssistedUndoRequestLog,
  appendAssistedVoteLog,
  appendUndoLog,
  appendUndoRequestLog,
  appendVoteLog,
  publicItemSubject,
} from '../log.js'
import { shuffle } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { SheetName } from '../sheet-name.js'
import type { CivRevealSetup, GameLogEntry, GameState, Playerhand } from '../state.js'
import {
  findLogEntry,
  findPlayer,
  hasUserAccess,
  withLogEntry,
  withPlayer,
} from '../state.js'
import { castVote, createUndo, resultOfVotes } from '../undo.js'

import { removePieceAsSystem } from './board.js'
import { DEFAULT_STARTING_UNITS, STARTING_UNITS } from './player.js'

type ActionResult = Result<GameState, EngineError>

export interface InitiateUndoInput {
  readonly logId: string
  readonly playerId: string
}

/** The REVEAL entry of a civilization. Undoing it takes the whole setup back. */
function isCivReveal(entry: GameLogEntry): boolean {
  return entry.logType === 'REVEAL' && entry.item?.kind === 'civ'
}

/**
 * What a civ reveal handed out: the recorded setup, or for a reveal made before
 * it was recorded, one rebuilt from the log and the board. The rebuild only
 * covers what can be told apart with certainty. It refuses (`undefined`) once
 * the shared wonders are dealt, because those cannot be matched to the reveal,
 * and for Egypt, whose own wonder is not tied to the reveal by anything saved.
 */
function civSetupOf(state: GameState, entry: GameLogEntry): CivRevealSetup | undefined {
  if (entry.civSetup !== undefined) return entry.civSetup
  const civ = entry.item
  if (civ?.kind !== 'civ' || entry.playerId === null) return undefined
  if (state.wondersDealt || civ.name === 'Egyptians') return undefined

  const owner = findPlayer(state, entry.playerId)
  const after = state.log.slice(state.log.findIndex((candidate) => candidate.id === entry.id) + 1)
  const expected = STARTING_UNITS[civ.name] ?? DEFAULT_STARTING_UNITS

  // The starting units are drawn right after the REVEAL line, all or none
  const drawn = after.slice(0, expected.length)
  const unitIds = drawn.flatMap((line) =>
    line.logType === 'ITEM' && line.playerId === entry.playerId && line.item !== null
      ? [line.item]
      : [],
  )
  const hasUnits =
    unitIds.length === expected.length &&
    unitIds.every((item, index) => item.sheetName === expected[index])
  // Neither none nor all of them: this is not the log of a reveal we can read
  if (!hasUnits && drawn[0]?.logType === 'ITEM') return undefined
  const skipped = hasUnits ? expected.length : 0

  // The other civ cards are discarded right after the units
  const discardedCivIds: string[] = []
  for (const line of after.slice(skipped)) {
    if (line.logType !== 'DISCARD' || line.playerId !== entry.playerId) break
    if (line.item?.kind !== 'civ') break
    discardedCivIds.push(line.item.id)
  }

  const assetIds = [civTileAssetId(civ.name), leaderAssetId(civ.name, owner?.color ?? '')]
  const pieceIds = state.board.pieces
    .filter((piece) => assetIds.includes(piece.assetId))
    .map((piece) => piece.id)

  return {
    unitIds: hasUnits ? unitIds.map((item) => item.id) : [],
    discardedCivIds,
    pieceIds,
    wonders: [],
  }
}

/**
 * Whether an undo can be asked for on this entry: there is an item to put back
 * and no vote yet. A civilization reveal also needs to be readable, see
 * {@link civSetupOf}.
 */
export function canInitiateUndo(state: GameState, entry: GameLogEntry): boolean {
  if (entry.item === null || entry.undo !== null) return false
  return !isCivReveal(entry) || civSetupOf(state, entry) !== undefined
}

/**
 * A line with no item that reports an assisted action can be undone too. The
 * item still wins when both are there, so every existing entry behaves as before.
 */
const isAssistedEntry = (entry: GameLogEntry): boolean =>
  entry.item === null && entry.assistedActionId !== undefined

/**
 * Java: `UndoAction.initiateUndo` — starts a vote. Whoever asks for the undo
 * has voted yes the moment the vote is created.
 */
export function initiateUndo(state: GameState, input: InitiateUndoInput): ActionResult {
  const entry = findLogEntry(state, input.logId)
  if (entry === undefined) return err({ kind: 'LOG_ENTRY_NOT_FOUND', logId: input.logId })
  if (entry.item === null) return initiateAssistedUndo(state, entry, input)
  if (entry.undo !== null) {
    return err({ kind: 'UNDO_ALREADY_INITIATED', logId: input.logId })
  }
  if (!canInitiateUndo(state, entry)) return err({ kind: 'CIV_REVEAL_NOT_UNDOABLE', logId: input.logId })
  if (!hasUserAccess(state, input.playerId)) {
    return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })
  }

  const player = findPlayer(state, input.playerId) as Playerhand
  const next = withLogEntry(state, {
    ...entry,
    undo: createUndo(state.numOfPlayers, input.playerId),
  })

  return ok(
    appendUndoRequestLog(
      next,
      player.username,
      input.playerId,
      entry.item,
      entry.logType,
      entry.username,
      (entry.item.ownerId ?? entry.playerId) === input.playerId,
    ),
  )
}

/**
 * Starts the vote on a line that has no item. Only a line that reports a
 * recorded assisted action can be undone; any other line has nothing to undo.
 * The already-undone check comes before the already-asked one so a second undo
 * says why, not only "already asked".
 */
function initiateAssistedUndo(
  state: GameState,
  entry: GameLogEntry,
  input: InitiateUndoInput,
): ActionResult {
  const record = assistedRecordOf(state, entry)
  if (record === undefined) return err({ kind: 'NOTHING_TO_UNDO', logId: input.logId })
  if (record.status === 'undone') {
    return err({ kind: 'ASSISTED_ACTION_ALREADY_UNDONE', logId: input.logId })
  }
  if (entry.undo !== null) {
    return err({ kind: 'UNDO_ALREADY_INITIATED', logId: input.logId })
  }
  if (!hasUserAccess(state, input.playerId)) {
    return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })
  }

  const player = findPlayer(state, input.playerId) as Playerhand
  const next = withLogEntry(state, {
    ...entry,
    undo: createUndo(state.numOfPlayers, input.playerId),
  })
  return ok(
    appendAssistedUndoRequestLog(next, player.username, input.playerId, assistedSubject(state, record)),
  )
}

export interface VoteInput {
  readonly logId: string
  readonly playerId: string
  readonly vote: boolean
  /** ISO timestamp for what an accepted assisted undo writes. The engine itself stays pure. */
  readonly at?: string
}

/**
 * Java: `UndoAction.vote`.
 *
 * Once everyone has voted and nobody said no, the undo runs immediately. A
 * single no ends the vote without putting anything back, but Java did not set
 * `done` in that case either, so the entry stays marked as active. That
 * behaviour is kept.
 */
export function vote(state: GameState, input: VoteInput): ActionResult {
  const entry = findLogEntry(state, input.logId)
  if (entry === undefined) return err({ kind: 'LOG_ENTRY_NOT_FOUND', logId: input.logId })
  if (entry.undo === null) return err({ kind: 'UNDO_NOT_INITIATED', logId: input.logId })
  // A vote that has run is over: a late yes would otherwise run the undo again.
  // An assisted action says so with its own error, further down.
  if (entry.item !== null && entry.undo.done) return err({ kind: 'UNDO_ALREADY_DONE', logId: input.logId })
  if (entry.item === null && !isAssistedEntry(entry)) {
    return err({ kind: 'NOTHING_TO_UNDO', logId: input.logId })
  }

  const voter = findPlayer(state, input.playerId)
  if (voter === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })

  if (entry.item === null) return voteOnAssisted(state, entry, input, voter)

  const undo = castVote(entry.undo, input.playerId, input.vote)
  const result = resultOfVotes(undo)
  const accepted = result === true

  let next = withLogEntry(state, { ...entry, undo: { ...undo, done: accepted } })
  const subject = publicItemSubject(entry.logType, entry.username, entry.item, state.logSecret)
  next = appendVoteLog(
    next,
    voter.username,
    input.playerId,
    subject.name,
    subject.itemNumber,
    input.vote,
  )

  if (!accepted) return ok(next)

  // Java: the undo belongs to the owner of the item, not the last voter
  const ownerId = entry.item.ownerId ?? entry.playerId
  if (ownerId === null) return err({ kind: 'NOTHING_TO_UNDO', logId: input.logId })

  if (entry.logType === 'REVEAL' && entry.item.kind === 'civ') {
    const setup = civSetupOf(state, entry)
    if (setup === undefined) return err({ kind: 'CIV_REVEAL_NOT_UNDOABLE', logId: input.logId })
    return undoCivReveal(next, ownerId, entry.item, setup, input.logId)
  }

  return putItemBack(next, ownerId, entry.item, entry.logType)
}

/**
 * The vote on an assisted action's line. Same unanimity and the same single no
 * as an item vote; the lines name the action as its own line did, and a passed
 * vote runs the reversal instead of putting an item back.
 */
function voteOnAssisted(
  state: GameState,
  entry: GameLogEntry,
  input: VoteInput,
  voter: Playerhand,
): ActionResult {
  const record = assistedRecordOf(state, entry)
  if (entry.undo === null || record === undefined) {
    return err({ kind: 'NOTHING_TO_UNDO', logId: input.logId })
  }
  if (record.status === 'undone') {
    return err({ kind: 'ASSISTED_ACTION_ALREADY_UNDONE', logId: input.logId })
  }

  const undo = castVote(entry.undo, input.playerId, input.vote)
  const accepted = resultOfVotes(undo) === true

  const next = appendAssistedVoteLog(
    withLogEntry(state, { ...entry, undo: { ...undo, done: accepted } }),
    voter.username,
    input.playerId,
    assistedSubject(state, record),
    input.vote,
  )
  if (!accepted) return ok(next)
  return reverseAssistedAction(next, record.id, input.at)
}

/**
 * Takes back what revealing a civilization handed out by itself: the starting
 * units and Egypt's wonder go back into the deck, the other civ cards return to
 * the hand, and the tile, leader marker, starting tech and government are
 * removed. Anything the player drew or chose on their own stays where it is.
 *
 * The start-of-game wonder deal only holds while every seat has a civilization,
 * so it is taken back too, whichever reveal triggered it. The next reveal that
 * completes the table deals it again. The deck is reshuffled once at the end.
 */
function undoCivReveal(
  state: GameState,
  playerId: string,
  civ: CivItem,
  setup: CivRevealSetup,
  logId: string,
): ActionResult {
  const owner = findPlayer(state, playerId)
  if (owner === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })
  // Already taken back some other way, so there is nothing left to undo
  if (owner.civilization?.id !== civ.id) return err({ kind: 'NOTHING_TO_UNDO', logId })

  const units = takeOutOfPlay(
    state,
    playerId,
    setup.unitIds.filter((id) => !drawnAgainSince(state, logId, id)),
  )
  // Only the tech the reveal handed out goes, not one the player chose again
  // themselves after removing it: that copy has the catalogue's id, not the civ's
  const techsChosen = owner.techsChosen.filter((tech) => tech.id !== civ.startingTech.id)
  const discardedCivs = units.state.discardedItems.filter((item) =>
    setup.discardedCivIds.includes(item.id),
  )
  const current = findPlayer(units.state, playerId) as Playerhand
  let next = withPlayer(
    {
      ...units.state,
      discardedItems: units.state.discardedItems.filter(
        (item) => !setup.discardedCivIds.includes(item.id),
      ),
    },
    {
      ...current,
      civilization: null,
      government: DEFAULT_GOVERNMENT,
      items: [
        ...current.items.map((item) => (item.id === civ.id ? { ...item, hidden: true } : item)),
        ...discardedCivs.map((item) => ({ ...item, hidden: true })),
      ],
      techsChosen,
      stats: {
        ...current.stats,
        coinSources: clearedCoinSources(current, civ, techsChosen),
      },
    },
  )

  next = removePieces(next, setup.pieceIds)
  let toDeck: readonly Item[] = [
    ...setup.wonders,
    ...units.taken.map((item) => ({
      ...item,
      hidden: true,
      ownerId: null,
      // A unit that stood in the arena must not keep the flag in the deck
      ...(isUnit(item) ? { inBattle: false } : {}),
    })),
  ]

  const dealEntry = next.log.find((entry) => entry.civSetup?.dealt !== undefined)
  const dealt = dealEntry?.civSetup?.dealt
  if (dealEntry?.civSetup !== undefined && dealt !== undefined) {
    const { dealt: _dealt, ...withoutDeal } = dealEntry.civSetup
    next = removePieces(next, dealt.pieceIds)
    next = withLogEntry({ ...next, wondersDealt: false }, { ...dealEntry, civSetup: withoutDeal })
    toDeck = [...toDeck, ...dealt.wonders]
  }

  // Whatever board changes were taken back or made by hand before the vote must
  // not come back through Redo or Undo, with the cards already in the deck
  next = {
    ...next,
    board: { ...next.board, redo: [], undoFloor: next.board.history.length },
  }
  next = shuffleDeckTwice({ ...next, items: [...next.items, ...toDeck] })
  return ok(
    logUndo(
      next,
      current,
      civ,
      'REVEAL',
      (name) =>
        `has undone ${current.username}'s reveal of ${name}. Its starting units, wonders, tile, ` +
        `marker and white figure are put back${dealt === undefined ? '' : ', and so are the start-of-game wonders'}. ` +
        'Deck is reshuffled',
    ),
  )
}

/**
 * The coin counters that go with the civilization's starting tech and the
 * Democracy government card, cleared like `putTechBack` and a government change
 * do, so no hidden value is left in the public coin total.
 */
function clearedCoinSources(
  player: Playerhand,
  civ: CivItem,
  techsKept: readonly TechItem[],
): Playerhand['stats']['coinSources'] {
  const techSource = techCoinSource(civ.startingTech.name)
  // A copy the player chose themselves keeps its counter
  const keepsOwnCopy = techsKept.some((tech) => tech.name === civ.startingTech.name)
  const withoutTech =
    techSource === undefined || keepsOwnCopy
      ? player.stats.coinSources
      : withCoinSource(player.stats.coinSources, techSource, 0)
  return withCoinSource(withoutTech, 'democracyGovernment', 0)
}

/**
 * Removes the pieces that are still on the board, as history entries by the
 * System. They are not the owner's, or the owner's board Undo would bring a
 * piece back whose card is already in the deck.
 */
function removePieces(state: GameState, pieceIds: readonly string[]): GameState {
  // A piece a player has since removed or undone is already gone
  return pieceIds.reduce((acc, pieceId) => removePieceAsSystem(acc, pieceId) ?? acc, state)
}

/**
 * Whether the item was drawn once more after the reveal's own draws. The reveal
 * drew each starting unit once; a second `ITEM` line for the same id means the
 * unit went back into the deck (or was reshuffled into it) and someone drew it
 * as an ordinary card, which the undo must leave alone.
 */
function drawnAgainSince(state: GameState, revealLogId: string, itemId: string): boolean {
  const revealIndex = state.log.findIndex((entry) => entry.id === revealLogId)
  const draws = state.log
    .slice(revealIndex + 1)
    .filter((entry) => entry.logType === 'ITEM' && entry.item?.id === itemId)
  return draws.length > 1
}

/**
 * Takes the given items out of the owner's hand and battle hand and out of the
 * discard pile, wherever they ended up since being drawn, and returns them once
 * each. Another player's hand is left alone: a unit there was drawn by them.
 */
function takeOutOfPlay(
  state: GameState,
  ownerId: string,
  ids: readonly string[],
): { readonly state: GameState; readonly taken: readonly Item[] } {
  const wanted = new Set(ids)
  const taken = new Map<string, Item>()
  const keep = <T extends Item>(items: readonly T[]): T[] =>
    items.filter((item) => {
      if (!wanted.has(item.id)) return true
      taken.set(item.id, item)
      return false
    })

  const players = state.players.map((player) =>
    player.playerId === ownerId
      ? { ...player, items: keep(player.items), battlehand: keep(player.battlehand) }
      : player,
  )
  const discardedItems = keep(state.discardedItems)
  return { state: { ...state, players, discardedItems }, taken: [...taken.values()] }
}

/**
 * Java: `putDrawnItemBackInPBF`. Where the item goes back to depends on what
 * happened: a draw goes back into the deck and the deck is shuffled, a discard
 * goes back into the hand.
 */
function putItemBack(
  state: GameState,
  playerId: string,
  item: Item,
  logType: GameLogEntry['logType'],
): ActionResult {
  const player = findPlayer(state, playerId)
  if (player === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId })

  if (item.kind === 'tech') return putTechBack(state, player, item, logType)

  const inHand = player.items.some((candidate) => candidate.id === item.id)
  const inDiscard = state.discardedItems.some((candidate) => candidate.id === item.id)
  const inDeck = state.items.some((candidate) => candidate.id === item.id)

  // A discarded item goes back into the hand
  if (logType === 'DISCARD' && inDiscard) {
    return ok(returnToHand(state, player, item, logType))
  }

  // A drawn item goes back into the deck
  if (logType === 'ITEM' && (inHand || inDiscard)) {
    return ok(returnToDeck(state, player, item, logType))
  }

  // Java had a fallback for the cases where the item was already in the deck
  if (inDeck) {
    const withoutFromDeck: GameState = {
      ...state,
      items: state.items.filter((candidate) => candidate.id !== item.id),
    }
    const hidden: Item = { ...item, hidden: true }
    const next = withPlayer(withoutFromDeck, {
      ...player,
      items: [...player.items, hidden],
    })
    return ok(
      logUndo(next, player, item, logType, (name) => `has added back ${name} to ${player.username}`),
    )
  }

  if (inHand) return ok(returnToDeck(state, player, item, logType))
  if (inDiscard) return ok(returnToHand(state, player, item, logType))

  return err({ kind: 'ITEM_NOT_FOUND', sheetName: item.sheetName })
}

/** Java: the tech branch in `putDrawnItemBackInPBF`. */
function putTechBack(
  state: GameState,
  player: Playerhand,
  tech: TechItem,
  logType: GameLogEntry['logType'],
): ActionResult {
  const chosen = player.techsChosen.some((candidate) => candidate.name === tech.name)
  if (chosen) {
    // As in `removeTech`: a revealed coin tech starts its counter at 1, so the
    // counter goes with the card instead of staying behind in the Coins tab.
    const source = techCoinSource(tech.name)
    const next = withPlayer(state, {
      ...player,
      techsChosen: player.techsChosen.filter((candidate) => candidate.name !== tech.name),
      stats:
        source === undefined
          ? player.stats
          : { ...player.stats, coinSources: withCoinSource(player.stats.coinSources, source, 0) },
    })
    return ok(
      logUndo(next, player, tech, logType, (name) => `has removed ${name} from ${player.username}`),
    )
  }

  const inDiscard = state.discardedItems.some((candidate) => candidate.id === tech.id)
  if (inDiscard) {
    const next = withPlayer(
      {
        ...state,
        discardedItems: state.discardedItems.filter(
          (candidate) => candidate.id !== tech.id,
        ),
      },
      { ...player, techsChosen: [...player.techsChosen, tech] },
    )
    return ok(
      logUndo(next, player, tech, logType, (name) => `has added back ${name} to ${player.username}`),
    )
  }

  return err({ kind: 'ITEM_NOT_FOUND', sheetName: tech.sheetName })
}

/** Takes the item out of the hand or discard pile and puts it in the deck. */
function returnToDeck(
  state: GameState,
  player: Playerhand,
  item: Item,
  logType: GameLogEntry['logType'],
): GameState {
  const hidden: Item = { ...item, hidden: true, ownerId: null }

  const cleaned: GameState = {
    ...withPlayer(state, {
      ...player,
      items: player.items.filter((candidate) => candidate.id !== item.id),
    }),
    discardedItems: state.discardedItems.filter((candidate) => candidate.id !== item.id),
  }

  const withItem: GameState = { ...cleaned, items: [...cleaned.items, hidden] }
  const shuffled = shuffleDeckTwice(withItem)

  return logUndo(
    shuffled,
    player,
    item,
    logType,
    (name) =>
      `has removed ${name} from ${player.username} and put back in the deck. Deck is reshuffled`,
  )
}

/** Moves the item from the discard pile back into the player's hand. */
function returnToHand(
  state: GameState,
  player: Playerhand,
  item: Item,
  logType: GameLogEntry['logType'],
): GameState {
  const hidden: Item = { ...item, hidden: true }

  const next = withPlayer(
    {
      ...state,
      discardedItems: state.discardedItems.filter((candidate) => candidate.id !== item.id),
    },
    { ...player, items: [...player.items, hidden] },
  )

  return logUndo(next, player, item, logType, (name) => `has added back ${name} to ${player.username}`)
}

/**
 * The line for a carried out undo. Everyone reads the item as its original log
 * entry showed it; the owner reads it by name. Java printed the name for all.
 */
function logUndo(
  state: GameState,
  owner: Playerhand,
  item: Item,
  logType: GameLogEntry['logType'],
  message: (name: string) => string,
): GameState {
  const subject = publicItemSubject(logType, owner.username, item, state.logSecret)
  return appendUndoLog(state, message(subject.name), subject.itemNumber, {
    playerId: owner.playerId,
    message: message(itemName(item)),
  })
}

/**
 * Java: `shufflePBFTwice` shuffled the whole deck twice with
 * `new Random(System.nanoTime())`. Two shuffles are no better than one, but the
 * number of draws from the random source is kept so the seed advances the same.
 */
function shuffleDeckTwice(state: GameState): GameState {
  const [once, rngAfterFirst] = shuffle(state.items, state.rng)
  const [twice, rng] = shuffle(once, rngAfterFirst)
  return { ...state, items: twice, rng }
}

// ---------------------------------------------------------------------------
// The player puts an item back themselves
// ---------------------------------------------------------------------------

export interface PutBackInput {
  readonly playerId: string
  readonly sheetName: SheetName
  readonly name: string
}

/**
 * Java: `UndoAction.playerPutsItemBackInDeck` — no vote, the player just puts
 * something from their own hand back into the deck.
 */
export function playerPutsItemBackInDeck(
  state: GameState,
  input: PutBackInput,
): ActionResult {
  const player = findPlayer(state, input.playerId)
  if (player === undefined) {
    return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })
  }

  const item = player.items.find(
    (candidate) =>
      candidate.sheetName === input.sheetName && itemName(candidate) === input.name,
  )
  if (item === undefined) return err({ kind: 'ITEM_NOT_FOUND', sheetName: input.sheetName })

  if (item.kind === 'tech') return putTechBack(state, player, item, null)
  return ok(returnToDeck(state, player, item, null))
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Java: `getAllActiveUndos` — votes that have not been carried out. */
export function activeUndos(state: GameState): readonly GameLogEntry[] {
  return state.log.filter((entry) => entry.undo !== null && !entry.undo.done)
}

/** Java: `getPlayersActiveUndoes` — filtered on username. */
export function playersActiveUndos(
  state: GameState,
  username: string,
): readonly GameLogEntry[] {
  return activeUndos(state).filter((entry) => entry.username === username)
}

/** Java: `getAllFinishedUndos`. */
export function finishedUndos(state: GameState): readonly GameLogEntry[] {
  return state.log.filter((entry) => entry.undo !== null && entry.undo.done)
}
