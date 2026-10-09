/**
 * Typed client for @civ/server.
 *
 * The game-state types come straight from the engine, so the client and the
 * server cannot drift apart. Only the DTOs the server defines itself are
 * repeated here.
 */

import type {
  ActiveTurnStatus,
  AssistedActionKind,
  Board,
  BoardArea,
  BoardAsset,
  BoardHistoryEntry,
  BoardPiece,
  CoinSourceKey,
  HighscoreResult,
  Government,
  Item,
  PlayerStatKey,
  PlayerStats,
  PlayerView,
  RevealedEntry,
  SheetName,
  SocialPolicyItem,
  TechItem,
  TurnPhase,
  WaitingFor,
  WinnerEntry,
} from '@civ/engine'

import { beginActivity } from './activity.js'

export type {
  ActiveTurnStatus,
  AssistedActionKind,
  Board,
  BoardArea,
  BoardAsset,
  BoardHistoryEntry,
  BoardPiece,
  CoinSourceKey,
  HighscoreResult,
  Government,
  Item,
  PlayerStatKey,
  PlayerStats,
  PlayerView,
  RevealedEntry,
  SheetName,
  SocialPolicyItem,
  TechItem,
  TurnPhase,
  WaitingFor,
  WinnerEntry,
}

/** One server-backed page of the Revealed and Discarded Items feed (issue #51). */
export interface RevealedPage {
  readonly items: readonly RevealedEntry[]
  readonly total: number
  readonly page: number
  readonly size: number
}

/** The three loot choices exposed by the old client. */
export type LootCategory = 'CULTURE_CARD' | 'HUTS' | 'VILLAGES'

export interface PlayerDto {
  readonly id: string
  readonly username: string
  readonly email: string | null
  readonly role: 'user' | 'admin'
  readonly disabled: boolean
}

export interface AdminUserDto extends PlayerDto {
  readonly createdAt: string
  /** Set by the unsubscribe link. The server has always sent it; the queue's recipient estimate reads it. */
  readonly disableEmail?: boolean
}

export interface AdminUserUpdate {
  readonly username?: string
  readonly email?: string | null
  readonly role?: 'user' | 'admin'
  readonly disabled?: boolean
}

/** What one admin email broadcast did (issue #92). */
export interface BroadcastResultDto {
  readonly sent: number
  /** Addresses accepted in this run; paste them into the next run's skip list. */
  readonly sentTo: readonly string[]
  readonly skipped: {
    readonly noAddress: number
    readonly unsubscribed: number
    readonly excluded: number
  }
  readonly failed: readonly { readonly email: string; readonly reason: string }[]
  /** Eligible but not attempted: the limit, the quota, the request budget or a stop. */
  readonly deferred: number
  readonly stopReason: string | null
}

/** A queued admin broadcast, sent a batch a day by the scheduled job. */
export interface BroadcastQueueDto {
  readonly id: string
  readonly subject: string
  readonly status: 'active' | 'done' | 'cancelled'
  readonly perRun: number
  readonly includeUnsubscribed: boolean
  readonly createdAt: string
  readonly lastRunAt: string | null
  readonly counts: {
    readonly pending: number
    readonly sending: number
    readonly sent: number
    readonly failed: number
  }
  readonly failed: readonly { readonly email: string; readonly reason: string }[]
  /** Addresses a run claimed and never reported on; they may have been mailed, and are not resent. */
  readonly stuck: readonly string[]
}

export interface QueueBroadcastResponse {
  readonly queue: BroadcastQueueDto
  readonly skipped: {
    readonly noAddress: number
    readonly unsubscribed: number
    readonly excluded: number
  }
  readonly rejected: readonly { readonly email: string; readonly reason: string }[]
}

/** One finished game the admin cleanup would shrink: counts and sizes, never any state. */
export interface CleanupCandidateDto {
  readonly id: string
  readonly name: string
  readonly revisions: number
  readonly removableRevisions: number
  readonly removableBytes: number
}

