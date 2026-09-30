/**
 * Port of `GameLog.createAndSetLog` and `GameLogAction`.
 *
 * The texts are reproduced character for character, double spaces included.
 * Java wrote `username + " drew " + DELIM + ...` with `DELIM = " - "`, giving
 * "cash1981 drew  - Civ : Americans". The ported tests match on these strings,
 * so they have not been tidied up.
 */

import type { Item } from './item.js'
import { revealAll, revealPublic } from './item.js'
import type { GameLogEntry, GameState, LogType } from './state.js'
import { nextId } from './random.js'

const DELIM = ' - '

/**
 * Java: `GameLog.uniqueItemNumber` — used for techs and social policy, where
 * the item must not be cross-referenced between players. The number is offset
 * by the first three digits of `username.hashCode()`, so the same card gets a
 * different number for each player.
 */
export function uniqueItemNumber(username: string, itemNumber: number): string {
  return `. Item number #${uniqueNumber(username, itemNumber)}`
}

function uniqueNumber(username: string, itemNumber: number): number {
  const offset = Number(String(Math.abs(javaStringHashCode(username))).slice(0, 3))
  return offset + itemNumber
}

/** How a public line may name an item, and which number it may carry. */
export interface PublicItemSubject {
  readonly name: string
  readonly itemNumber: number
}

/**
 * The item as a line everyone can read may name it, when that line is about an
 * earlier log entry of type `logType`: an undo request, a vote, the result of
 * an undo. It gives away no more than the original entry's public line did.
 * A hidden tech or social policy stays hidden and carries the per-player number
 * (the plain one is the catalogue number, which anyone can look up). Draws show
 * the type only. Discards and reveals are public already, and so is a
 * tech the player has revealed.
 *
 * `username` is whoever the original entry belongs to. With no `logType`, the
 * item's own `hidden` flag decides.
 */
export function publicItemSubject(
  logType: LogType | null,
  username: string,
  item: Item,
): PublicItemSubject {
  const publicAlready =
    logType === 'DISCARD' ||
    logType === 'REVEAL' ||
    (logType === 'REMOVED_TECH' && !item.hidden) ||
    (logType === null && !item.hidden)
  const itemNumber =
    item.kind === 'tech' || item.kind === 'socialpolicy'
      ? uniqueNumber(username, item.itemNumber)
      : item.itemNumber
  if (publicAlready) return { name: revealAll(item), itemNumber }
  if (item.kind === 'tech') return { name: 'a hidden technology', itemNumber }
  if (item.kind === 'socialpolicy') return { name: 'a hidden social policy', itemNumber }
  return { name: revealPublic(item), itemNumber }
}

/**
 * The undo request for an earlier entry of type `original`. The requester sees
 * the whole item, everyone else the subject of `publicItemSubject`.
 */
export function createUndoRequestTexts(
  username: string,
  original: LogType | null,
  item: Item,
  ownerUsername: string = username,
): LogTexts {
  const subject = publicItemSubject(original, ownerUsername, item)
  const suffix = `. Item number #${subject.itemNumber}`
  return {
    privateLog: `${username} has requested undo of ${DELIM}${revealAll(item)}${suffix}`,
    publicLog: `${username} has requested undo of ${DELIM}${subject.name}${suffix}`,
  }
}

/** Java's `String.hashCode()`, as a 32-bit integer. */
export function javaStringHashCode(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0
  }
  return hash
}

export interface LogTexts {
  readonly privateLog: string
  readonly publicLog: string
}

/**
 * Java: `GameLog.createAndSetLog(LogType, int)`.
 *
 * Note which types hide their contents publicly: SOCIAL_POLICY, TECH and
 * REMOVED_TECH. The rest reveal `revealPublic()`, which for most types is just
 * the class name.
 */
