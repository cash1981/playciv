/**
 * Cancellations (Mark Twain, Jousting Tourney, Primetime TV, Bread and Circuses) and their counters
 * (a culture reaction, or Dr. Martin Luther King's protection). Each one takes effect at once, as an event
 * on the log; nobody is asked to respond. Saved revisions are supplied by the server, never embedded in
 * state or views.
 */
import { cityActionOf } from './assisted-core.js'
import { shuffleSheetTwice } from './assisted-culture.js'
import { blockadedGreatPersonTypes, pieceColorOf } from './blockade.js'
import type { EngineError } from './errors.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { AssistedActionRecord, GameState, Playerhand } from './state.js'
import { createPlayerTurn, publicTurn, publicTurnKey, turnStatus, TURN_PHASES } from './turn.js'
import { KING_NAME, TWAIN_NAME, availableKingId, cancellationRefusal, twainTargetsOf } from './twain.js'

export const CULTURE_CANCELLATIONS = ['Bread and Circuses', 'Jousting Tourney', 'Primetime TV'] as const
export const isCancellationCard = (name: string): boolean =>
  name === TWAIN_NAME || (CULTURE_CANCELLATIONS as readonly string[]).includes(name)

/**
 * `cancel` rewinds an action; `counter` undoes the latest event with a culture reaction; `protect` is King
 * undoing a cancellation of his holder's city action, which leaves Twain in hand.
 */
export interface CancellationEvent {
  readonly id: string
  readonly kind: 'cancel' | 'counter' | 'protect'
  readonly playerId: string
  readonly card: Item
  /** The event's own log line, which a counter targets. */
  readonly logId: string
  /** The action's log line for `cancel`; the previous event's log line otherwise. */
  readonly targetLogId: string
  /** `rev` of the game just before this event: the saved state a counter rewinds to. */
  readonly priorRevision: number
}
export interface CancellationHistory {
  readonly floorTurn: number
  /** Log entries sealed by an event, so a later rewind cannot refund its card costs. */
  readonly sealedThrough: number
  /** Oldest first. Only the last one can be countered. */
  readonly events: readonly CancellationEvent[]
  /** Private request fingerprints prevent a retry from changing its meaning. */
  readonly requests: readonly { readonly id: string; readonly playerId: string; readonly fingerprint: string }[]
}
/** `logId` is an action's log line, or the latest event's log line to counter it. */
export interface CancellationCommand {
  readonly logId: string
  readonly itemId: string
}

export const cancellationHistory = (state: GameState): CancellationHistory => state.cancellations ?? {
  floorTurn: turnStatus(state).currentTurn, sealedThrough: 0, events: [], requests: [],
}

const reject = (reason: string): Result<GameState, EngineError> =>
  err({ kind: 'ASSISTED_ACTION_REJECTED', action: 'playCard', status: 'unavailable', reason })

const eventLogId = (id: string): string => `cancellation:${id}`

/** Events must not advance the gameplay random stream. IDs come from the request. */
function eventLog(state: GameState, id: string, publicLog: string, playerId: string): GameState {
  return { ...state, log: [...state.log, {
    id: eventLogId(id), publicLog, playerId,
    username: state.players.find((p) => p.playerId === playerId)?.username ?? 'System',
    privateLog: '', item: null, undo: null, logType: null, createdAt: null,
  }] }
}

export function availableReactionCard(state: GameState, playerId: string, itemId: string): Item | undefined {
  const player = state.players.find((p) => p.playerId === playerId)
  if (player === undefined || player.pendingRewards.some((r) => r.candidateIds.includes(itemId))) return undefined
  const card = player.items.find((i) => i.id === itemId)
  if (card?.kind === 'greatperson' && card.type !== null && blockadedGreatPersonTypes(state, player).includes(card.type)) return undefined
  return card
}

/** A Bread and Circuses cancellation targets a card, not its owner. It cannot counter an event. */
function canCancel(card: Item, record: AssistedActionRecord, playerId: string, state: GameState): boolean {
  const name = itemName(card)
  if (name === KING_NAME) return false
  if (name === TWAIN_NAME) return record.playerId !== playerId
  if (record.effect.kind !== 'playCard' || !record.effect.item.kind.startsWith('culture')) return false
  if (name === 'Bread and Circuses') {
    if (record.effect.targets.includes(playerId)) return true
    const color = state.players.find((p) => p.playerId === playerId)?.color?.toLowerCase()
    return color !== undefined && record.effect.cardMove?.moves.some((move) => {
      const piece = state.board.pieces.find((p) => p.id === move.pieceId)
      return piece !== undefined && pieceColorOf(piece) === color
    }) === true
  }
  return name === 'Jousting Tourney' || name === 'Primetime TV'
}

