/**
 * Mark Twain (issue #301): "Any Time: You may discard this card to cancel a city action, a resource ability, or a
 * culture event. If you cancel a resource ability, the resources used to pay for it are lost."
 *
 * The design notes on #301 (the human, 2026-11-03). The turn is played in one go, so the cancelled action may have
 * later actions that depend on it. Cancelling action N therefore rewinds the game to the state just before N, and
 * everything after N is lost; everything before it stays. The cancelled action still costs something:
 *
 * - a cancelled city action stays on the record as the city's action of the turn (`status: 'cancelled'`), so the
 *   city has already acted;
 * - a cancelled culture event is discarded, not returned to the hand;
 * - Mark Twain is discarded;
 * - the decks the later actions drew from are shuffled again, from the state's own random sequence, because the
 *   player has seen the cards they drew.
 *
 * The engine is pure, so the earlier state is given to it: the server reads it from the stored revisions. Only the
 * actions of one player can be rewound: if somebody else has acted since, the rewind would erase their action,
 * and it is refused. A resource ability is not logged yet, so it cannot be picked; it is rewound with an earlier
 * action. Cannot be cancelled: the city actions of a player with a faceup Dr. Martin Luther King (no Humanitarian
 * figure blockaded), Jerry Garcia's devotion and the extra city action of Ada Lovelace (both say so on the card).
 */

import { cityActionOf } from './assisted-core.js'
import { shuffleSheetTwice } from './assisted-culture.js'
import { blockadedGreatPersonTypes } from './blockade.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { SheetName } from './sheet-name.js'
import type { AssistedActionRecord, GameState, Playerhand } from './state.js'
import { appendLog } from './log.js'
import { turnStatus } from './turn.js'

export const TWAIN_NAME = 'Mark Twain'
export const KING_NAME = 'Dr. Martin Luther King'

/** One action Mark Twain can cancel now. */
export interface TwainTarget {
  readonly logId: string
  readonly playerId: string
  readonly username: string
  readonly kind: 'city' | 'culture'
  /** The public line the action wrote. */
  readonly text: string
  /** The public lines of the actions after it that the rewind takes with it. */
  readonly rolledBack: readonly string[]
  /** Why it cannot be cancelled now (shown greyed out in the list), or `null` when it can. */
  readonly blocked: string | null
}

const holdsFaceupKing = (state: GameState, player: Playerhand): boolean =>
  player.items.some((item) => item.kind === 'greatperson' && item.name === KING_NAME && !item.hidden) &&
  !blockadedGreatPersonTypes(state, player).includes('Humanitarian')

/** Why one applied action cannot be cancelled, or `undefined` when it can. */
function refusalFor(state: GameState, record: AssistedActionRecord): string | undefined {
  if (record.status !== 'applied') return 'That action is no longer in force.'
  const actor = state.players.find((candidate) => candidate.playerId === record.playerId)
  if (actor === undefined) return 'That player has left the game.'
  // Any phase of this turn: a quick player may have ended theirs, and the players keep an eye on it (human 2026-11-04)
  if (record.turnNumber !== turnStatus(state).currentTurn) {
    return 'Only an action of the current turn can be cancelled.'
  }
  const effect = record.effect
  if (effect.kind === 'playCard' && effect.garcia !== undefined) {
    return 'Jerry Garcia’s devotion cannot be canceled.'
  }
  if (cityActionOf(record) !== undefined) {
    if (record.lovelaceCreditId !== undefined) return 'An extra city action from Ada Lovelace cannot be canceled.'
    if (holdsFaceupKing(state, actor)) return `${actor.username}'s city actions cannot be canceled: Dr. Martin Luther King is faceup.`
    return undefined
  }
  if (effect.kind === 'playCard' && effect.item.kind.startsWith('culture')) return undefined
  return 'Only a city action or a culture event can be cancelled.'
}

const kindOf = (record: AssistedActionRecord): 'city' | 'culture' => (cityActionOf(record) === undefined ? 'culture' : 'city')

