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
  Item,
  PlayerTurn,
  PlayerView,
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
  Item,
  PlayerTurn,
  PlayerView,
  SheetName,
  SocialPolicyItem,
  TechItem,
  WinnerEntry,
}

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
  readonly numOfPlayers: number
  readonly active: boolean
  readonly winner: string | null
  readonly players: readonly { readonly username: string; readonly color: string | null }[]
  readonly nameOfUsersTurn: string
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

async function request<T>(
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST',
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
  const payload: unknown = text === '' ? undefined : JSON.parse(text)

  if (!response.ok) {
    const error = payload as { error?: string; message?: string } | undefined
    throw new ApiError(
      response.status,
      error?.error ?? 'UNKNOWN',
      error?.message ?? `${method} ${path} failed with ${response.status}`,
    )
  }

  return payload as T
}

const get = <T>(path: string): Promise<T> => request<T>('GET', path)
const post = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {})
const patch = <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body)
const del = <T>(path: string): Promise<T> => request<T>('DELETE', path)

export interface AuthResponse {
  readonly token: string
  readonly player: PlayerDto
}

export const api = {
  register: (username: string, password: string, email: string) =>
    post<AuthResponse>('/api/auth/register', { username, password, email }),
  login: (username: string, password: string) =>
    post<AuthResponse>('/api/auth/login', { username, password }),
  me: () => get<PlayerDto>('/api/auth/me'),

  adminUsers: () => get<AdminUserDto[]>('/api/admin/users'),
  updateAdminUser: (userId: string, changes: AdminUserUpdate) =>
    patch<AdminUserDto>(`/api/admin/users/${userId}`, changes),
  deleteAdminUser: (userId: string) => del<void>(`/api/admin/users/${userId}`),
  /** Public: the server route needs no bearer token. */
  highscore: () => get<HighscoreResult>('/api/highscore'),
  publicGames: () => get<PublicGameSummary[]>('/api/public/games'),
  lobbyChat: () => get<ChatMessageDto[]>('/api/chat'),
  sendLobbyChat: (message: string) => post<ChatMessageDto>('/api/chat', { message }),

  games: () => get<GameSummary[]>('/api/games'),
  createGame: (name: string, numOfPlayers: number) =>
    post<GameSummary>('/api/games', { name, numOfPlayers }),
  game: (gameId: string) => get<PlayerView>(`/api/games/${gameId}`),
  join: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/join`),
  withdraw: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/withdraw`),
  endGame: (gameId: string, winner?: string) =>
    post<PlayerView>(`/api/games/${gameId}/end`, winner === undefined ? {} : { winner }),
  deleteGame: (gameId: string) => post<void>(`/api/games/${gameId}/delete`),

  publicLog: (gameId: string) => get<LogEntryDto[]>(`/api/games/${gameId}/log/public`),
  privateLog: (gameId: string) => get<LogEntryDto[]>(`/api/games/${gameId}/log/private`),
  revealed: (gameId: string) => get<Item[]>(`/api/games/${gameId}/revealed`),

  draw: (gameId: string, sheetName: SheetName) =>
    post<PlayerView>(`/api/games/${gameId}/draw/${sheetName}`),
  loot: (gameId: string, sheetName: SheetName, targetPlayerId: string) =>
    post<PlayerView>(`/api/games/${gameId}/loot/${sheetName}/${targetPlayerId}`),

  drawBattlehand: (gameId: string, numberOfUnits: number) =>
    post<PlayerView>(`/api/games/${gameId}/battle/draw`, { numberOfUnits }),
  revealBattlehand: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/battle/reveal`),
  endBattle: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/battle/end`),
  drawBarbarians: (gameId: string) => post<PlayerView>(`/api/games/${gameId}/battle/barbarians`),
  discardBarbarians: (gameId: string) =>
    post<PlayerView>(`/api/games/${gameId}/battle/barbarians/discard`),

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
  lockTurn: (gameId: string, turnNumber: number, locked: boolean) =>
    post<PlayerView>(`/api/games/${gameId}/turns/lock`, { turnNumber, locked }),
  saveNote: (gameId: string, note: string) => post<PlayerView>(`/api/games/${gameId}/note`, { note }),

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