/**
 * Whether a card can undo the latest event. Twain counters another player's culture cancellation but can
 * not itself be culture-countered; King only protects his holder's city action from a cancellation.
 */
function canCounter(card: Item, event: CancellationEvent, playerId: string, state: GameState): boolean {
  const name = itemName(card)
  if (name === KING_NAME) {
    const record = state.assistedActions.find((r) => r.logId === event.targetLogId)
    return event.kind === 'cancel' && record !== undefined && cityActionOf(record) !== undefined && record.playerId === playerId
  }
  return event.kind !== 'protect' && event.card.kind.startsWith('culture') &&
    (name === 'Jousting Tourney' || name === 'Primetime TV' || (name === TWAIN_NAME && event.playerId !== playerId))
}

function validBaseline(current: GameState, baseline: GameState, record: AssistedActionRecord): boolean {
  // An action may write several log lines. Its primary log is NOT the revision boundary.
  const at = current.assistedActions.findIndex((r) => r.id === record.id)
  return baseline.id === current.id &&
    baseline.rev === record.beforeRevision &&
    baseline.assistedActions.length === at &&
    baseline.assistedActions.every((r, i) => r.id === current.assistedActions[i]?.id) &&
    baseline.log.length <= current.log.findIndex((l) => l.id === record.logId) &&
    baseline.log.every((l, i) => l.id === current.log[i]?.id)
}

const sameRoster = (a: GameState, b: GameState): boolean =>
  a.players.length === b.players.length && a.players.every((p) => b.players.some((other) => other.playerId === p.playerId))

function validEventBaseline(current: GameState, baseline: GameState, event: CancellationEvent): boolean {
  return baseline.id === current.id &&
    baseline.rev === event.priorRevision &&
    baseline.assistedActions.length <= current.assistedActions.length &&
    baseline.assistedActions.every((r, i) => r.id === current.assistedActions[i]?.id) &&
    baseline.log.length <= current.log.findIndex((l) => l.id === event.logId) &&
    baseline.log.every((l, i) => l.id === current.log[i]?.id)
}

function preserveWriting(baseline: GameState, current: GameState, rollbackTurn: number): GameState {
  const restore = (player: Playerhand): Playerhand => {
    const live = [...current.players, ...current.withdrawnPlayers].find((p) => p.playerId === player.playerId)
    if (live === undefined) return player
    const turns = live.playerTurns.map((turn) => {
      const previous = player.playerTurns.find((t) => t.turnNumber === turn.turnNumber)
      const restored = previous ?? createPlayerTurn(player.username, turn.turnNumber)
      // Earlier turns' gameplay survives the rollback, even if their writing was edited.
      if (turn.turnNumber < rollbackTurn) {
        return { ...restored, orders: turn.orders, history: turn.history, revealed: turn.revealed }
      }
      // Completed phases can receive later orders after the saved baseline.
      // Compare versions too: reverting to the original text still leaves later work.
      const revisionPhases = TURN_PHASES.filter((phase) => !restored.done[phase] ||
        restored.orders[phase] !== turn.orders[phase] ||
        restored.history[phase].length !== turn.history[phase].length ||
        restored.history[phase].some((version, index) =>
          version.markdown !== turn.history[phase][index]?.markdown ||
          version.at !== turn.history[phase][index]?.at))
      return { ...restored, orders: turn.orders, history: turn.history, revealed: turn.revealed,
        done: { ...restored.done, ...Object.fromEntries(revisionPhases.map((phase) => [phase, false])) },
        revisionPhases, needsRevision: revisionPhases.length > 0 }
    })
    return { ...player, gamenote: live.gamenote, playerTurns: [
      ...player.playerTurns.filter((t) => !turns.some((n) => n.turnNumber === t.turnNumber)), ...turns,
    ] }
  }
  const players = baseline.players.map(restore)
  const withdrawnPlayers = baseline.withdrawnPlayers.map(restore)
  return { ...baseline, players, withdrawnPlayers,
    publicTurns: { ...baseline.publicTurns, ...Object.fromEntries(
      [...players, ...withdrawnPlayers].flatMap((p) => p.playerTurns.map((t) => [publicTurnKey(t), publicTurn(t)])),
    ) } }
}

/**
 * Back to a saved state, keeping what the players wrote and the log. Entries after the saved state stay in
 * the log, marked as cancelled (the target) or superseded; the game's own counters never go backwards.
 */