/** The public lines written after a log line, by anybody, that are text. */
function linesAfter(state: GameState, logId: string): readonly string[] {
  const at = state.log.findIndex((entry) => entry.id === logId)
  return at < 0 ? [] : state.log.slice(at + 1).flatMap((entry) => (entry.publicLog === '' ? [] : [entry.publicLog]))
}

/** Players, other than the actor, who wrote a line after the action: their action would be erased by a rewind. */
function othersActedAfter(state: GameState, logId: string, actorId: string): boolean {
  const at = state.log.findIndex((entry) => entry.id === logId)
  return state.log.slice(at + 1).some((entry) => entry.playerId !== null && entry.playerId !== actorId)
}

const twainCardOf = (player: Playerhand) => {
  const pendingCandidates = new Set(player.pendingRewards.flatMap((reward) => reward.candidateIds))
  return player.items.find((item) => item.kind === 'greatperson' && item.name === TWAIN_NAME && !pendingCandidates.has(item.id))
}

/** Why the holder cannot cancel anything with Mark Twain now, or `undefined`. */
export function twainBlock(state: GameState, holder: Playerhand): string | undefined {
  const card = twainCardOf(holder)
  if (card === undefined) return 'Mark Twain is not in your hand.'
  if (card.kind === 'greatperson' && card.type !== null && blockadedGreatPersonTypes(state, holder).includes(card.type)) {
    return `Every ${card.type} figure of yours is blockaded, so ${TWAIN_NAME} cannot be used.`
  }
  return undefined
}

/**
 * This turn's city actions and culture events, newest last, each with why it cannot be cancelled now or `null`. A list
 * that left the others out would not tell the holder why the action they look for is missing. Public information only.
 */
export function twainTargetsOf(state: GameState, holder: Playerhand): readonly TwainTarget[] {
  if (twainBlock(state, holder) !== undefined) return []
  return state.assistedActions.flatMap((record): readonly TwainTarget[] => {
    if (record.status !== 'applied' || record.turnNumber !== turnStatus(state).currentTurn) return []
    const isCityAction = cityActionOf(record) !== undefined
    if (!isCityAction && !(record.effect.kind === 'playCard' && record.effect.item.kind.startsWith('culture'))) return []
    const entry = state.log.find((candidate) => candidate.id === record.logId)
    const actor = state.players.find((candidate) => candidate.playerId === record.playerId)
    if (entry === undefined || actor === undefined) return []
    const blocked =
      record.playerId === holder.playerId
        ? 'Your own action: Mark Twain cancels the action of another player.'
        : (refusalFor(state, record) ??
          (othersActedAfter(state, record.logId, record.playerId)
            ? 'Someone else has acted since, and the rewind would erase it.'
            : null))
    return [
      {
        logId: record.logId,
        playerId: record.playerId,
        username: actor.username,
        kind: isCityAction ? 'city' : 'culture',
        text: entry.publicLog,
        rolledBack: linesAfter(state, record.logId),
        blocked,
      },
    ]
  })
}

/** The record behind a log line, for the server to find which revision wrote it. */
export const twainRecordOf = (state: GameState, logId: string): AssistedActionRecord | undefined =>
  state.assistedActions.find((record) => record.logId === logId)

const deckIds = (state: GameState, sheetName: SheetName): string =>
  state.items
    .filter((item) => item.sheetName === sheetName)
    .map((item) => item.id)
    .join(',')

export interface TwainInput {
  readonly holderId: string
  readonly logId: string
  readonly at?: string
}

/**
 * Cancels the action behind `logId` with the holder's Mark Twain. `current` is the game as it is, `earlier` the game
 * just before that action. `Err` is a sentence for the player and nothing changes.
 */