export interface CleanupPreviewDto {
  readonly games: readonly CleanupCandidateDto[]
  readonly totalRevisions: number
  readonly totalBytes: number
}

export interface CleanupResultDto {
  readonly games: readonly {
    readonly id: string
    readonly name: string
    readonly removedRevisions: number
    readonly removedBytes: number
  }[]
  readonly totalRevisions: number
  readonly totalBytes: number
  /** Finished games a "clean up all" left for the next press; 0 for a single game. */
  readonly remaining: number
}

/** One game whose old saved states the compaction would turn into deltas: counts and sizes, never any state. */
export interface CompactCandidateDto {
  readonly id: string
  readonly name: string
  /** A game that is still running is compacted too; its newest state is never touched. */
  readonly active: boolean
  readonly revisions: number
  /** Saved states still stored in full, from before delta storage. */
  readonly fullRevisions: number
  /** An estimate, in bytes. */
  readonly freeableBytes: number
}

export interface CompactPreviewDto {
  readonly games: readonly CompactCandidateDto[]
  readonly totalRevisions: number
  readonly totalBytes: number
}

export type CompactGameResultDto =
  | {
      readonly id: string
      readonly name: string
      readonly status: 'compacted'
      readonly converted: number
      readonly keyframes: number
      readonly freedBytes: number
      readonly remaining: number
    }
  | {
      readonly id: string
      readonly name: string
      readonly status: 'mismatch'
      /** The saved state whose rebuilt copy differed from the original; the game was left as it was. */
      readonly revision: number
    }

export interface CompactResultDto {
  readonly games: readonly CompactGameResultDto[]
  readonly totalConverted: number
  readonly totalBytes: number
  /** Games with something left after this request. */
  readonly remaining: number
  readonly remainingRevisions: number
}

export interface BroadcastRunDto {
  readonly ran: boolean
  readonly sent: number
  readonly failed: number
  readonly released: number
  /** Claimed, and the provider gave no answer: they may have been delivered, and stay stuck. */
  readonly indeterminate: number
  readonly stopReason: string | null
  readonly finished: boolean
}

export interface GameSummary {
  readonly id: string
  readonly name: string
  readonly gameType: string
  readonly createdAt: string | null
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly players: readonly { readonly username: string; readonly color: string | null }[]
  readonly nameOfUsersTurn: string
  readonly youAreIn: boolean
  readonly availableColors: readonly string[]
  readonly placements: readonly { readonly username: string; readonly rank: number }[]
}

export interface PublicGameSummary {
  readonly id: string
  readonly name: string
  readonly gameType: string
  readonly createdAt: string | null
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly players: readonly { readonly username: string; readonly color: string | null }[]
  readonly nameOfUsersTurn: string
  readonly youAreIn: boolean
  readonly availableColors: readonly string[]
  readonly placements: readonly { readonly username: string; readonly rank: number }[]
}

export interface LogEntryDto {
  readonly id: string
  readonly username: string
  readonly logType: string | null
  readonly message: string
  /** Present when the server has persisted a timestamp for this log entry. */
  readonly createdAt?: string | null
  readonly hasUndo: boolean
  readonly canUndo?: boolean
  /** Set on a line an assisted action wrote; the undo vote can target it (#260). */
  readonly assistedActionId?: string
}

export interface ChatMessageDto {
  readonly id: string
  readonly username: string
  readonly message: string
  readonly createdAt: string
}

/** What a timeline row is (issue #215). */
export type ChatKind = 'chat' | 'order' | 'system'

/**
 * A row of the chat and orders timeline. Plain `ChatMessageDto` is what the lobby
 * answers; the timeline adds the kind and the turn tag.
 */
export interface TimelineMessageDto extends ChatMessageDto {
  readonly kind: ChatKind
  /** The turn an order or system row belongs to; `null` for plain chat. */
  readonly turnNumber: number | null
  readonly phase: TurnPhase | null
}