export function createLogTexts(
  logType: LogType,
  username: string,
  item: Item | null,
  itemNumber: number,
  turnNumber?: number,
): LogTexts {
  const itemNumberText = `. Item number #${itemNumber}`
  const uniqueText = uniqueItemNumber(username, itemNumber)
  const all = item === null ? '' : revealAll(item)
  const pub = item === null ? '' : revealPublic(item)

  switch (logType) {
    case 'ITEM':
      return {
        privateLog: `${username} drew ${DELIM}${all}${itemNumberText}`,
        publicLog: `${username} drew ${DELIM}${pub}${itemNumberText}`,
      }
    case 'BATTLE':
      return {
        privateLog: `${username} plays ${DELIM}${all}`,
        publicLog: `${username} reveals ${DELIM}${pub}`,
      }
    case 'TRADE_BETWEEN_PLAYERS':
      return {
        privateLog: `${username} has received ${DELIM}${all}`,
        publicLog: `${username} has received ${DELIM}${pub}`,
      }
    case 'SOCIAL_POLICY':
      return {
        privateLog: `${username} has chosen ${DELIM}${all}${uniqueText}`,
        publicLog: `${username} has chosen a hidden social policy${uniqueText}`,
      }
    case 'TECH':
      return {
        privateLog: `${username} has researched ${DELIM}${all}${uniqueText}`,
        publicLog: `${username} has researched a hidden technology${uniqueText}`,
      }
    // A tech the player has already revealed is public, so its removal names it.
    // The unique number is the same one the TECH and REVEAL lines carry, which
    // is how a removal is tied back to the card.
    case 'REMOVED_TECH':
      return {
        privateLog: `${username} has removed ${DELIM}${all}${uniqueText}`,
        publicLog:
          item !== null && item.kind === 'tech' && !item.hidden
            ? `${username} has removed ${DELIM}${all}${uniqueText}`
            : `${username} has removed a hidden technology${uniqueText}`,
      }
    case 'REMOVED_SOCIAL_POLICY':
      return {
        privateLog: `${username} has removed ${DELIM}${all}${uniqueText}`,
        publicLog: `${username} has removed a hidden social policy${uniqueText}`,
      }
    // Java: DISCARD reveals everything publicly too — the card is out of play
    case 'DISCARD':
      return {
        privateLog: `${username} has discarded ${DELIM}${all}${itemNumberText}`,
        publicLog: `${username} has discarded ${DELIM}${all}${itemNumberText}`,
      }
    case 'REVEAL': {
      const suffix =
        item !== null && (item.kind === 'tech' || item.kind === 'socialpolicy')
          ? uniqueText
          : itemNumberText
      const text = `${username} has revealed ${DELIM}${all}${suffix}`
      return { privateLog: text, publicLog: text }
    }
    // The undo request has its own writer, `appendUndoRequestLog`, which knows
    // what the undone entry was. Without that, be careful.
    case 'UNDO': {
      if (item !== null) return createUndoRequestTexts(username, null, item)
      const text = `${username} has requested undo of ${DELIM}${itemNumberText}`
      return { privateLog: text, publicLog: text }
    }
    case 'SOT':
      return phase(username, 'start of turn', turnNumber)
    case 'SETUP':
      return phase(username, 'setup', turnNumber)
    case 'TRADE':
      return phase(username, 'trade', turnNumber)
    case 'CM':
      return phase(username, 'city management', turnNumber)
    case 'MOVEMENT':
      return phase(username, 'movement', turnNumber)
    case 'RESEARCH':
      return phase(username, 'research', turnNumber)
    // Java set no text for these in createAndSetLog
    case 'SHUFFLE':
    case 'WITHDRAW':
    case 'JOIN':
    case 'VOTE':
      return { privateLog: '', publicLog: '' }
  }
}

function phase(username: string, name: string, turnNumber?: number): LogTexts {
  const prefix = turnNumber === undefined ? '' : `Turn ${turnNumber} - `
  const text = `${prefix}${username} has updated ${name} phase`
  return { privateLog: text, publicLog: text }
}

// ---------------------------------------------------------------------------
// Loggskriving
// ---------------------------------------------------------------------------

interface AppendOptions {
  readonly username: string
  readonly logType?: LogType
  readonly privateLog?: string
  readonly publicLog?: string
  readonly item?: Item
  readonly playerId?: string
  /** ISO timestamp, supplied by the caller since the engine stays pure. */
  readonly createdAt?: string | null
}

/** Appends one log entry and returns the new state. */
export function appendLog(state: GameState, options: AppendOptions): GameState {
  const [id, rng] = nextId(state.rng)
  const entry: GameLogEntry = {
    id,
    username: options.username,
    logType: options.logType ?? null,
    privateLog: options.privateLog ?? '',
    publicLog: options.publicLog ?? '',
    item: options.item ?? null,
    playerId: options.playerId ?? null,
    undo: null,
    createdAt: options.createdAt ?? null,
  }
  return { ...state, rng, log: [...state.log, entry] }
}

