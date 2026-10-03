/**
 * Plays a real game through the engine and records every state the server would
 * have saved, so the delta tests run on the shape and growth of real data (a
 * deck that shrinks, a log and a board history that only grow, hands that change
 * one player at a time) instead of toy objects.
 *
 * It follows `applyToGame`: run the reducer, bump `rev`, stamp the log, build the
 * revision with `createGameRevision`. Private notes are saved the way the route
 * saves them: no revision, but `rev` still moves.
 */

import {
  chooseTech,
  createGame,
  discardItem,
  draw,
  endTurn,
  joinGame,
  placePiece,
  revealItem,
  saveNote,
  setPlayerStat,
} from '@civ/engine'
import type { EngineError, GameState, Result, SheetName } from '@civ/engine'

import { createGameRevision, stampLog } from '../src/context.js'
import type { GameRevision } from '../src/store/types.js'

export interface RecordedStep {
  /** The live game before the action, as the route loaded it. */
  readonly before: GameState
  /** The live game after the action, as it was saved. */
  readonly after: GameState
  /** The checkpoint for the step; `undefined` for a private note, which has none. */
  readonly revision: GameRevision | undefined
}

export interface RecordedGame {
  /** The state the first revision (the baseline) was taken from. */
  readonly start: GameState
  readonly steps: readonly RecordedStep[]
}

export interface PlayOptions {
  /** Recorded steps (private notes come on top of these). */
  readonly steps: number
  readonly players?: number
  readonly name?: string
  /** Every N-th step is a private note saved without a revision. 0 turns it off. */
  readonly noteEvery?: number
}

const SHEETS: readonly SheetName[] = [
  'CULTURE_1',
  'INFANTRY',
  'CULTURE_2',
  'ARTILLERY',
  'MOUNTED',
  'GREAT_PERSON',
  'CULTURE_3',
  'VILLAGES',
  'HUTS',
]

const TECHS = ['Pottery', 'Bronze Working', 'Writing', 'Masonry', 'Currency', 'Mysticism']

type Outcome = Result<GameState, EngineError>

/** A tiny deterministic generator, so the recorded game is the same on every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function startGame(options: { players?: number; name?: string } = {}): GameState {
  const count = options.players ?? 3
  const name = options.name ?? 'Recorded'
  let state = createGame({
    name,
    numOfPlayers: count,
    seed: `${name}:seed`,
    secret: `${name}:secret`,
    players: [],
    createdAt: '2026-10-01T00:00:00.000Z',
  })
  for (let index = 0; index < count; index++) {
    const joined = joinGame(state, {
      playerId: `p${index + 1}`,
      username: `Player${index + 1}`,
      gameCreator: index === 0,
    })
    if (!joined.ok) throw new Error(`joinGame failed: ${joined.error.kind}`)
    state = stampLog(joined.value, '2026-10-01T00:00:00.000Z')
  }
  return state
}

export function playRecordedGame(options: PlayOptions): RecordedGame {
  const random = lcg(options.steps * 7919 + (options.players ?? 3))
  const noteEvery = options.noteEvery ?? 0
  const start = startGame(options)

  const steps: RecordedStep[] = []
  let live = start
  let recorded = 0
  let turnActions = 0
  let tick = 0

  while (recorded < options.steps) {
    tick += 1
    if (tick > options.steps * 20) throw new Error('The recorded game made no progress')
    const now = `2026-10-01T00:${String(Math.floor(tick / 60) % 60).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}.000Z`
    const holder = live.players.find((player) => player.yourTurn)
    if (holder === undefined) throw new Error('Nobody holds the turn')

    const isNote = noteEvery > 0 && tick % noteEvery === 0
    if (isNote) {
      const noted = saveNote(live, holder.playerId, `plan ${tick}: ${'x'.repeat(Math.floor(random() * 80))}`)
      if (!noted.ok) continue
      const after = stampLog({ ...noted.value, rev: live.rev + 1 }, now)
      steps.push({ before: live, after, revision: undefined })
      live = after
      continue
    }

    const pick = Math.floor(random() * 10)
    let outcome: Outcome
    if (turnActions >= 4 + (tick % 3)) {
      outcome = endTurn(live)
    } else if (pick < 4) {
      outcome = draw(live, { playerId: holder.playerId, sheetName: SHEETS[Math.floor(random() * SHEETS.length)] as SheetName })
    } else if (pick === 4 && holder.items.length > 0) {
      const item = holder.items[Math.floor(random() * holder.items.length)]
      outcome = item === undefined
        ? endTurn(live)
        : discardItem(live, { playerId: holder.playerId, sheetName: item.sheetName, itemNumber: item.itemNumber, name: 'x' })
    } else if (pick === 5) {
      outcome = chooseTech(live, { playerId: holder.playerId, techName: TECHS[Math.floor(random() * TECHS.length)] as string })
    } else if (pick === 6) {
      outcome = setPlayerStat(live, {
        editorPlayerId: holder.playerId,
        targetPlayerId: holder.playerId,
        stat: 'trade',
        value: Math.floor(random() * 9),
        at: now,
      })
    } else if (pick === 7) {
      outcome = placePiece(live, {
        playerId: holder.playerId,
        assetId: 'resources/hut',
        x: 2 + Math.floor(random() * 10),
        y: 2 + Math.floor(random() * 10),
        at: now,
      })
    } else if (pick === 8 && holder.items.length > 0) {
      const item = holder.items[0]
      outcome = item === undefined
        ? endTurn(live)
        : revealItem(live, { playerId: holder.playerId, sheetName: item.sheetName, itemNumber: item.itemNumber })
    } else {
      outcome = endTurn(live)
    }
    if (!outcome.ok) {
      // A refused action changes nothing and saves nothing, like the route.
      if (turnActions > 0) turnActions += 1
      continue
    }
    turnActions = pick >= 9 || turnActions >= 4 + (tick % 3) ? 0 : turnActions + 1

    const after = stampLog({ ...outcome.value, rev: live.rev + 1 }, now)
    const revision = createGameRevision(live, after, { id: holder.playerId, username: holder.username }, now, 'Game state updated')
    steps.push({ before: live, after, revision })
    live = after
    recorded += 1
  }

  return { start, steps }
}