/** `GET /chat`: rows oldest first, and whether older ones exist. */
export interface ChatPageDto {
  readonly messages: readonly TimelineMessageDto[]
  readonly hasMore: boolean
}

export interface PendingUndoDto {
  readonly id: string
  readonly username: string
  readonly message: string
  readonly votesRequired: number
  readonly votesCast: number
}

export interface RevealedTechsDto {
  readonly civilization: string
  readonly color: string | null
  readonly techs: readonly { readonly name: string; readonly level: number }[]
}

export interface GameRevisionSummary {
  readonly gameId: string
  readonly revision: number
  readonly createdAt: string
  readonly actor: { readonly playerId: string; readonly username: string }
  readonly publicDescription: string
  readonly logIds: readonly string[]
}

export interface GameRevisionView extends GameRevisionSummary {
  readonly view: PlayerView
  readonly availableTechs: readonly TechItem[]
  readonly revealedTechs: readonly RevealedTechsDto[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  readonly revealed: readonly RevealedEntry[]
  readonly publicLog: readonly LogEntryDto[]
  readonly privateLog: readonly LogEntryDto[]
}

/** An error from the server, with the engine's error code intact. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const TOKEN_KEY = 'civ.token'

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY)
    else localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // A private window or blocked storage: the sign-in then lasts the session
  }
}

/** Distinguishes "the body was not JSON" from a body that parsed to `undefined`. */
const NOT_JSON: unique symbol = Symbol('not-json')

function parseBody(text: string): unknown {
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return NOT_JSON
  }
}

/**
 * A failed Worker is answered by Cloudflare's edge, not by our code: a bare
 * `503` with a `text/plain` body like `error code: 1102`, never the server's
 * `{ error, message }`. Report that instead of letting `JSON.parse` throw a
 * `SyntaxError` the banner then shows verbatim.
 */
function failureMessage(
  method: string,
  path: string,
  response: Response,
  text: string,
): string {
  const status =
    response.statusText === '' ? `${response.status}` : `${response.status} ${response.statusText}`
  const detail = text.trim().replace(/\s+/g, ' ').slice(0, 200)
  return detail === ''
    ? `${method} ${path} failed with ${status}`
    : `${method} ${path} failed with ${status}: ${detail}`
}

/**
 * Gateway statuses a later attempt can plausibly fix. `503` is also what
 * Cloudflare answers when a Worker exceeds its resource limit (`error code:
 * 1102`), which is transient by nature.
 */
const RETRYABLE_STATUSES = new Set([502, 503, 504])

/** Back-off before each retry of a safe request, so two retries at most. */
const RETRY_DELAYS_MS: readonly number[] = [250, 1000]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Every write is reported to the global spinner (issue #225); reads are not,
 * because most of them are background polls. A view that wants a read to count
 * reports it itself with `useActivity`.
 */
async function request<T>(
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  if (method === 'GET') return send<T>(method, path, body)
  const done = beginActivity()
  try {
    return await send<T>(method, path, body)
  } finally {
    done()
  }
}

async function send<T>(
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<T> {
  const token = storedToken()
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const payload = parseBody(text)

  if (!response.ok) {
    // Only a GET is retried. That is safe because every GET the client makes
    // is idempotent — the one side effect, the revisions route's baseline
    // `ensureGameRevision`, is itself guarded and idempotent — while the game's
    // own actions are not: a retried `draw` could apply twice.
    const retryable =
      method === 'GET' && RETRYABLE_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length
    if (retryable) {
      await delay(RETRY_DELAYS_MS[attempt] ?? 0)
      return send<T>(method, path, body, attempt + 1)
    }
    const error =
      payload === NOT_JSON || payload === undefined
        ? undefined
        : (payload as { error?: string; message?: string })
    throw new ApiError(
      response.status,
      error?.error ?? 'UNKNOWN',
      error?.message ?? failureMessage(method, path, response, text),
    )
  }

  // A 2xx that is not JSON is not a payload: fail loudly rather than hand a
  // symbol to the caller as if it were the response body.
  if (payload === NOT_JSON) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      failureMessage(method, path, response, text),
    )
  }

  return payload as T
}

