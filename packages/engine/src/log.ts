/**
 * Port av `GameLog.createAndSetLog` og `GameLogAction`.
 *
 * Tekstene er gjengitt tegn for tegn, doble mellomrom inkludert. Java skrev
 * `username + " drew " + DELIM + ...` med `DELIM = " - "`, som ga
 * «cash1981 drew  - Civ : Americans». De porterte testene matcher på disse
 * strengene, så de er ikke ryddet opp i.
 */

import type { Item } from './item.js'
import { revealAll, revealPublic } from './item.js'
import type { GameLogEntry, GameState, LogType } from './state.js'
import { nextId } from './random.js'

const DELIM = ' - '

/**
 * Java: `GameLog.uniqueItemNumber` — brukes for tech og sosialpolitikk, der
 * itemet ikke skal kunne kryssrefereres mellom spillere. Nummeret forskyves med
 * de tre første sifrene av `username.hashCode()`, så samme kort får
 * forskjellig nummer for hver spiller.
 */
export function uniqueItemNumber(username: string, itemNumber: number): string {
  const offset = Number(String(Math.abs(javaStringHashCode(username))).slice(0, 3))
  return `. Item number #${offset + itemNumber}`
}

/** Javas `String.hashCode()`, som 32-bits heltall. */
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
 * Merk hvilke typer som skjuler innholdet offentlig: SOCIAL_POLICY, TECH og
 * REMOVED_TECH. De øvrige avslører `revealPublic()`, som for de fleste typer
 * bare er klassenavnet.
 */
export function createLogTexts(
  logType: LogType,
  username: string,
  item: Item | null,
  itemNumber: number,
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
    // Java: DISCARD avslører alt også offentlig — kortet er ute av spill
    case 'DISCARD':
      return {
        privateLog: `${username} has discarded ${DELIM}${all}${itemNumberText}`,
        publicLog: `${username} has discarded ${DELIM}${all}${itemNumberText}`,
      }
    case 'REVEAL': {
      const suffix = item !== null && item.kind === 'tech' ? uniqueText : itemNumberText
      const text = `${username} has revealed ${DELIM}${all}${suffix}`
      return { privateLog: text, publicLog: text }
    }
    case 'UNDO': {
      const text = `${username} has requested undo of ${DELIM}${all}${itemNumberText}`
      return { privateLog: text, publicLog: text }
    }
    case 'SOT':
      return phase(username, 'start of turn')
    case 'SETUP':
      return phase(username, 'setup')
    case 'TRADE':
      return phase(username, 'trade')
    case 'CM':
      return phase(username, 'city management')
    case 'MOVEMENT':
      return phase(username, 'movement')
    case 'RESEARCH':
      return phase(username, 'research')
    // Java satte ingen tekst for disse i createAndSetLog
    case 'SHUFFLE':
    case 'WITHDRAW':
    case 'JOIN':
    case 'REMOVED_SOCIAL_POLICY':
    case 'VOTE':
      return { privateLog: '', publicLog: '' }
  }
}

function phase(username: string, name: string): LogTexts {
  const text = `${username} has updated ${name} phase`
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
}

/** Legger til én loggpost og returnerer ny tilstand. */
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
  }
  return { ...state, rng, log: [...state.log, entry] }
}

/** Java: `GameLogAction.createUndoLog` — logges som avsender "System". */
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
 * for en avgitt undo-stemme. Merk at den avslører `revealPublic` av itemet.
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

/** Java: `GameLogAction.createCommonPublicLog` — prefikser med brukernavn. */
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

/** Java: `DrawAction.logShuffle` — logges som avsender "System". */
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
