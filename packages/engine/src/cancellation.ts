/**
 * Cancellations (Mark Twain, Jousting Tourney, Primetime TV, Bread and Circuses) and their counters
 * (a culture reaction, or Dr. Martin Luther King's protection). Each one takes effect at once, as an event
 * on the log; nobody is asked to respond. Saved revisions are supplied by the server, never embedded in
 * state or views.
 */
import { cityActionOf, playerOf, resourceAbilityOf, techBlock, useTurnAction } from './assisted-core.js'
import { currentTurnOf } from './assisted-tech-abilities.js'
import { itemPaymentIds, spendResource } from './assisted-resources.js'
import type { ResourcePaymentChoice } from './assisted-resources.js'
import { shuffleSheetTwice } from './assisted-culture.js'
import { blockadedGreatPersonTypes, pieceColorOf } from './blockade.js'
import type { EngineError } from './errors.js'
import { itemName } from './item.js'
import type { Item } from './item.js'
import { err, ok } from './result.js'
import type { Result } from './result.js'
import type { AssistedActionRecord, GameState, Playerhand, SpentResource } from './state.js'
import { createPlayerTurn, publicTurn, publicTurnKey, turnStatus, TURN_PHASES } from './turn.js'
import { KING_NAME, TWAIN_NAME, availableKingId, cancellationRefusal, holdsFaceupKing, twainTargetsOf } from './twain.js'

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
  /** Set when a tech made the event (Writing, Civil Service, Mass Media): `card` is then the Spy that was spent. */
  readonly tech?: string
  /** The Spy payment of a tech event, spent again when the event is countered. */
  readonly payment?: ResourcePaymentChoice
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
  /** A card of the player's hand, or... */
  readonly itemId?: string
  /** ...a tech that cancels with a Spy, paid with `payment`. */
  readonly tech?: string
  readonly payment?: ResourcePaymentChoice
}

/** The techs that cancel with a Spy: Writing a city action, Civil Service a culture event, Mass Media a resource ability. */
export const TECH_CANCELS = ['Writing', 'Civil Service', 'Mass Media'] as const
export const isTechCancel = (name: string): boolean => (TECH_CANCELS as readonly string[]).includes(name)
const SPY = 'Spy'
const techUsageKey = (tech: string): string => `card:${tech}`

export const cancellationHistory = (state: GameState): CancellationHistory => state.cancellations ?? {
  floorTurn: turnStatus(state).currentTurn, sealedThrough: 0, events: [], requests: [],
}

const rejection = (reason: string): EngineError =>
  ({ kind: 'ASSISTED_ACTION_REJECTED', action: 'playCard', status: 'unavailable', reason })
const reject = (reason: string): Result<GameState, EngineError> => err(rejection(reason))

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

/**
 * What a reaction (a card or a tech, by name) may cancel among the recorded actions. Twain: another player's city
 * action, culture event or resource ability. Writing: another player's city action. A culture event is stopped by
 * Jousting Tourney, Primetime TV and Civil Service, and by Bread and Circuses when it is aimed at the canceller. A
 * resource ability (an ability of a tech that spent a resource) is stopped by Primetime TV and Mass Media.
 */
function canCancel(name: string, record: AssistedActionRecord, playerId: string, state: GameState): boolean {
  if (name === KING_NAME) return false
  const ability = resourceAbilityOf(record) !== undefined
  if (name === 'Mass Media') return ability
  if (name === TWAIN_NAME) return record.playerId !== playerId
  if (name === 'Writing') return record.playerId !== playerId && cityActionOf(record) !== undefined
  if (name === 'Primetime TV' && ability) return true
  if (record.effect.kind !== 'playCard' || !record.effect.item.kind.startsWith('culture')) return false
  if (name === 'Bread and Circuses') {
    if (record.effect.targets.includes(playerId)) return true
    const color = state.players.find((p) => p.playerId === playerId)?.color?.toLowerCase()
    if (color === undefined) return false
    // The owners as they stood when the card moved them; a record from before that was kept falls back to the board
    const owners = record.effect.cardMove?.owners
    if (owners !== undefined) return owners.includes(color)
    return record.effect.cardMove?.moves.some((move) => {
      const piece = state.board.pieces.find((p) => p.id === move.pieceId)
      return piece !== undefined && pieceColorOf(piece) === color
    }) === true
  }
  return name === 'Jousting Tourney' || name === 'Primetime TV' || name === 'Civil Service'
}

