/** Durable disputes. Saved revisions are supplied by the server, never embedded in state or views. */
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

export interface CancellationReaction {
  readonly id: string
  readonly playerId: string
  /** null means the original action; otherwise an explicit culture reaction ID. */
  readonly targetId: string | null
  readonly card: Item
  readonly protection: boolean
}
export interface CancellationCase {
  readonly id: string
  readonly targetLogId: string
  readonly beforeRevision: number
  readonly continuationRevision: number
  readonly version: number
  readonly participants: readonly string[]
  readonly passes: readonly string[]
  readonly reactions: readonly CancellationReaction[]
  readonly outcome: 'pending' | 'cancelled' | 'prevented'
  readonly affected: readonly string[]
}
export interface CancellationHistory {
  readonly floorTurn: number
  /** Count of retained log entries, not a phase-completion marker. */
  readonly sealedThrough: number
  readonly acknowledgements: Readonly<Record<string, number>>
  readonly cases: readonly CancellationCase[]
  /** Private request fingerprints prevent a retry from changing its meaning. */
  readonly requests: readonly { readonly id: string; readonly playerId: string; readonly fingerprint: string }[]
}
export type CancellationCommand =
  | { readonly kind: 'open'; readonly logId: string; readonly itemId: string }
  | { readonly kind: 'respond'; readonly caseId: string; readonly version: number; readonly itemId: string; readonly targetId: string | null }
  | { readonly kind: 'pass'; readonly caseId: string; readonly version: number }
  | { readonly kind: 'confirm'; readonly through: number }

export const cancellationHistory = (state: GameState): CancellationHistory => state.cancellations ?? {
  floorTurn: turnStatus(state).currentTurn, sealedThrough: 0, acknowledgements: {}, cases: [], requests: [],
}
export const openCancellation = (state: GameState): CancellationCase | undefined =>
  state.cancellations?.cases.find((entry) => entry.outcome === 'pending')

const reject = (reason: string): Result<GameState, EngineError> =>
  err({ kind: 'ASSISTED_ACTION_REJECTED', action: 'playCard', status: 'unavailable', reason })

