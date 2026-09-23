/**
 * Typed client for @civ/server.
 *
 * The game-state types come straight from the engine, so the client and the
 * server cannot drift apart. Only the DTOs the server defines itself are
 * repeated here.
 */

import type {
  Board,
  BoardArea,
  BoardAsset,
  BoardHistoryEntry,
  BoardPiece,
  HighscoreResult,
  Government,
  Item,
  PlayerStats,
  PlayerTurn,
  PlayerView,
  RevealedEntry,
  SheetName,
  SocialPolicyItem,
  TechItem,
  WinnerEntry,
} from '@civ/engine'

export type {
  Board,
  BoardArea,
  BoardAsset,
  BoardHistoryEntry,
  BoardPiece,
  HighscoreResult,
  Government,
  Item,
  PlayerStats,
  PlayerTurn,
  PlayerView,
  RevealedEntry,
  SheetName,
  SocialPolicyItem,
  TechItem,
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
}

export interface AdminUserUpdate {
  readonly username?: string
  readonly email?: string | null
  readonly role?: 'user' | 'admin'
  readonly disabled?: boolean
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
}

export interface ChatMessageDto {
  readonly id: string
  readonly username: string
  readonly message: string
  readonly createdAt: string
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
  readonly privateDescription: string | null
  readonly logIds: readonly string[]
}

export interface GameRevisionView extends GameRevisionSummary {
  readonly view: PlayerView
  readonly availableTechs: readonly TechItem[]
  readonly revealedTechs: readonly RevealedTechsDto[]
  readonly socialPolicies: readonly SocialPolicyItem[]
  readonly publicTurns: readonly PlayerTurn[]
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

async function request<T>(
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
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
  /** Issue #92. Sends one personalised mail per eligible account. */
  broadcastEmail: (subject: string, markdown: string, includeUnsubscribed: boolean) =>
    post<{ readonly sent: number; readonly skipped: number }>(
      '/api/admin/email/broadcast',
      { subject, markdown, includeUnsubscribed },
    ),
  /** Public: the server route needs no bearer token. */
  highscore: () => get<HighscoreResult>('/api/highscore'),
  publicGames: () => get<PublicGameSummary[]>('/api/public/games'),
  lobbyChat: () => get<ChatMessageDto[]>('/api/chat'),
  sendLobbyChat: (message: string) => post<ChatMessageDto>('/api/chat', { message }),

  games: () => get<GameSummary[]>('/api/games'),
  createGame: (name: string, numOfPlayers: number) =>
    post<GameSummary>('/api/games', { name, numOfPlayers }),
  game: (gameId: string) => get<PlayerView>(`/api/games/${gameId}`),
  revisions: (gameId: string) => get<GameRevisionSummary[]>(`/api/games/${gameId}/revisions`),
  revision: (gameId: string, revision: number) =>
    get<GameRevisionView>(`/api/games/${gameId}/revisions/${revision}`),
  join: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/join`),
  withdraw: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/withdraw`),
  endGame: (gameId: string, winner?: string) =>
    post<PlayerView>(`/api/games/${gameId}/end`, winner === undefined ? {} : { winner }),
  deleteGame: (gameId: string) => post<void>(`/api/games/${gameId}/delete`),

  publicLog: (gameId: string) => get<LogEntryDto[]>(`/api/games/${gameId}/log/public`),
  privateLog: (gameId: string) => get<LogEntryDto[]>(`/api/games/${gameId}/log/private`),
  revealed: (gameId: string, page: number, size: number) =>
    get<RevealedPage>(`/api/games/${gameId}/revealed?page=${page}&size=${size}`),

  draw: (gameId: string, sheetName: SheetName) =>
    post<PlayerView>(`/api/games/${gameId}/draw/${sheetName}`),
  loot: (gameId: string, category: LootCategory, targetPlayerId: string) =>
    post<PlayerView>(`/api/games/${gameId}/loot/${category}/${targetPlayerId}`),
  discardGreatPerson: (gameId: string, type: string) =>
    post<PlayerView>(`/api/games/${gameId}/greatperson/discard`, { type }),

  drawBattlehand: (gameId: string, numberOfUnits: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/draw`, { numberOfUnits }),
  revealBattlehand: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/battle/reveal`),
  endBattle: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/battle/end`),
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

  availableTechs: (gameId: string) => get<TechItem[]>(`/api/games/${gameId}/techs/available`),
  revealedTechs: (gameId: string) => get<RevealedTechsDto[]>(`/api/games/${gameId}/techs/revealed`),
  chooseTech: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/techs/choose`, { name }),
  removeTech: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/techs/remove`, { name }),
  revealTech: (gameId: string, name: string) =>
    post<PlayerView>(`/api/games/${gameId}/techs/reveal`, { name }),

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

  endTurn: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/endturn`),
  takeTurn: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/taketurn`),
  publicTurns: (gameId: string) => get<PlayerTurn[]>(`/api/games/${gameId}/turns/public`),
  myTurns: (gameId: string) => get<PlayerTurn[]>(`/api/games/${gameId}/turns/mine`),
  updateTurn: (gameId: string, turnNumber: number, phase: string, order: string) =>
    post<PlayerView>(`/api/games/${gameId}/turns/update`, { turnNumber, phase, order }),
  revealTurnOrder: (gameId: string, turnNumber: number, phase: string) =>
    post<PlayerView>(`/api/games/${gameId}/turns/reveal`, { turnNumber, phase }),
  lockTurn: (gameId: string, turnNumber: number, locked: boolean) =>
    post<PlayerView>(`/api/games/${gameId}/turns/lock`, { turnNumber, locked }),
  saveNote: (gameId: string, note: string) => post<PlayerView>(`/api/games/${gameId}/note`, { note }),
  // Shared bookkeeping: any member may set any player's stat (issue #43).
  setPlayerStat: (
    gameId: string,
    targetPlayerId: string,
    stat: keyof PlayerStats,
    // Movement (issue #102) takes its expression as a string ("3+1"); every
    // other stat is a number.
    value: number | string,
  ) =>
    post<PlayerView>(`/api/games/${gameId}/players/${targetPlayerId}/stat`, { stat, value }),
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
  movePiece: (gameId: string, pieceId: string, x: number, y: number) =>
    post<PlayerView>(`/api/games/${gameId}/board/pieces/${pieceId}/move`, { x, y }),
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

  chat: (gameId: string) => get<ChatMessageDto[]>(`/api/games/${gameId}/chat`),
  sendChat: (gameId: string, message: string) =>
    post<ChatMessageDto>(`/api/games/${gameId}/chat`, { message }),
}