/**
 * Whether a reaction can undo the latest event. An event of a culture card is a culture event: Jousting Tourney,
 * Primetime TV, Civil Service and another player's Twain stop it. An event of a tech is a resource ability: Primetime
 * TV, Mass Media and another player's Twain stop it. King only protects his holder's city action from a cancellation.
 */
function canCounter(name: string, event: CancellationEvent, playerId: string, state: GameState): boolean {
  if (name === KING_NAME) {
    const record = state.assistedActions.find((r) => r.logId === event.targetLogId)
    return event.kind === 'cancel' && record !== undefined && cityActionOf(record) !== undefined && record.playerId === playerId
  }
  if (event.kind === 'protect') return false
  const twain = name === TWAIN_NAME && event.playerId !== playerId
  if (event.tech !== undefined) return name === 'Primetime TV' || name === 'Mass Media' || twain
  return event.card.kind.startsWith('culture') &&
    (name === 'Jousting Tourney' || name === 'Primetime TV' || name === 'Civil Service' || twain)
}

/** What a player reacts with: a card from the hand, or a tech paid with the Spy they chose. */
interface Reaction {
  readonly name: string
  readonly card: Item
  readonly tech?: string
  readonly payment?: ResourcePaymentChoice
}
const reactionOf = (event: CancellationEvent): Reaction => ({
  name: event.tech ?? itemName(event.card), card: event.card,
  ...(event.tech === undefined ? {} : { tech: event.tech }), ...(event.payment === undefined ? {} : { payment: event.payment }),
})

/** The Spy a tech event spends, by the player's own choice: a token or culture card that is an item (not a bare board piece). */
function techPayment(state: GameState, playerId: string, payment: ResourcePaymentChoice | undefined): Result<Item, string> {
  if (payment === undefined || payment.resource !== SPY) return err('Choose the Spy to pay with.')
  if (payment.kind === 'piece') return err('A Spy that is only a piece on the board cannot be used here. Use a Spy token in your hand or a culture card that can be played as one.')
  const held = playerOf(state, playerId)?.items.find((item) => item.id === payment.id)
  if (held === undefined || !spendResource(state, playerId, SPY, undefined, false, payment).ok) return err('That Spy is not available.')
  return ok(held)
}

/** The tech's own refusal: revealed, not used this turn, and a Spy to pay. `state` is a game the actor must hold it in. */
function techRefusal(state: GameState, playerId: string, tech: string): string | undefined {
  const player = playerOf(state, playerId)
  if (player === undefined) return 'That player has left the game.'
  const block = techBlock(player, tech)
  if (block !== undefined) return block.reason
  if (currentTurnOf(state, player).usedActions.includes(techUsageKey(tech))) return `${tech} has already been used this turn.`
  return undefined
}

/**
 * The reaction a command names, checked in the game now and in the saved game before the target: the same card
 * (or the same revealed tech with the same Spy) must be there in both, because the cost is paid after the rewind.
 */