/** Reactions must not advance the gameplay random stream. IDs come from the durable case/request. */
function disputeLog(state: GameState, id: string, publicLog: string, playerId: string | null = null): GameState {
  return { ...state, log: [...state.log, {
    id: `cancellation:${id}`, publicLog, playerId,
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

/** A Bread and Circuses counter targets a card, not its owner. It cannot counter a cancellation. */
function canTarget(card: Item, record: AssistedActionRecord, playerId: string, target: CancellationReaction | undefined, state: GameState): boolean {
  const name = itemName(card)
  if (target !== undefined) {
    return !target.protection && target.card.kind.startsWith('culture') &&
      (name === 'Jousting Tourney' || name === 'Primetime TV' ||
        (name === TWAIN_NAME && target.playerId !== playerId))
  }
  if (name === KING_NAME) return cityActionOf(record) !== undefined && record.playerId === playerId
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

function preserveWriting(baseline: GameState, current: GameState): GameState {
  const restore = (player: Playerhand): Playerhand => {
    const live = [...current.players, ...current.withdrawnPlayers].find((p) => p.playerId === player.playerId)
    if (live === undefined) return player
    const turns = live.playerTurns.map((turn) => {
      const previous = player.playerTurns.find((t) => t.turnNumber === turn.turnNumber)
      const restored = previous ?? createPlayerTurn(player.username, turn.turnNumber)
      // Completed phases can receive later orders, even while the dispute is open.
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

function settle(current: GameState, baseline: GameState, dispute: CancellationCase, record: AssistedActionRecord): GameState {
  const effective = (reaction: CancellationReaction): boolean =>
    !dispute.reactions.some((r) => r.targetId === reaction.id && effective(r))
  const protectedByKing = dispute.reactions.some((r) => r.protection)
  const cancelled = !protectedByKing && dispute.reactions.some((r) => r.targetId === null && !r.protection && effective(r))
  let state = current
  if (cancelled) {
    state = { ...preserveWriting(baseline, current),
      rev: current.rev, rng: current.rng, logSecret: current.logSecret,
      itemCounter: Math.max(current.itemCounter, baseline.itemCounter),
      cancellations: cancellationHistory(current),
      log: [...baseline.log, ...current.log.slice(baseline.log.length).map((entry) => entry.id.startsWith('cancellation:') ? entry : {
        ...entry, undo: null, superseded: true,
        publicLog: entry.publicLog === '' ? '' : `${entry.id === record.logId ? 'Cancelled' : 'Superseded'}: ${entry.publicLog}`,
      })],
      assistedActions: [...baseline.assistedActions, ...current.assistedActions.slice(baseline.assistedActions.length)
        .map((r): AssistedActionRecord => ({ ...r, status: r.id === record.id ? 'cancelled' : 'superseded' }))],
    }
  }
  const costs = dispute.reactions.filter((r) => !r.protection && !(protectedByKing && itemName(r.card) === TWAIN_NAME)).map((r) => r.card)
  if (cancelled && cityActionOf(record) === undefined && record.effect.kind === 'playCard') costs.push(record.effect.item)
  const ids = new Set(costs.map((i) => i.id))
  const revealed = new Set(dispute.reactions.filter((r) => r.protection).map((r) => r.card.id))
  state = { ...state,
    players: state.players.map((p) => ({ ...p, items: p.items.filter((i) => !ids.has(i.id)).map((i) => revealed.has(i.id) ? { ...i, hidden: false } : i) })),
    discardedItems: [...state.discardedItems.filter((i) => !ids.has(i.id)), ...costs.map((i) => ({ ...i, hidden: true }))],
  }
  if (cancelled) {
    const sheets = new Set([...current.items, ...state.items].map((i) => i.sheetName))
    for (const sheet of sheets) {
      const deck = (game: GameState) => game.items.filter((i) => i.sheetName === sheet).map((i) => i.id).join(',')
      if (deck(current) !== deck(state)) state = shuffleSheetTwice(state, sheet)
    }
  }
  state = disputeLog(state, `${dispute.id}:settled`, cancelled
      ? 'Cancellation settled: target cancelled; later gameplay superseded. Orders and notes preserved; review orders before continuing.'
      : `Cancellation prevented: original continuation preserved.${protectedByKing ? ' Dr. Martin Luther King remains revealed; Mark Twain stays in hand.' : ''}`)
  const history = cancellationHistory(current)
  return { ...state, cancellations: { ...history,
    // Conservative boundary: no later rewind can refund this dispute's costs.
    sealedThrough: state.log.length,
    cases: history.cases.map((c) => c.id === dispute.id ? { ...dispute, outcome: cancelled ? 'cancelled' : 'prevented' } : c),
  } }
}

export interface CancellationInput {
  readonly playerId: string
  readonly requestId: string
  readonly command: CancellationCommand
  /** Public revision descriptions, supplied by the server (including changes with no log line). */
  readonly affected?: readonly string[]
}

/** The caller must supply the exact saved baseline on opening, responding and final passing. */
export function applyCancellation(
  state: GameState, input: CancellationInput, baseline?: GameState,
): Result<GameState, EngineError> {
  const history = cancellationHistory(state)
  const fingerprint = JSON.stringify(input.command)
  const retry = history.requests.find((r) => r.id === input.requestId)
  if (retry !== undefined) return retry.playerId === input.playerId && retry.fingerprint === fingerprint
    ? ok(state) : reject('This request id was already used for a different response.')
  if (!state.players.some((p) => p.playerId === input.playerId)) return err({ kind: 'NO_ACCESS', playerId: input.playerId })
  if (input.requestId.trim() === '') return reject('A request id is required.')
  const remember = (next: GameState): Result<GameState, EngineError> => ok({ ...next, cancellations: {
    ...cancellationHistory(next), requests: [...history.requests, { id: input.requestId, playerId: input.playerId, fingerprint }],
  } })
  const command = input.command
  const pending = openCancellation(state)
  if (command.kind === 'confirm') {
    if (pending !== undefined) return reject('History cannot be confirmed during a dispute.')
    if (!Number.isInteger(command.through) || command.through < history.sealedThrough || command.through > state.log.length) return reject('Invalid history cutoff.')
    const acknowledgements = { ...history.acknowledgements, [input.playerId]: Math.max(history.acknowledgements[input.playerId] ?? 0, command.through) }
    const sealedThrough = Math.max(history.sealedThrough, Math.min(...state.players.map((p) => acknowledgements[p.playerId] ?? 0)))
    return remember({ ...state, cancellations: { ...history, acknowledgements, sealedThrough } })
  }
  if (command.kind === 'open' && pending !== undefined) return reject('A cancellation is already pending.')
  if (command.kind !== 'open' && (pending === undefined || pending.id !== command.caseId || pending.version !== command.version)) return reject('The dispute changed. Reload before responding or passing.')
  const record = state.assistedActions.find((r) => r.logId === (command.kind === 'open' ? command.logId : pending?.targetLogId))
  if (record === undefined || baseline === undefined || !validBaseline(state, baseline, record)) return reject('The exact game before that action is unavailable. Nothing was changed.')
  if (command.kind === 'open') {
    if (baseline.players.length !== state.players.length || baseline.players.some((p) => !state.players.some((live) => live.playerId === p.playerId))) {
      return reject('Player membership changed since this action. A table-agreed manual correction is required.')
    }
    const actorBefore = baseline.players.find((p) => p.playerId === record.playerId)
    const refusal = cancellationRefusal(state, { ...record, kingAtAction: actorBefore === undefined ? null : availableKingId(baseline, actorBefore) })
    if (refusal !== undefined) return reject(refusal)
    if (record.turnNumber < history.floorTurn || state.log.findIndex((l) => l.id === record.logId) < history.sealedThrough) return reject('That action is before the shared confirmation frontier.')
  }
  if (command.kind === 'pass') {
    if (pending === undefined) return reject('No dispute is pending.')
    const passes = [...new Set([...pending.passes, input.playerId])]
    const updated = { ...pending, passes }
    const next = { ...state, cancellations: { ...history, cases: history.cases.map((c) => c.id === pending.id ? updated : c) } }
    return remember(pending.participants.every((id) => passes.includes(id)) ? settle(next, baseline, updated, record) : next)
  }
  const card = availableReactionCard(state, input.playerId, command.itemId)
  const historicalCard = availableReactionCard(baseline, input.playerId, command.itemId)
  if (card === undefined || historicalCard === undefined || itemName(card) !== itemName(historicalCard)) return reject('That card must be available both before the original action and now.')
  if (pending?.reactions.some((r) => r.card.id === card.id)) return reject('That card is already committed to this dispute.')
  const targetId = command.kind === 'open' ? null : command.targetId
  const target = pending?.reactions.find((r) => r.id === targetId)
  if (targetId !== null && target === undefined) return reject('Choose an existing culture cancellation event.')
  if (!canTarget(card, record, input.playerId, target, baseline) || (command.kind === 'open' && itemName(card) === KING_NAME)) return reject('The printed card text does not permit this target.')
  const reaction: CancellationReaction = { id: input.requestId, playerId: input.playerId, targetId, card, protection: itemName(card) === KING_NAME }
  const dispute: CancellationCase = pending === undefined ? {
    id: input.requestId, targetLogId: record.logId, beforeRevision: baseline.rev, continuationRevision: state.rev,
    version: 1, participants: state.players.map((p) => p.playerId), passes: [], reactions: [reaction], outcome: 'pending',
    affected: input.affected ?? state.log.slice(state.log.findIndex((l) => l.id === record.logId) + 1).map((l) => l.publicLog).filter(Boolean),
  } : { ...pending, version: pending.version + 1, passes: [], reactions: [...pending.reactions, reaction] }
  let next: GameState = { ...state, cancellations: { ...history, cases: pending === undefined
    ? [...history.cases, dispute] : history.cases.map((c) => c.id === pending.id ? dispute : c) } }
  if (reaction.protection) next = { ...next, players: next.players.map((p) => p.playerId === input.playerId
    ? { ...p, items: p.items.map((i) => i.id === card.id ? { ...i, hidden: false } : i) } : p) }
  next = disputeLog(next, input.requestId, `${itemName(card)} ${reaction.protection ? 'revealed as protection' : 'committed to cancellation'}. All players must respond or pass again.`, input.playerId)
  return remember(next)
}

/** Whitelisted projection: no card IDs, saved revisions, effects or request fingerprints. */
export function cancellationView(state: GameState, viewerId: string) {
  const history = cancellationHistory(state)
  const pending = openCancellation(state)
  const own = state.players.find((p) => p.playerId === viewerId)
  return {
    floorTurn: history.floorTurn, sealedThrough: history.sealedThrough, cutoff: state.log.length,
    acknowledgements: state.players.map((p) => ({ playerId: p.playerId, username: p.username, through: history.acknowledgements[p.playerId] ?? 0 })),
    cases: history.cases.map((c) => ({
      id: c.id, targetLogId: c.targetLogId, version: c.version, outcome: c.outcome,
      target: state.log.find((l) => l.id === c.targetLogId)?.publicLog ?? '',
      affected: c.affected,
      participants: c.participants, passes: c.passes,
      reactions: c.reactions.map((r) => ({ id: r.id, playerId: r.playerId, targetId: r.targetId, name: itemName(r.card), protection: r.protection })),
    })),
    // Historical availability is checked against the saved revision on submission.
    responseCards: own === undefined ? [] : own.items.filter((i) =>
      availableReactionCard(state, viewerId, i.id) !== undefined &&
      (isCancellationCard(itemName(i)) || itemName(i) === KING_NAME) &&
      !pending?.reactions.some((r) => r.card.id === i.id))
      .map((i) => ({ itemId: i.id, name: itemName(i),
        targets: pending !== undefined ? [] : itemName(i) === TWAIN_NAME
          ? twainTargetsOf(state, own).map((t) => ({ logId: t.logId, text: t.text, blocked: t.blocked }))
          : state.assistedActions.filter((record) =>
          record.turnNumber >= history.floorTurn &&
          state.log.findIndex((l) => l.id === record.logId) >= history.sealedThrough &&
          cancellationRefusal(state, record) === undefined && itemName(i) !== KING_NAME &&
          canTarget(i, record, viewerId, undefined, state))
          .map((r) => ({ logId: r.logId, text: state.log.find((l) => l.id === r.logId)?.publicLog ?? '', blocked: null })),
        responses: pending === undefined ? [] : (() => {
          const record = state.assistedActions.find((r) => r.logId === pending.targetLogId)
          if (record === undefined) return []
          return [
            ...(canTarget(i, record, viewerId, undefined, state) ? [{ id: null, label: 'Original action' }] : []),
            ...pending.reactions.filter((r) => canTarget(i, record, viewerId, r, state))
              .map((r) => ({ id: r.id, label: `${itemName(r.card)} (${r.id})` })),
          ]
        })(),
      })),
  }
}
export type CancellationView = ReturnType<typeof cancellationView>