function rewind(current: GameState, baseline: GameState, rollbackTurn: number, cancelled: AssistedActionRecord | null): GameState {
  return { ...preserveWriting(baseline, current, rollbackTurn),
    rev: current.rev, rng: current.rng, logSecret: current.logSecret,
    itemCounter: Math.max(current.itemCounter, baseline.itemCounter),
    cancellations: cancellationHistory(current),
    log: [...baseline.log, ...current.log.slice(baseline.log.length).map((entry) => entry.id.startsWith('cancellation:') ? entry : {
      ...entry, undo: null, superseded: true,
      publicLog: entry.publicLog === '' ? '' : `${entry.id === cancelled?.logId ? 'Cancelled' : 'Superseded'}: ${entry.publicLog}`,
    })],
    assistedActions: [...baseline.assistedActions, ...current.assistedActions.slice(baseline.assistedActions.length)
      .map((r): AssistedActionRecord => ({ ...r, status: r.id === cancelled?.id ? 'cancelled' : 'superseded' }))],
  }
}

/** The cards played are spent: out of every hand and into the discard pile, face down. */
function pay(state: GameState, costs: readonly Item[], revealed: ReadonlySet<string> = new Set()): GameState {
  const ids = new Set(costs.map((i) => i.id))
  return { ...state,
    players: state.players.map((p) => ({ ...p, items: p.items.filter((i) => !ids.has(i.id)).map((i) => revealed.has(i.id) ? { ...i, hidden: false } : i) })),
    discardedItems: [...state.discardedItems.filter((i) => !ids.has(i.id)), ...costs.map((i) => ({ ...i, hidden: true }))],
  }
}

/** A deck the rewind put back in an older order is shuffled twice, so nobody can read the order. */
function reshuffleChanged(state: GameState, before: GameState): GameState {
  let next = state
  const sheets = new Set([...before.items, ...state.items].map((i) => i.sheetName))
  for (const sheet of sheets) {
    const deck = (game: GameState) => game.items.filter((i) => i.sheetName === sheet).map((i) => i.id).join(',')
    if (deck(before) !== deck(next)) next = shuffleSheetTwice(next, sheet)
  }
  return next
}

export interface CancellationInput {
  readonly playerId: string
  readonly requestId: string
  readonly command: CancellationCommand
}

/** The saved revision a command rewinds to, for the server to load; undefined when the target is unknown. */
export function cancellationBaselineRevision(state: GameState, logId: string): number | undefined {
  const latest = cancellationHistory(state).events.at(-1)
  return latest?.logId === logId ? latest.priorRevision : state.assistedActions.find((r) => r.logId === logId)?.beforeRevision
}

