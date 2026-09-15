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

import type { EngineError } from '../errors.js'
import type { Item, TechItem } from '../item.js'
import { itemName, revealPublic } from '../item.js'
import { appendItemLog, appendUndoLog, appendVoteLog } from '../log.js'
import { shuffle } from '../random.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { SheetName } from '../sheet-name.js'
import type { GameLogEntry, GameState, Playerhand } from '../state.js'
import {
  findLogEntry,
  findPlayer,
  hasUserAccess,
  withLogEntry,
  withPlayer,
} from '../state.js'
import { castVote, createUndo, resultOfVotes } from '../undo.js'

type ActionResult = Result<GameState, EngineError>

export interface InitiateUndoInput {
  readonly logId: string
  readonly playerId: string
}

/**
 * Java: `UndoAction.initiateUndo` — starts a vote. Whoever asks for the undo
 * has voted yes the moment the vote is created.
 */
export function initiateUndo(state: GameState, input: InitiateUndoInput): ActionResult {
  const entry = findLogEntry(state, input.logId)
  if (entry === undefined) return err({ kind: 'LOG_ENTRY_NOT_FOUND', logId: input.logId })
  if (entry.item === null) return err({ kind: 'NOTHING_TO_UNDO', logId: input.logId })
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

  return ok(appendItemLog(next, 'UNDO', player.username, input.playerId, entry.item))
}

export interface VoteInput {
  readonly logId: string
  readonly playerId: string
  readonly vote: boolean
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
  if (entry.item === null) return err({ kind: 'NOTHING_TO_UNDO', logId: input.logId })

  const voter = findPlayer(state, input.playerId)
  if (voter === undefined) return err({ kind: 'PLAYER_NOT_FOUND', playerId: input.playerId })

  const undo = castVote(entry.undo, input.playerId, input.vote)
  const result = resultOfVotes(undo)
  const accepted = result === true

  let next = withLogEntry(state, { ...entry, undo: { ...undo, done: accepted } })
  next = appendVoteLog(
    next,
    voter.username,
    input.playerId,
    revealPublic(entry.item),
    entry.item.itemNumber,
    input.vote,
  )

  if (!accepted) return ok(next)

  // Java: the undo belongs to the owner of the item, not the last voter
  const ownerId = entry.item.ownerId ?? entry.playerId
  if (ownerId === null) return err({ kind: 'NOTHING_TO_UNDO', logId: input.logId })

  return putItemBack(next, ownerId, entry.item, entry.logType)
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

  if (item.kind === 'tech') return putTechBack(state, player, item)

  const inHand = player.items.some((candidate) => candidate.id === item.id)
  const inDiscard = state.discardedItems.some((candidate) => candidate.id === item.id)
  const inDeck = state.items.some((candidate) => candidate.id === item.id)

  // A discarded item goes back into the hand
  if (logType === 'DISCARD' && inDiscard) {
    return ok(returnToHand(state, player, item))
  }

  // A drawn item goes back into the deck
  if (logType === 'ITEM' && (inHand || inDiscard)) {
    return ok(returnToDeck(state, player, item))
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
      appendUndoLog(
        next,
        `has added back ${itemName(item)} to ${player.username}`,
        item.itemNumber,
      ),
    )
  }

  if (inHand) return ok(returnToDeck(state, player, item))
  if (inDiscard) return ok(returnToHand(state, player, item))

  return err({ kind: 'ITEM_NOT_FOUND', sheetName: item.sheetName })
}

/** Java: the tech branch in `putDrawnItemBackInPBF`. */
function putTechBack(state: GameState, player: Playerhand, tech: TechItem): ActionResult {
  const chosen = player.techsChosen.some((candidate) => candidate.name === tech.name)
  if (chosen) {
    const next = withPlayer(state, {
      ...player,
      techsChosen: player.techsChosen.filter((candidate) => candidate.name !== tech.name),
    })
    return ok(
      appendUndoLog(
        next,
        `has removed ${tech.name} from ${player.username}`,
        tech.itemNumber,
      ),
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
      appendUndoLog(
        next,
        `has added back ${tech.name} to ${player.username}`,
        tech.itemNumber,
      ),
    )
  }

  return err({ kind: 'ITEM_NOT_FOUND', sheetName: tech.sheetName })
}

/** Takes the item out of the hand or discard pile and puts it in the deck. */
function returnToDeck(state: GameState, player: Playerhand, item: Item): GameState {
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

  return appendUndoLog(
    shuffled,
    `has removed ${itemName(item)} from ${player.username} and put back in the deck. Deck is reshuffled`,
    item.itemNumber,
  )
}

/** Moves the item from the discard pile back into the player's hand. */
function returnToHand(state: GameState, player: Playerhand, item: Item): GameState {
  const hidden: Item = { ...item, hidden: true }

  const next = withPlayer(
    {
      ...state,
      discardedItems: state.discardedItems.filter((candidate) => candidate.id !== item.id),
    },
    { ...player, items: [...player.items, hidden] },
  )

  return appendUndoLog(
    next,
    `has added back ${itemName(item)} to ${player.username}`,
    item.itemNumber,
  )
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

  if (item.kind === 'tech') return putTechBack(state, player, item)
  return ok(returnToDeck(state, player, item))
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