export function cancelWithTwain(current: GameState, earlier: GameState, input: TwainInput): Result<GameState, string> {
  const holder = current.players.find((candidate) => candidate.playerId === input.holderId)
  if (holder === undefined) return err('You are not a player in this game.')
  const block = twainBlock(current, holder)
  if (block !== undefined) return err(block)
  const record = twainRecordOf(current, input.logId)
  if (record === undefined) return err('That action cannot be found.')
  if (record.playerId === holder.playerId) return err('Mark Twain cancels the action of another player.')
  const refusal = refusalFor(current, record)
  if (refusal !== undefined) return err(refusal)
  if (othersActedAfter(current, input.logId, record.playerId)) {
    return err('Another player has acted since, and the rewind would erase their action.')
  }
  const target = current.log.find((entry) => entry.id === input.logId)
  if (target === undefined) return err('That action cannot be found.')
  // `earlier` must be exactly the game before the action: the log up to it, nothing more and nothing less
  const targetAt = current.log.findIndex((entry) => entry.id === input.logId)
  const prefix = current.log.slice(0, targetAt)
  if (
    earlier.id !== current.id ||
    twainRecordOf(earlier, input.logId) !== undefined ||
    earlier.log.length !== prefix.length ||
    earlier.log.some((entry, index) => entry.id !== prefix[index]?.id)
  ) {
    return err('The game before that action could not be restored.')
  }
  const actor = current.players.find((candidate) => candidate.playerId === record.playerId)
  const twain = twainCardOf(holder)
  const heldTwain = earlier.players.find((candidate) => candidate.playerId === holder.playerId)?.items.find((item) => item.id === twain?.id)
  if (actor === undefined || twain === undefined || heldTwain === undefined) {
    return err('Mark Twain was not in your hand before that action.')
  }
  const rolledBack = linesAfter(current, input.logId)

  // The game as it was, with what the rewind must not take back: the private notes, the key of the public item
  // numbers and the random sequence (so the new shuffle is not the one the player has seen)
  const notes = new Map([...current.players, ...current.withdrawnPlayers].map((player) => [player.playerId, player.gamenote]))
  const restore = (player: Playerhand): Playerhand => ({ ...player, gamenote: notes.get(player.playerId) ?? player.gamenote })
  let state: GameState = {
    ...earlier,
    players: earlier.players.map(restore),
    withdrawnPlayers: earlier.withdrawnPlayers.map(restore),
    rev: current.rev,
    logSecret: current.logSecret,
    rng: current.rng,
    // The line stays as history; a vote to undo it, started before it was cancelled, can no longer be taken
    log: [...earlier.log, { ...target, undo: null }],
    // Item numbers the rolled-back actions took are not given out again
    itemCounter: Math.max(current.itemCounter, earlier.itemCounter),
    assistedActions: [...earlier.assistedActions, { ...record, status: 'cancelled' }],
  }

  // Mark Twain and a cancelled culture event go to the discard pile; the cancelled event is gone from the hand
  const discarded = [
    twain,
    ...(record.effect.kind === 'playCard' && kindOf(record) === 'culture' ? [record.effect.item] : []),
  ]
  const leaves = new Set(discarded.map((card) => card.id))
  state = {
    ...state,
    players: state.players.map((player) =>
      player.items.some((item) => leaves.has(item.id))
        ? { ...player, items: player.items.filter((item) => !leaves.has(item.id)) }
        : player,
    ),
    discardedItems: [
      ...state.discardedItems.filter((item) => !leaves.has(item.id)),
      ...discarded.map((card) => ({ ...card, hidden: true })),
    ],
  }

  // The decks the later actions drew from, shuffled again
  const sheets = new Set<SheetName>([...current.items, ...state.items].map((item) => item.sheetName))
  for (const sheetName of sheets) {
    if (deckIds(current, sheetName) !== deckIds(state, sheetName)) state = shuffleSheetTwice(state, sheetName)
  }

  const label = kindOf(record) === 'city' ? 'city action' : 'culture event'
  state = appendLog(state, {
    username: holder.username,
    playerId: holder.playerId,
    publicLog:
      `${holder.username} cancelled the ${label} of ${actor.username} with ${TWAIN_NAME}: “${target.publicLog}”` +
      (rolledBack.length === 0
        ? ''
        : `. The game went back to just before it, so ${rolledBack.length} later ${rolledBack.length === 1 ? 'log line is' : 'log lines are'} lost`) +
      (kindOf(record) === 'culture' ? '. The event card is discarded' : '. The city has used its action for the turn') +
      ' and Mark Twain is discarded',
    privateLog: '',
    ...(input.at === undefined ? {} : { createdAt: input.at }),
  })
  return ok(state)
}