/** The caller must supply the exact saved baseline (see `cancellationBaselineRevision`). */
export function applyCancellation(
  state: GameState, input: CancellationInput, baseline?: GameState,
): Result<GameState, EngineError> {
  const history = cancellationHistory(state)
  const fingerprint = JSON.stringify(input.command)
  const retry = history.requests.find((r) => r.id === input.requestId)
  if (retry !== undefined) return retry.playerId === input.playerId && retry.fingerprint === fingerprint
    ? ok(state) : reject('This request id was already used for a different cancellation.')
  const actor = state.players.find((p) => p.playerId === input.playerId)
  if (actor === undefined) return err({ kind: 'NO_ACCESS', playerId: input.playerId })
  if (input.requestId.trim() === '') return reject('A request id is required.')
  if (!state.active) return reject('A cancellation cannot be made in an inactive game.')
  const { logId, itemId } = input.command
  const latest = history.events.at(-1)
  const finish = (next: GameState, event: CancellationEvent): Result<GameState, EngineError> => ok({ ...next, cancellations: {
    ...history, sealedThrough: next.log.length, events: [...history.events, event],
    requests: [...history.requests, { id: input.requestId, playerId: input.playerId, fingerprint }],
  } })
  const unavailable = 'That card must be available both before the original action and now.'

  if (latest !== undefined && logId === latest.logId) {
    if (baseline === undefined || !validEventBaseline(state, baseline, latest)) return reject('The exact game before that cancellation is unavailable. Nothing was changed.')
    if (!sameRoster(baseline, state)) return reject('Player membership changed since this cancellation. A table-agreed manual correction is required.')
    const card = availableReactionCard(state, input.playerId, itemId)
    const historicalCard = availableReactionCard(baseline, input.playerId, itemId)
    if (card === undefined || historicalCard === undefined || itemName(card) !== itemName(historicalCard)) return reject(unavailable)
    if (!canCounter(card, latest, input.playerId, state)) return reject('The printed card text does not permit this target.')
    const protect = itemName(card) === KING_NAME
    const root = [...history.events].reverse().find((e) => e.kind === 'cancel')
    const rootTurn = state.assistedActions.find((r) => r.logId === root?.targetLogId)?.turnNumber ?? history.floorTurn
    const rewound = rewind(state, baseline, rootTurn, null)
    // No reshuffle: the saved state is the game as it was, and nobody saw its deck orders
    const next = pay(rewound, protect ? [] : [latest.card, card], protect ? new Set([card.id]) : undefined)
    const text = state.log.find((l) => l.id === latest.logId)?.publicLog ?? ''
    return finish(eventLog(next, input.requestId, protect
      ? `${actor.username} revealed ${itemName(card)}: the cancellation is undone and ${itemName(latest.card)} stays in hand.`
      : `${actor.username} cancelled the cancellation (${text}) with ${itemName(card)}.`, input.playerId),
    { id: input.requestId, kind: protect ? 'protect' : 'counter', playerId: input.playerId, card, logId: eventLogId(input.requestId), targetLogId: latest.logId, priorRevision: state.rev })
  }

  const record = state.assistedActions.find((r) => r.logId === logId)
  if (record === undefined || baseline === undefined || !validBaseline(state, baseline, record)) return reject('The exact game before that action is unavailable. Nothing was changed.')
  if (!sameRoster(baseline, state)) return reject('Player membership changed since this action. A table-agreed manual correction is required.')
  const actorBefore = baseline.players.find((p) => p.playerId === record.playerId)
  const refusal = cancellationRefusal(state, { ...record, kingAtAction: actorBefore === undefined ? null : availableKingId(baseline, actorBefore) })
  if (refusal !== undefined) return reject(refusal)
  if (record.turnNumber < history.floorTurn) return reject(`That action is before cancellation was adopted (turn ${history.floorTurn}).`)
  if (state.log.findIndex((l) => l.id === record.logId) < history.sealedThrough) return reject('That action is before an earlier cancellation.')
  const card = availableReactionCard(state, input.playerId, itemId)
  const historicalCard = availableReactionCard(baseline, input.playerId, itemId)
  if (card === undefined || historicalCard === undefined || itemName(card) !== itemName(historicalCard)) return reject(unavailable)
  if (!canCancel(card, record, input.playerId, baseline)) return reject('The printed card text does not permit this target.')

  const text = state.log.find((l) => l.id === record.logId)?.publicLog ?? ''
  const costs = [card, ...(cityActionOf(record) === undefined && record.effect.kind === 'playCard' ? [record.effect.item] : [])]
  const next = reshuffleChanged(pay(rewind(state, baseline, record.turnNumber, record), costs), state)
  return finish(eventLog(next, input.requestId, `${actor.username} cancelled "${text}" with ${itemName(card)}. Later gameplay is superseded; orders and notes are kept.`, input.playerId),
    { id: input.requestId, kind: 'cancel', playerId: input.playerId, card, logId: eventLogId(input.requestId), targetLogId: record.logId, priorRevision: state.rev })
}

/** Whitelisted projection: only the viewer's own cards, with the public log lines each can act on. */
export function cancellationView(state: GameState, viewerId: string) {
  const history = cancellationHistory(state)
  const latest = history.events.at(-1)
  const own = state.players.find((p) => p.playerId === viewerId)
  const textOf = (logId: string): string => state.log.find((l) => l.id === logId)?.publicLog ?? ''
  return {
    // Historical availability is checked against the saved revision on submission.
    responseCards: own === undefined ? [] : own.items.filter((i) =>
      availableReactionCard(state, viewerId, i.id) !== undefined &&
      (isCancellationCard(itemName(i)) || itemName(i) === KING_NAME))
      .map((i) => ({ itemId: i.id, name: itemName(i),
        targets: [
          ...(itemName(i) === KING_NAME ? [] : itemName(i) === TWAIN_NAME
            ? twainTargetsOf(state, own).map((t) => ({ logId: t.logId, text: t.text, blocked: t.blocked }))
            : state.assistedActions.filter((record) =>
              record.turnNumber >= history.floorTurn &&
              state.log.findIndex((l) => l.id === record.logId) >= history.sealedThrough &&
              cancellationRefusal(state, record) === undefined && canCancel(i, record, viewerId, state))
              .map((r) => ({ logId: r.logId, text: textOf(r.logId), blocked: null as string | null }))),
          ...(latest !== undefined && canCounter(i, latest, viewerId, state)
            ? [{ logId: latest.logId, text: textOf(latest.logId), blocked: null as string | null }] : []),
        ] })),
  }
}
export type CancellationView = ReturnType<typeof cancellationView>
