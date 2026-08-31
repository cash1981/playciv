/**
 * Port av `no.asgari.civilization.server.action.UndoAction`.
 *
 * Én bevisst endring: Java avgjorde HVORDAN et item skulle legges tilbake ved å
 * lete etter delstrenger i logglinjen — `privateLog.contains("discarded")`,
 * `contains("drew")`, `contains("barbarian")`. Loggposten har en `logType`, som
 * er den samme informasjonen uten strengmatching, og den brukes her i stedet.
 *
 * Javas barbar-gren var for øvrig død kode: den krevde at logglinjen inneholdt
 * «drew», men barbarlogger skriver «has drawn». Barbarlogger har heller ikke
 * noe item knyttet til seg, så et undo av dem kunne aldri initieres. Grenen er
 * ikke portert.
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
 * Java: `UndoAction.initiateUndo` — starter en avstemning. Den som ber om undo
 * har stemt ja i det avstemningen opprettes.
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
 * Når alle har stemt og ingen stemte nei, utføres undoet med én gang. Én
 * nei-stemme gjør at avstemningen avsluttes uten at noe legges tilbake, men
 * Java satte da heller ikke `done`, så posten blir liggende som aktiv. Den
 * oppførselen er beholdt.
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

  // Java: eieren av itemet er den undoet gjelder, ikke den som stemte sist
  const ownerId = entry.item.ownerId ?? entry.playerId
  if (ownerId === null) return err({ kind: 'NOTHING_TO_UNDO', logId: input.logId })

  return putItemBack(next, ownerId, entry.item, entry.logType)
}

/**
 * Java: `putDrawnItemBackInPBF`. Hvor itemet skal tilbake avhenger av hva som
 * skjedde: et trekk går tilbake i stokken og stokken blandes, en kasting går
 * tilbake i hånden.
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

  // Et kastet item skal tilbake i hånden
  if (logType === 'DISCARD' && inDiscard) {
    return ok(returnToHand(state, player, item))
  }

  // Et trukket item skal tilbake i stokken
  if (logType === 'ITEM' && (inHand || inDiscard)) {
    return ok(returnToDeck(state, player, item))
  }

  // Java hadde en fallback for de tilfellene der itemet allerede lå i stokken
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

/** Java: teknologi-grenen i `putDrawnItemBackInPBF`. */
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

/** Fjerner itemet fra hånd eller kastebunke og legger det i stokken. */
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

/** Flytter itemet fra kastebunken tilbake i spillerens hånd. */
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
 * Java: `shufflePBFTwice` blandet hele stokken to ganger med
 * `new Random(System.nanoTime())`. To blandinger er ikke bedre enn én, men
 * antall trekk fra tilfeldighetskilden er bevart så seedforbruket stemmer.
 */
function shuffleDeckTwice(state: GameState): GameState {
  const [once, rngAfterFirst] = shuffle(state.items, state.rng)
  const [twice, rng] = shuffle(once, rngAfterFirst)
  return { ...state, items: twice, rng }
}

// ---------------------------------------------------------------------------
// Spilleren legger selv et item tilbake
// ---------------------------------------------------------------------------

export interface PutBackInput {
  readonly playerId: string
  readonly sheetName: SheetName
  readonly name: string
}

/**
 * Java: `UndoAction.playerPutsItemBackInDeck` — ingen avstemning, spilleren
 * legger noe fra egen hånd tilbake i stokken.
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
// Oppslag
// ---------------------------------------------------------------------------

/** Java: `getAllActiveUndos` — avstemninger som ikke er gjennomført. */
export function activeUndos(state: GameState): readonly GameLogEntry[] {
  return state.log.filter((entry) => entry.undo !== null && !entry.undo.done)
}

/** Java: `getPlayersActiveUndoes` — filtrert på brukernavn. */
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