/**
 * Java: `GameLogAction.createUndoLog` — logged as coming from "System".
 *
 * `message` is what everyone reads. When the owner of the item may read more
 * than that, `owner` carries their id and the full wording, and only they see it.
 */
export function appendUndoLog(
  state: GameState,
  message: string,
  itemNumber: number,
  owner?: { readonly playerId: string; readonly message: string },
): GameState {
  const text = `System: ${message}. Item number #${itemNumber}`
  return appendLog(state, {
    username: 'System',
    ...(owner === undefined ? {} : { playerId: owner.playerId }),
    privateLog: owner === undefined ? text : `System: ${owner.message}. Item number #${itemNumber}`,
    publicLog: text,
  })
}

/**
 * The start of an undo vote for an earlier entry of type `original`, which
 * belongs to `ownerUsername`. Java used the item's full text for everyone.
 */
export function appendUndoRequestLog(
  state: GameState,
  username: string,
  playerId: string,
  item: Item,
  original: LogType | null,
  ownerUsername: string,
): GameState {
  const texts = createUndoRequestTexts(username, original, item, ownerUsername)
  return appendLog(state, { username, logType: 'UNDO', item, playerId, ...texts })
}

/**
 * Java: `GameLogAction.createGameLog(Draw, pbfId, username, vote)` — logglinjen
 * for a cast undo vote. `itemPublicName` and `itemNumber` come from
 * `publicItemSubject`, so a hidden tech or social policy stays hidden.
 */
export function appendVoteLog(
  state: GameState,
  username: string,
  playerId: string,
  itemPublicName: string,
  itemNumber: number,
  vote: boolean,
): GameState {
  return appendLog(state, {
    username,
    playerId,
    logType: 'VOTE',
    publicLog: `${username} has voted ${vote ? 'yes' : 'no'} to undo ${itemPublicName} with item number ${itemNumber}`,
  })
}

/** Java: `GameLogAction.createGameLog(Draw, LogType)`. */
export function appendItemLog(
  state: GameState,
  logType: LogType,
  username: string,
  playerId: string,
  item: Item,
): GameState {
  const texts = createLogTexts(logType, username, item, item.itemNumber)
  return appendLog(state, { username, logType, item, playerId, ...texts })
}

/**
 * The random Great Person discard (`discardRandomGreatPerson`), which has no
 * Java counterpart. It keeps the `DISCARD` log type so undo still returns the
 * card to hand, but says "randomly" the way the loot lines do — the human asked
 * for that wording.
 */
export function appendRandomDiscardLog(
  state: GameState,
  username: string,
  playerId: string,
  item: Item,
): GameState {
  const text = `${username} has randomly discarded ${DELIM}${revealAll(item)}. Item number #${item.itemNumber}`
  return appendLog(state, {
    username,
    logType: 'DISCARD',
    item,
    playerId,
    privateLog: text,
    publicLog: text,
  })
}

/** Java: `GameLogAction.createCommonPublicLog` — prefixes the username. */
export function appendPublicLog(
  state: GameState,
  username: string,
  playerId: string,
  message: string,
): GameState {
  return appendLog(state, {
    username,
    playerId,
    publicLog: `${username} ${message}`,
    privateLog: '',
  })
}

/** Java: `GameLogAction.createCommonPrivateLog`. */
export function appendPrivateLog(
  state: GameState,
  username: string,
  playerId: string,
  message: string,
): GameState {
  return appendLog(state, {
    username,
    playerId,
    privateLog: `${username} ${message}`,
    publicLog: '',
  })
}

/** Java: `GameLogAction.createCommonPrivatePublicLog`. */
export function appendPrivatePublicLog(
  state: GameState,
  username: string,
  playerId: string,
  message: string,
): GameState {
  return appendLog(state, {
    username,
    playerId,
    privateLog: `${username} ${message}`,
    publicLog: `${username} ${message}`,
  })
}

/** Java: `DrawAction.logShuffle` — logged as coming from "System". */
export function appendShuffleLog(state: GameState, sheetLabel: string): GameState {
  return appendLog(state, {
    username: 'System',
    logType: 'SHUFFLE',
    publicLog: `${sheetLabel} reshuffled and put back in the deck`,
  })
}

/** Java: `BaseAction.createInfoLog`. */
export function appendInfoLog(state: GameState, message: string): GameState {
  return appendLog(state, { username: 'System', publicLog: `System: ${message}` })
}