const get = <T>(path: string): Promise<T> => request<T>('GET', path)
const post = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {})
const patch = <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body)
const put = <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body)
const del = <T>(path: string): Promise<T> => request<T>('DELETE', path)

export interface AuthResponse {
  readonly token: string
  readonly player: PlayerDto
}

export const api = {
  register: (username: string, password: string, email: string, securityAnswer: string) =>
    post<AuthResponse>('/api/auth/register', { username, password, email, securityAnswer }),
  login: (username: string, password: string) =>
    post<AuthResponse>('/api/auth/login', { username, password }),
  /** Issue #37. Java `AuthResource.newPassword`; answers 200 either way. */
  forgotPassword: (email: string, newPassword: string) =>
    put<{ readonly ok: boolean }>('/api/auth/newpassword', {
      email,
      newpassword: newPassword,
    }),
  me: () => get<PlayerDto>('/api/auth/me'),

  adminUsers: () => get<AdminUserDto[]>('/api/admin/users'),
  updateAdminUser: (userId: string, changes: AdminUserUpdate) =>
    patch<AdminUserDto>(`/api/admin/users/${userId}`, changes),
  deleteAdminUser: (userId: string) => del<void>(`/api/admin/users/${userId}`),
  /**
   * Issue #92. Sends one personalised mail per eligible account. `exclude`
   * skips addresses already mailed; `limit` caps how many are attempted.
   */
  broadcastEmail: (
    subject: string,
    markdown: string,
    includeUnsubscribed: boolean,
    options: { readonly exclude?: readonly string[]; readonly limit?: number } = {},
  ) =>
    post<BroadcastResultDto>('/api/admin/email/broadcast', {
      subject,
      markdown,
      includeUnsubscribed,
      ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    }),
  /** Queues the message for the daily job instead of sending it now. */
  queueBroadcast: (
    subject: string,
    markdown: string,
    includeUnsubscribed: boolean,
    options: { readonly perRun: number; readonly exclude: readonly string[] },
  ) =>
    post<QueueBroadcastResponse>('/api/admin/email/broadcast/queue', {
      subject,
      markdown,
      includeUnsubscribed,
      perRun: options.perRun,
      exclude: options.exclude,
    }),
  /** The active queue, or the latest one; `null` before any was made. */
  broadcastQueue: () =>
    get<{ readonly queue: BroadcastQueueDto | null }>('/api/admin/email/broadcast/queue'),
  /** Sends the next batch now, the same function as the daily job. */
  runBroadcastQueue: () =>
    post<{ readonly run: BroadcastRunDto; readonly queue: BroadcastQueueDto | null }>(
      '/api/admin/email/broadcast/queue/run',
    ),
  /** Sets stuck rows back to pending. They may already have been delivered. */
  releaseStuckBroadcastQueue: () =>
    post<{ readonly released: number; readonly queue: BroadcastQueueDto }>(
      '/api/admin/email/broadcast/queue/release-stuck',
    ),
  cancelBroadcastQueue: () =>
    post<{ readonly queue: BroadcastQueueDto }>('/api/admin/email/broadcast/queue/cancel'),
  /** The dry run: finished games with revisions the cleanup would remove. */
  cleanupPreview: () => get<CleanupPreviewDto>('/api/admin/games/cleanup'),
  /** Cleans one finished game, or the largest ones when `gameId` is left out. */
  cleanFinishedGames: (gameId?: string) =>
    post<CleanupResultDto>('/api/admin/games/cleanup', gameId === undefined ? {} : { gameId }),
  /** The dry run of the revision compaction: games with old full saved states. */
  compactPreview: () => get<CompactPreviewDto>('/api/admin/games/revisions/compact'),
  /** One bounded step of the compaction, for one game or for the games with the most to gain. */
  compactRevisions: (gameId?: string) =>
    post<CompactResultDto>('/api/admin/games/revisions/compact', gameId === undefined ? {} : { gameId }),
  /** Public: the server route needs no bearer token. */
  highscore: () => get<HighscoreResult>('/api/highscore'),
  publicGames: () => get<PublicGameSummary[]>('/api/public/games'),
  lobbyChat: () => get<ChatMessageDto[]>('/api/chat'),
  sendLobbyChat: (message: string) => post<ChatMessageDto>('/api/chat', { message }),

  games: () => get<GameSummary[]>('/api/games'),
  createGame: (name: string, numOfPlayers: number, color?: string) =>
    post<GameSummary>('/api/games', { name, numOfPlayers, ...(color === undefined ? {} : { color }) }),
  game: (gameId: string) => get<PlayerView>(`/api/games/${gameId}`),
  revisions: (gameId: string) => get<GameRevisionSummary[]>(`/api/games/${gameId}/revisions`),
  gameRev: (gameId: string) => get<{ readonly rev: number }>(`/api/games/${gameId}/rev`),
  revision: (gameId: string, revision: number) =>
    get<GameRevisionView>(`/api/games/${gameId}/revisions/${revision}`),
  join: (gameId: string, color?: string) =>
    post<PlayerView>(`/api/games/${gameId}/join`, color === undefined ? {} : { color }),
  withdraw: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/withdraw`),
  endGame: (gameId: string, winner?: string) =>
    post<PlayerView>(`/api/games/${gameId}/end`, winner === undefined ? {} : { winner }),
  deleteGame: (gameId: string) => post<void>(`/api/games/${gameId}/delete`),

  publicLog: (gameId: string) => get<LogEntryDto[]>(`/api/games/${gameId}/log/public`),
  privateLog: (gameId: string) => get<LogEntryDto[]>(`/api/games/${gameId}/log/private`),
  revealed: (gameId: string, page: number, size: number) =>
    get<RevealedPage>(`/api/games/${gameId}/revealed?page=${page}&size=${size}`),

  // `confirmedOutOfTurn` is sent only after the player answered yes to the
  // out-of-turn warning (issue #215); wonders go through this route as well.
  draw: (gameId: string, sheetName: SheetName, confirmedOutOfTurn?: boolean) =>
    post<PlayerView>(
      `/api/games/${gameId}/draw/${sheetName}`,
      confirmedOutOfTurn === true ? { confirmedOutOfTurn: true } : undefined,
    ),
  loot: (gameId: string, category: LootCategory, targetPlayerId: string) =>
    post<PlayerView>(`/api/games/${gameId}/loot/${category}/${targetPlayerId}`),
  discardGreatPerson: (gameId: string, type: string) =>
    post<PlayerView>(`/api/games/${gameId}/greatperson/discard`, { type }),

  drawBattlehand: (gameId: string, numberOfUnits: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/draw`, { numberOfUnits }),
  revealBattlehand: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/battle/reveal`),
  endBattle: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/battle/end`),
  drawBarbarians: (gameId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/barbarians`, { rev }),
  discardBarbarians: (gameId: string) =>
    post<PlayerView>(`/api/games/${gameId}/battle/barbarians/discard`),

  // Battle arena (issue #63)
  initiateBattle: (gameId: string, opponentId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/initiate`, { opponentId, rev }),
  placeUnitInArena: (
    gameId: string,
    unitId: string,
    side: 'attacker' | 'defender',
    position: number,
    attack: number,
    health: number,
    rev: number,
  ) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/place`, {
      unitId,
      side,
      position,
      attack,
      health,
      rev,
    }),
  setArenaUnitStat: (
    gameId: string,
    arenaUnitId: string,
    key: 'attack' | 'health',
    value: number,
    rev: number,
  ) =>
    patch<PlayerView>(`/api/games/${gameId}/battle/arena/${arenaUnitId}`, { key, value, rev }),
  killArenaUnit: (gameId: string, arenaUnitId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/${arenaUnitId}/kill`, { rev }),
  rotateArenaUnit: (gameId: string, arenaUnitId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/${arenaUnitId}/rotate`, { rev }),
  moveArenaUnit: (gameId: string, arenaUnitId: string, position: number, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/${arenaUnitId}/move`, { position, rev }),
  returnArenaUnitToHand: (gameId: string, arenaUnitId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/${arenaUnitId}/return`, { rev }),
  endBattleTurn: (gameId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/turn/end`, { rev }),
  endBattleArena: (gameId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/end`, { rev }),
  undoEndBattle: (gameId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/arena/end/undo`, { rev }),

  availableTechs: (gameId: string) => get<TechItem[]>(`/api/games/${gameId}/techs/available`),
  revealedTechs: (gameId: string) => get<RevealedTechsDto[]>(`/api/games/${gameId}/techs/revealed`),
  chooseTech: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/techs/choose`, { name }),
  removeTech: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/techs/remove`, { name }),
  revealTech: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/techs/reveal`, { name }),
  setTechSlot: (gameId: string, name: string, slot: 1 | 2 | 3 | 4 | 5) =>
    post<PlayerView>(`/api/games/${gameId}/techs/slot`, { name, slot }),
  placeGreatPersonInPyramid: (gameId: string, itemId: string, slot: 1 | 2 | 3 | 4 | 5) =>
    post<PlayerView>(`/api/games/${gameId}/greatperson/place`, { itemId, slot }),
  setPyramidPlacementSlot: (gameId: string, name: string, slot: 1 | 2 | 3 | 4 | 5) =>
    post<PlayerView>(`/api/games/${gameId}/greatperson/slot`, { name, slot }),

  socialPolicies: (gameId: string) =>
    get<SocialPolicyItem[]>(`/api/games/${gameId}/socialpolicies`),
  chooseSocialPolicy: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/socialpolicy/choose`, { name }),
  removeSocialPolicy: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/socialpolicy/remove`, { name }),
  revealSocialPolicy: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/socialpolicies/reveal`, { name }),

  revealItem: (gameId: string, sheetName: SheetName, itemNumber: number) =>
    post<PlayerView>(`/api/games/${gameId}/items/reveal`, { sheetName, itemNumber }),
  discardItem: (gameId: string, sheetName: SheetName, itemNumber: number, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/items/discard`, { sheetName, itemNumber, name }),
  itemBackToDeck: (gameId: string, sheetName: SheetName, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/items/backtodeck`, { sheetName, name }),
  tradeItem: (
    gameId: string,
    sheetName: SheetName,
    itemNumber: number,
    name: string,
    targetPlayerId: string,
  ) =>
    post<PlayerView>(`/api/games/${gameId}/items/trade`, {
      sheetName,
      itemNumber,
      name,
      targetPlayerId,
    }),

  // Orders and done marks (issue #215). The turn defaults to the current one on the server.
  postOrder: (gameId: string, phase: TurnPhase, markdown: string, turnNumber?: number) =>
    post<PlayerView>(`/api/games/${gameId}/turns/order`, {
      phase,
      markdown,
      ...(turnNumber === undefined ? {} : { turnNumber }),
    }),
  markDone: (gameId: string, phase: TurnPhase, turnNumber?: number) =>
    post<PlayerView>(`/api/games/${gameId}/turns/done`, {
      phase,
      ...(turnNumber === undefined ? {} : { turnNumber }),
    }),
  unmarkDone: (gameId: string, phase: TurnPhase, turnNumber?: number) =>
    post<PlayerView>(`/api/games/${gameId}/turns/undone`, {
      phase,
      ...(turnNumber === undefined ? {} : { turnNumber }),
    }),
  saveNote: (gameId: string, note: string) => post<PlayerView>(`/api/games/${gameId}/note`, { note }),
  // Shared bookkeeping: any member may set any player's stat (issue #43).
  setPlayerStat: (
    gameId: string,
    targetPlayerId: string,
    stat: PlayerStatKey,
    // Movement (issue #102) takes its expression as a string ("3+1") and Combat
    // hand size is free text; every other stat is a number.
    value: number | string,
  ) =>
    post<PlayerView>(`/api/games/${gameId}/players/${targetPlayerId}/stat`, { stat, value }),
  // The coin counters are shared bookkeeping too; the engine caps each source.
  setPlayerCoin: (
    gameId: string,
    targetPlayerId: string,
    source: CoinSourceKey,
    value: number,
  ) =>
    post<PlayerView>(`/api/games/${gameId}/players/${targetPlayerId}/coin`, { source, value }),
  /**
   * One assisted action (#260). `requestId` is chosen by the caller and kept until
   * the request settles, so a retry cannot do the action twice; `rev` is the
   * revision the caller saw, so a stale tab gets the usual 409.
   */
  performAction: (gameId: string, action: AssistedActionKind, requestId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/actions`, { action, requestId, rev }),
  /**
   * The card choice after a culture advance: the same route as `performAction`,
   * with the reward and the card to keep. The request id is kept like any other.
   */
  chooseReward: (gameId: string, rewardId: string, itemId: string, requestId: string, rev: number) =>
    post<PlayerView>(`/api/games/${gameId}/actions`, {
      action: 'chooseReward',
      requestId,
      rev,
      rewardId,
      itemId,
    }),
  setPlayerGovernment: (
    gameId: string,
    targetPlayerId: string,
    government: Government,
  ) =>
    post<PlayerView>(`/api/games/${gameId}/players/${targetPlayerId}/government`, {
      government,
    }),

  initiateUndo: (gameId: string, logId: string) =>
    post<PlayerView>(`/api/games/${gameId}/undo/${logId}`),
  voteUndo: (gameId: string, logId: string, vote: boolean) =>
    post<PlayerView>(`/api/games/${gameId}/undo/${logId}/vote`, { vote }),
  pendingUndos: (gameId: string) => get<PendingUndoDto[]>(`/api/games/${gameId}/undo/pending`),

  boardAssets: () => get<BoardAsset[]>('/api/board/assets'),
  placePiece: (gameId: string, assetId: string, x: number, y: number) =>
    post<PlayerView>(`/api/games/${gameId}/board/pieces`, { assetId, x, y }),
  movePiece: (gameId: string, pieceId: string, x: number, y: number, snap?: boolean) =>
    post<PlayerView>(`/api/games/${gameId}/board/pieces/${pieceId}/move`, {
      x,
      y,
      ...(snap === undefined ? {} : { snap }),
    }),
  setWonderOwner: (gameId: string, pieceId: string, ownerId: string | null) =>
    post<PlayerView>(`/api/games/${gameId}/board/pieces/${pieceId}/owner`, { ownerId }),
  rotatePiece: (gameId: string, pieceId: string, rotation?: number) =>
    post<PlayerView>(
      `/api/games/${gameId}/board/pieces/${pieceId}/rotate`,
      rotation === undefined ? {} : { rotation },
    ),
  pieceToFront: (gameId: string, pieceId: string) =>
    post<PlayerView>(`/api/games/${gameId}/board/pieces/${pieceId}/front`),
  pieceToBack: (gameId: string, pieceId: string) =>
    post<PlayerView>(`/api/games/${gameId}/board/pieces/${pieceId}/back`),
  removePiece: (gameId: string, pieceId: string) =>
    post<PlayerView>(`/api/games/${gameId}/board/pieces/${pieceId}/remove`),
  undoBoard: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/board/undo`),
  redoBoard: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/board/redo`),

  /** The timeline: the current turn, or the turn before `before` (a message id). */
  chatPage: (gameId: string, before?: string) =>
    get<ChatPageDto>(
      `/api/games/${gameId}/chat${before === undefined ? '' : `?before=${encodeURIComponent(before)}`}`,
    ),
  sendChat: (gameId: string, message: string) =>
    post<ChatMessageDto>(`/api/games/${gameId}/chat`, { message }),
}
