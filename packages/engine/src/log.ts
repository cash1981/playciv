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
  const offset = Number(String(Math.abs(javaStringHashCode(username))).slice(0, 3))
  return `. Item number #${offset + itemNumber}`
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
    case 'REMOVED_TECH':
      return {
        privateLog: `${username} has removed ${DELIM}${all}${uniqueText}`,
        publicLog: `${username} has removed a hidden technology${uniqueText}`,
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
    case 'UNDO': {
      const text = `${username} has requested undo of ${DELIM}${all}${itemNumberText}`
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

/** Java: `GameLogAction.createUndoLog` — logged as coming from "System". */
export function appendUndoLog(
  state: GameState,
  message: string,
  itemNumber: number,
): GameState {
  const text = `System: ${message}. Item number #${itemNumber}`
  return appendLog(state, { username: 'System', privateLog: text, publicLog: text })
}

/**
 * Java: `GameLogAction.createGameLog(Draw, pbfId, username, vote)` — logglinjen
 * for a cast undo vote. Note that it reveals `revealPublic` of the item.
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