function reactionFrom(state: GameState, baseline: GameState, playerId: string, command: CancellationCommand): Result<Reaction, string> {
  const unavailable = 'That card must be available both before the original action and now.'
  if (command.tech !== undefined) {
    if (command.itemId !== undefined || !isTechCancel(command.tech)) return err('Name a card or one of Writing, Civil Service and Mass Media.')
    const refusal = techRefusal(state, playerId, command.tech) ?? techRefusal(baseline, playerId, command.tech)
    if (refusal !== undefined) return err(refusal)
    const now = techPayment(state, playerId, command.payment)
    const before = techPayment(baseline, playerId, command.payment)
    if (!now.ok || !before.ok) return err('That Spy must be in your hand, or a culture card that can be played as one, both before the original action and now.')
    return ok({ name: command.tech, card: before.value, tech: command.tech, ...(command.payment === undefined ? {} : { payment: command.payment }) })
  }
  if (command.itemId === undefined || command.payment !== undefined) return err('Name a card or a tech.')
  const card = availableReactionCard(state, playerId, command.itemId)
  const historical = availableReactionCard(baseline, playerId, command.itemId)
  if (card === undefined || historical === undefined || itemName(card) !== itemName(historical)) return err(unavailable)
  return ok({ name: itemName(card), card })
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
      publicLog: entry.publicLog === '' ? '' : `${entry.id === cancelled?.logId ? 'Cancelled' : 'Undone'}: ${entry.publicLog}`,
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

/**
 * Pays a reaction on the rewound game: a card goes to the discard pile; a tech spends its Spy through the shared
 * resource layer (a token off the board too) and is marked used for the turn.
 */
function spendReaction(state: GameState, ownerId: string, reaction: Reaction): Result<{ readonly state: GameState; readonly said: string }, EngineError> {
  if (reaction.tech === undefined) return ok({ state: pay(state, [reaction.card]), said: '' })
  const spent = spendResource(state, ownerId, SPY, undefined, false, reaction.payment)
  const owner = playerOf(state, ownerId)
  if (!spent.ok || owner === undefined) return err(rejection(`${reaction.tech} could not be paid with that Spy after the rewind. Nothing was changed.`))
  const paying = playerOf(spent.value.state, ownerId) ?? owner
  const used = useTurnAction(spent.value.state, paying, currentTurnOf(spent.value.state, paying), techUsageKey(reaction.tech), paying.stats)
  return ok({ state: used, said: spent.value.said })
}

/**
 * A cancelled resource ability keeps what it cost: the rewind gave its resources back, so they are spent again (the
 * exact tokens or cards it paid), and the tech counts as used this turn, as a cancelled culture card stays discarded and a
 * cancelled city action stays the city's action of the turn. Only the effect is undone.
 */
function keepAbilityCost(state: GameState, record: AssistedActionRecord, spent: readonly SpentResource[]): Result<GameState, EngineError> {
  let next = state
  const firstEntry = state.board.history.length
  for (const resource of spent) {
    // A Uranium spend made with Marie Curie's substitute is chosen as Uranium, as it was made
    const name = resource.curieSubstitute === undefined ? resource.resource : 'Uranium'
    const choice: ResourcePaymentChoice = { resource: name, kind: resource.kind, id: resource.kind === 'piece' ? resource.piece.id : resource.itemId }
    const paid = spendResource(next, record.playerId, name, undefined, false, choice)
    if (!paid.ok) return err(rejection('The resources that ability spent cannot be kept spent after the rewind. Nothing was changed.'))
    next = paid.value.state
  }
  // A piece taken off the map is a board change of the cancelled player: only the cancellation may take it back
  const keptIds = next.board.history.slice(firstEntry).map((entry) => entry.id)
  if (keptIds.length > 0) {
    next = { ...next, assistedActions: next.assistedActions.map((r) => r.id === record.id ? { ...r, keptHistoryIds: keptIds } : r) }
  }
  // The use consumed the substitute Marie Curie had armed, which the rewind armed again
  if (spent.some((resource) => resource.curieSubstitute !== undefined)) {
    next = { ...next, players: next.players.map((p) => p.playerId === record.playerId ? { ...p, curieSubstitute: null } : p) }
  }
  const owner = playerOf(next, record.playerId)
  if (owner === undefined || record.usageKey === null) return ok(next)
  const turn = owner.playerTurns.find((t) => t.turnNumber === record.turnNumber) ?? createPlayerTurn(owner.username, record.turnNumber)
  return ok(useTurnAction(next, owner, turn, record.usageKey, owner.stats))
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
  const { logId } = input.command
  const latest = history.events.at(-1)
  const finish = (next: GameState, event: CancellationEvent): Result<GameState, EngineError> => ok({ ...next, cancellations: {
    ...history, sealedThrough: next.log.length, events: [...history.events, event],
    requests: [...history.requests, { id: input.requestId, playerId: input.playerId, fingerprint }],
  } })
  const eventOf = (reaction: Reaction, kind: CancellationEvent['kind'], targetLogId: string): CancellationEvent => ({
    id: input.requestId, kind, playerId: input.playerId, card: reaction.card,
    ...(reaction.tech === undefined ? {} : { tech: reaction.tech, ...(reaction.payment === undefined ? {} : { payment: reaction.payment }) }),
    logId: eventLogId(input.requestId), targetLogId, priorRevision: state.rev,
  })
  const withSpy = (said: string): string => said === '' ? '' : ` (${said})`

  if (latest !== undefined && logId === latest.logId) {
    if (baseline === undefined || !validEventBaseline(state, baseline, latest)) return reject('The exact game before that cancellation is unavailable. Nothing was changed.')
    if (!sameRoster(baseline, state)) return reject('Player membership changed since this cancellation. A table-agreed manual correction is required.')
    const reaction = reactionFrom(state, baseline, input.playerId, input.command)
    if (!reaction.ok) return reject(reaction.error)
    if (!canCounter(reaction.value.name, latest, input.playerId, state)) return reject('The printed card text does not permit this target.')
    const protect = reaction.value.name === KING_NAME
    // Back to the game as it was: its own turn is the boundary for what was written, not the turn of the action
    // the earlier cancellation had rewound to, or orders of turns the game has long passed would be reopened
    const rewound = rewind(state, baseline, turnStatus(baseline).currentTurn, null)
    // No reshuffle: the saved state is the game as it was, and nobody saw its deck orders
    let next = pay(rewound, [], protect ? new Set([reaction.value.card.id]) : undefined)
    let said = ''
    if (!protect) {
      const first = spendReaction(next, latest.playerId, reactionOf(latest))
      if (!first.ok) return err(first.error)
      const second = spendReaction(first.value.state, input.playerId, reaction.value)
      if (!second.ok) return err(second.error)
      next = second.value.state
      said = second.value.said
    }
    const text = state.log.find((l) => l.id === latest.logId)?.publicLog ?? ''
    const latestName = reactionOf(latest).name
    return finish(eventLog(next, input.requestId, protect
      ? `${actor.username} revealed ${reaction.value.name}: the cancellation is undone and ${latest.tech === undefined ? latestName : 'the Spy'} stays in hand.`
      : `${actor.username} cancelled the cancellation (${text}) with ${reaction.value.name}${withSpy(said)}.`, input.playerId),
    eventOf(reaction.value, protect ? 'protect' : 'counter', latest.logId))
  }

  const record = state.assistedActions.find((r) => r.logId === logId)
  if (record === undefined || baseline === undefined || !validBaseline(state, baseline, record)) return reject('The exact game before that action is unavailable. Nothing was changed.')
  if (!sameRoster(baseline, state)) return reject('Player membership changed since this action. A table-agreed manual correction is required.')
  const actorBefore = baseline.players.find((p) => p.playerId === record.playerId)
  const refusal = cancellationRefusal(state, { ...record,
    kingAtAction: actorBefore === undefined ? null : availableKingId(baseline, actorBefore),
    kingFaceupAtAction: record.kingFaceupAtAction ?? (actorBefore !== undefined && holdsFaceupKing(baseline, actorBefore)) })
  if (refusal !== undefined) return reject(refusal)
  if (record.turnNumber < history.floorTurn) return reject(`That action is before cancellation was adopted (turn ${history.floorTurn}).`)
  if (state.log.findIndex((l) => l.id === record.logId) < history.sealedThrough) return reject('That action is before an earlier cancellation.')
  const reaction = reactionFrom(state, baseline, input.playerId, input.command)
  if (!reaction.ok) return reject(reaction.error)
  if (!canCancel(reaction.value.name, record, input.playerId, baseline)) return reject('The printed card text does not permit this target.')

  const text = state.log.find((l) => l.id === record.logId)?.publicLog ?? ''
  const rewound = rewind(state, baseline, record.turnNumber, record)
  // The culture event that was cancelled is spent too; a cancelled city action is not a card
  const spentEvent = cityActionOf(record) === undefined && record.effect.kind === 'playCard' ? [record.effect.item] : []
  const ability = resourceAbilityOf(record)
  const kept = ability === undefined ? ok(pay(rewound, spentEvent)) : keepAbilityCost(pay(rewound, spentEvent), record, ability)
  if (!kept.ok) return err(kept.error)
  const paid = spendReaction(kept.value, input.playerId, reaction.value)
  if (!paid.ok) return err(paid.error)
  const next = reshuffleChanged(paid.value.state, state)
  return finish(eventLog(next, input.requestId, `${actor.username} cancelled "${text}" with ${reaction.value.name}${withSpy(paid.value.said)}. Everything played after it is undone; orders and notes are kept.${ability === undefined ? '' : ' What the ability spent stays spent, and it counts as used this turn.'}`, input.playerId),
    eventOf(reaction.value, 'cancel', record.logId))
}

/** Whitelisted projection: only the viewer's own cards, with the public log lines each can act on. */
export function cancellationView(state: GameState, viewerId: string) {
  const history = cancellationHistory(state)
  const latest = history.events.at(-1)
  const own = state.players.find((p) => p.playerId === viewerId)
  // One pass over the log: where each line lies and what it says, for every target of every card
  const lines = new Map(state.log.map((entry, index) => [entry.id, { index, text: entry.publicLog }]))
  const textOf = (logId: string): string => lines.get(logId)?.text ?? ''
  const recordTargets = (name: string) => state.assistedActions.filter((record) =>
    record.turnNumber >= history.floorTurn &&
    (lines.get(record.logId)?.index ?? -1) >= history.sealedThrough &&
    cancellationRefusal(state, record) === undefined && canCancel(name, record, viewerId, state))
    .map((r) => ({ logId: r.logId, text: textOf(r.logId), blocked: null as string | null }))
  const counterTarget = (name: string) => latest !== undefined && canCounter(name, latest, viewerId, state)
    ? [{ logId: latest.logId, text: textOf(latest.logId), blocked: null as string | null }] : []
  return {
    // Historical availability is checked against the saved revision on submission.
    responseCards: own === undefined ? [] : own.items.filter((i) =>
      availableReactionCard(state, viewerId, i.id) !== undefined &&
      (isCancellationCard(itemName(i)) || itemName(i) === KING_NAME))
      .map((i) => ({ itemId: i.id, name: itemName(i),
        targets: [
          ...(itemName(i) === KING_NAME ? [] : itemName(i) === TWAIN_NAME
            ? twainTargetsOf(state, own).map((t) => ({ logId: t.logId, text: t.text, blocked: t.blocked }))
            : recordTargets(itemName(i))),
          ...counterTarget(itemName(i)),
        ] })),
    // The techs that cancel with a Spy: listed when revealed, unused this turn and a Spy in the hand can pay. Which Spy is the
    // player's choice; `spies` are the ids of those that still can, so a pick that has gone stale is seen.
    techCancels: own === undefined ? [] : TECH_CANCELS.filter((tech) =>
      techRefusal(state, viewerId, tech) === undefined && itemPaymentIds(state, viewerId, SPY).length > 0)
      .map((tech) => ({ tech, spies: itemPaymentIds(state, viewerId, SPY), targets: [...recordTargets(tech), ...counterTarget(tech)] })),
  }
}
export type CancellationView = ReturnType<typeof cancellationView>
