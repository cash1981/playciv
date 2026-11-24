/**
 * The setup before turn 1 over HTTP (issue #374): `POST /api/games/:id/setup`, the gate on `turns/done`, the great person
 * through the `/actions` route and what the other player sees. The rules are in `packages/engine/test/setup.test.ts`; these
 * check the strict shape of the body, the error mapping and that nothing private reaches the other seat.
 *
 * The scene: a two-player game in which the starter has revealed a civilization, so setup is open for them and not for the
 * other player. The squares are read from the starter's own view, as the web reads them.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { revealItem } from '@civ/engine'
import type { GameState } from '@civ/engine'

import { createTestApp } from '../src/app.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { inject } from './helpers.js'

let app: App
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

interface Square {
  readonly column: number
  readonly row: number
  readonly label: string
  readonly direction?: string
}
interface Step {
  readonly id: string
  readonly status: string
  readonly reason: string
  readonly squares: readonly Square[]
  readonly canUndo: boolean
  readonly items: readonly { readonly id: string; readonly status: string; readonly squares: readonly Square[] }[]
}
interface View {
  readonly rev: number
  readonly you: { readonly setup: { readonly steps: readonly Step[]; readonly blocksTurn: string | null; readonly passed: boolean } | null } | null
  readonly activeTurn: { readonly username: string; readonly stage?: string } | null
  readonly opponents: readonly Record<string, unknown>[]
  readonly board: { readonly pieces: readonly { readonly id: string; readonly assetId: string; readonly category: string }[] }
  readonly log: readonly { readonly publicLog: string; readonly logType: string | null }[]
}

async function register(username: string): Promise<string> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret', email: `${username}@example.com`, securityAnswer: 'writing' },
  })
  expect(response.status).toBe(201)
  return (await response.json() as { token: string }).token
}

const view = async (gameId: string, token: string): Promise<View> =>
  (await inject(app, { url: `/api/games/${gameId}`, headers: bearer(token) })).json<View>()

const post = (token: string, url: string, payload: unknown) =>
  inject(app, { method: 'POST', url, headers: bearer(token), payload })

const setupUrl = (gameId: string) => `/api/games/${gameId}/setup`
const stepOf = (v: View, id: string): Step => {
  const found = v.you?.setup?.steps.find((step) => step.id === id)
  if (found === undefined) throw new Error(`no ${id} step`)
  return found
}

async function table(name: string, civ = 'Chinese') {
  const creator = await register(`${name}-a`)
  const created = await inject(app, {
    method: 'POST', url: '/api/games', headers: bearer(creator), payload: { name, numOfPlayers: 2 },
  })
  const gameId = (await created.json() as { id: string }).id
  const joiner = await register(`${name}-b`)
  await post(joiner, `/api/games/${gameId}/join`, {})

  const state = await repo.findGame(gameId)
  if (state === undefined) throw new Error('game missing')
  const starterPlayer = state.players.find((player) => player.yourTurn)
  const starterId = starterPlayer?.playerId ?? ''
  const starter = starterPlayer?.username === `${name}-a` ? creator : joiner
  const other = starter === creator ? joiner : creator

  const card = state.items.find((item) => item.kind === 'civ' && item.name === civ)
  if (card === undefined) throw new Error(`no ${civ} card in the deck`)
  const handed: GameState = {
    ...state,
    items: state.items.filter((item) => item.id !== card.id),
    players: state.players.map((player) =>
      player.playerId === starterId ? { ...player, items: [...player.items, { ...card, ownerId: starterId }] } : player,
    ),
  }
  const result = revealItem(handed, { playerId: starterId, sheetName: 'CIV', itemNumber: card.itemNumber })
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  await repo.saveGame(result.value)
  return { gameId, starter, other, starterId }
}

/** The body for the first square the picker offers for the capital. */
const firstCapital = (v: View) => {
  const square = stepOf(v, 'capital').squares[0]
  if (square === undefined) throw new Error('no capital square')
  return { step: 'capital', column: square.column, row: square.row, ...(square.direction === undefined ? {} : { direction: square.direction }) }
}

describe('POST /api/games/:id/setup', () => {
  it('shows the starter their steps and the other player nothing', async () => {
    const t = await table('set-view')
    const own = await view(t.gameId, t.starter)
    expect(own.you?.setup?.steps.map((step) => step.id)).toEqual(['capital', 'figures', 'policy', 'trade', 'government'])
    expect(own.you?.setup?.blocksTurn).toContain('still to do: capital, figures, social policy, starting trade')
    expect(stepOf(own, 'capital').squares.length).toBeGreaterThan(0)

    const theirs = await view(t.gameId, t.other)
    expect(theirs.you?.setup).toBeNull()
    const text = JSON.stringify(theirs)
    expect(text).not.toContain('blocksTurn')
    expect(text).not.toContain('historyIds')
    expect(theirs.opponents.every((opponent) => !('setup' in opponent))).toBe(true)
  })

  it('places the capital, a figure and the starting trade, with public lines the other player can read', async () => {
    const t = await table('set-steps')
    let v = await view(t.gameId, t.starter)
    let response = await post(t.starter, setupUrl(t.gameId), { ...firstCapital(v), rev: v.rev, requestId: 'cap-1' })
    expect(response.status).toBe(200)
    v = await response.json<View>()
    expect(stepOf(v, 'capital').status).toBe('done')
    expect(v.board.pieces.some((piece) => piece.assetId === 'cities/redcapitalwalled2' || piece.category === 'city')).toBe(true)

    const army = stepOf(v, 'figures').items.find((item) => item.id === 'army')?.squares[0]
    if (army === undefined) throw new Error('no army square')
    response = await post(t.starter, setupUrl(t.gameId), { step: 'figure', figure: 'army', column: army.column, row: army.row, rev: v.rev })
    expect(response.status).toBe(200)
    v = await response.json<View>()
    expect(stepOf(v, 'figures').items.find((item) => item.id === 'army')?.status).toBe('done')

    response = await post(t.starter, setupUrl(t.gameId), { step: 'trade', rev: v.rev })
    expect(response.status).toBe(200)
    v = await response.json<View>()
    expect(stepOf(v, 'trade').status).toBe('done')

    const theirs = await view(t.gameId, t.other)
    const lines = theirs.log.filter((entry) => entry.logType === 'SETUP').map((entry) => entry.publicLog)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/placed their (walled )?capital on [A-Z]\d+ in setup$/)
    expect(lines[1]).toMatch(/placed their army on [A-Z]\d+ in setup$/)
    expect(lines[2]).toMatch(/counted \d+ trade around their capital in setup$/)
  })

  it('takes steps back by undo: true, and refuses the capital while the trade stands', async () => {
    const t = await table('set-undo')
    let v = await view(t.gameId, t.starter)
    v = await (await post(t.starter, setupUrl(t.gameId), { ...firstCapital(v), rev: v.rev })).json<View>()
    v = await (await post(t.starter, setupUrl(t.gameId), { step: 'trade', rev: v.rev })).json<View>()
    const refused = await post(t.starter, setupUrl(t.gameId), { step: 'capital', undo: true, rev: v.rev })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'SETUP_REFUSED' })
    expect(JSON.stringify(await (await post(t.starter, setupUrl(t.gameId), { step: 'capital', undo: true })).json())).toContain('Take back the starting trade first')

    v = await (await post(t.starter, setupUrl(t.gameId), { step: 'trade', undo: true, rev: v.rev })).json<View>()
    expect(stepOf(v, 'trade').status).toBe('todo')
    v = await (await post(t.starter, setupUrl(t.gameId), { step: 'capital', undo: true, rev: v.rev })).json<View>()
    expect(stepOf(v, 'capital').status).toBe('todo')
  })

  it('answers 200 to an undo repeated after it went through, without a new revision', async () => {
    const t = await table('set-undo-twice')
    let v = await view(t.gameId, t.starter)
    v = await (await post(t.starter, setupUrl(t.gameId), { ...firstCapital(v), rev: v.rev })).json<View>()
    v = await (await post(t.starter, setupUrl(t.gameId), { step: 'trade', rev: v.rev })).json<View>()
    const first = await post(t.starter, setupUrl(t.gameId), { step: 'trade', undo: true, rev: v.rev, requestId: 'undo-1' })
    expect(first.status).toBe(200)
    const after = await first.json<View>()
    // The retry carries the old rev (a lost answer) and, without one, the new rev: both answer 200 and change nothing
    for (const rev of [v.rev, after.rev, undefined]) {
      const again = await post(t.starter, setupUrl(t.gameId), { step: 'trade', undo: true, ...(rev === undefined ? {} : { rev }), requestId: 'undo-1' })
      expect(again.status, `${rev} ${again.body} now=${(await view(t.gameId, t.starter)).rev}`).toBe(200)
    }
    expect((await view(t.gameId, t.starter)).rev).toBe(after.rev)
  })

  it('refuses an illegal square with the reason and changes nothing', async () => {
    const t = await table('set-bad-square')
    const v = await view(t.gameId, t.starter)
    const response = await post(t.starter, setupUrl(t.gameId), { step: 'capital', column: 9, row: 9, rev: v.rev })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'SETUP_REFUSED' })
    expect((await view(t.gameId, t.starter)).rev).toBe(v.rev)
  })

  it('refuses a malformed body and changes nothing', async () => {
    const t = await table('set-shape')
    const v = await view(t.gameId, t.starter)
    const square = stepOf(v, 'capital').squares[0]
    if (square === undefined) throw new Error('no square')
    const good = { step: 'capital', column: square.column, row: square.row }
    const bad: unknown[] = [
      {},
      'x',
      { ...good, step: 'policy' },
      { ...good, step: undefined },
      { ...good, extra: true },
      { ...good, column: 1.5 },
      { ...good, column: -1 },
      { ...good, row: 1000 },
      { ...good, row: '1' },
      { ...good, row: undefined },
      { ...good, direction: 'up' },
      { ...good, figure: 'army' },
      { ...good, undo: 'yes' },
      { ...good, undo: true },
      { ...good, rev: 1.5 },
      { ...good, rev: -1 },
      { ...good, requestId: '../etc' },
      { step: 'figure', column: 1, row: 1 },
      { step: 'figure', figure: 'knight', column: 1, row: 1 },
      { step: 'figure', figure: 'army', column: 1, row: 1, direction: 'east' },
      { step: 'figure', undo: true },
      { step: 'figure', undo: true, figure: 'army', column: 1 },
      { step: 'trade', column: 1, row: 1 },
      { step: 'trade', undo: true, figure: 'army' },
      { step: 'wonder', column: 1 },
      { step: 'wonder', figure: 'army', column: 1, row: 1 },
    ]
    for (const body of bad) {
      const response = await post(t.starter, setupUrl(t.gameId), body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    }
    expect((await view(t.gameId, t.starter)).rev).toBe(v.rev)
  })

  it('answers 409 to a stale rev, and a repeated request changes nothing', async () => {
    const t = await table('set-rev')
    const v = await view(t.gameId, t.starter)
    const body = { ...firstCapital(v), rev: v.rev, requestId: 'cap-1' }
    expect((await post(t.starter, setupUrl(t.gameId), body)).status).toBe(200)
    const after = await view(t.gameId, t.starter)
    // The same request again: the revision it saw is stale, but it is already done
    const repeat = await post(t.starter, setupUrl(t.gameId), body)
    expect(repeat.status).toBe(200)
    expect((await view(t.gameId, t.starter)).rev).toBe(after.rev)
    // Another request on the old revision is a conflict
    const stale = await post(t.starter, setupUrl(t.gameId), { step: 'trade', rev: v.rev })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'CONFLICT' })
  })

  it('has nothing for a player with no setup, nor for someone who is not in the game', async () => {
    const t = await table('set-other')
    const v = await view(t.gameId, t.other)
    expect((await post(t.other, setupUrl(t.gameId), { step: 'trade', rev: v.rev })).status).toBe(400)
    const stranger = await register('set-other-c')
    expect((await post(stranger, setupUrl(t.gameId), { step: 'trade' })).status).toBe(403)
    expect((await inject(app, { method: 'POST', url: setupUrl(t.gameId), payload: { step: 'trade' } })).status).toBe(401)
  })
})

describe('the gate on turns/done', () => {
  it('answers 409 SETUP_INCOMPLETE with the missing steps until setup is done, then lets Start of Turn through', async () => {
    const t = await table('set-gate')
    let v = await view(t.gameId, t.starter)
    for (const phase of ['SOT', 'TRADE', 'RESEARCH']) {
      const refused = await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase, turnNumber: 1 })
      expect(refused.status).toBe(409)
      const body = await refused.json<{ error: string; message: string }>()
      expect(body.error).toBe('SETUP_INCOMPLETE')
      expect(body.message).toBe(v.you?.setup?.blocksTurn)
    }

    v = await (await post(t.starter, setupUrl(t.gameId), { ...firstCapital(v), rev: v.rev })).json<View>()
    for (const figure of ['army', 'scout']) {
      const square = stepOf(v, 'figures').items.find((item) => item.id === figure)?.squares[0]
      if (square === undefined) throw new Error(`no ${figure} square`)
      v = await (await post(t.starter, setupUrl(t.gameId), { step: 'figure', figure, column: square.column, row: square.row })).json<View>()
    }
    v = await (await post(t.starter, setupUrl(t.gameId), { step: 'trade' })).json<View>()
    const policy = (await repo.findGame(t.gameId))?.socialPolicies[0]?.name
    expect((await post(t.starter, `/api/games/${t.gameId}/socialpolicy/choose`, { name: policy })).status).toBe(200)
    v = await view(t.gameId, t.starter)
    expect(v.you?.setup?.blocksTurn).toBeNull()

    const done = await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'SOT', turnNumber: 1 })
    expect(done.status).toBe(200)
    // Setup is over: the tab is gone and a setup request is refused
    expect((await view(t.gameId, t.starter)).you?.setup).toBeNull()
    expect((await post(t.starter, setupUrl(t.gameId), { step: 'trade', undo: true })).status).toBe(400)
  })

  it('does not hold the other player back for the starter\'s setup', async () => {
    const t = await table('set-gate-other')
    const refused = await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'SOT', turnNumber: 1 })
    expect(refused.status).toBe(409)
    // The other player has no setup, so the gate does not apply to them
    const other = await post(t.other, `/api/games/${t.gameId}/turns/done`, { phase: 'SOT', turnNumber: 1 })
    expect(other.status).toBe(200)
  })
})

/** Every step of the starter's setup but the last click: capital, both figures, the trade and the policy. */
async function completeSetup(t: Awaited<ReturnType<typeof table>>): Promise<void> {
  let v = await view(t.gameId, t.starter)
  v = await (await post(t.starter, setupUrl(t.gameId), { ...firstCapital(v), rev: v.rev })).json<View>()
  for (const figure of ['army', 'scout']) {
    const square = stepOf(v, 'figures').items.find((item) => item.id === figure)?.squares[0]
    if (square === undefined) throw new Error(`no ${figure} square`)
    v = await (await post(t.starter, setupUrl(t.gameId), { step: 'figure', figure, column: square.column, row: square.row })).json<View>()
  }
  await post(t.starter, setupUrl(t.gameId), { step: 'trade' })
  const policy = (await repo.findGame(t.gameId))?.socialPolicies[0]?.name
  expect((await post(t.starter, `/api/games/${t.gameId}/socialpolicy/choose`, { name: policy })).status).toBe(200)
}

describe('Finish setup and passing the turn on (#374)', () => {
  it('refuses Finish setup while a step is missing, with the gate reason, and writes no line', async () => {
    const t = await table('set-finish-refused')
    const v = await view(t.gameId, t.starter)
    const refused = await post(t.starter, setupUrl(t.gameId), { step: 'finish', rev: v.rev })
    expect(refused.status).toBe(400)
    const body = await refused.json<{ error: string; message: string }>()
    expect(body.error).toBe('SETUP_REFUSED')
    expect(body.message).toContain(v.you?.setup?.blocksTurn ?? 'no reason')
    const after = await view(t.gameId, t.starter)
    expect(after.rev).toBe(v.rev)
    expect(after.log.some((entry) => entry.publicLog.includes('finished setup'))).toBe(false)
  })

  it('finishes once the steps are done: one line, the tab gone, and a repeat changes nothing', async () => {
    const t = await table('set-finish')
    await completeSetup(t)
    const before = await view(t.gameId, t.starter)
    expect(before.you?.setup?.blocksTurn).toBeNull()
    const finished = await post(t.starter, setupUrl(t.gameId), { step: 'finish', rev: before.rev, requestId: 'fin-1' })
    expect(finished.status).toBe(200)
    const v = await finished.json<View>()
    expect(v.you?.setup).toBeNull()
    expect(v.log.filter((entry) => entry.publicLog.endsWith('finished setup'))).toHaveLength(1)
    const again = await post(t.starter, setupUrl(t.gameId), { step: 'finish', rev: v.rev, requestId: 'fin-1' })
    expect(again.status).toBe(200)
    expect((await again.json<View>()).rev).toBe(v.rev)
    // Start of Turn done follows and writes no second line
    expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'SOT', turnNumber: 1 })).status).toBe(200)
    const end = await view(t.gameId, t.starter)
    expect(end.log.filter((entry) => entry.publicLog.endsWith('finished setup'))).toHaveLength(1)
  })

  it('passes the turn on: public line, steps still doable, idempotent, the other player sees the setup stage', async () => {
    const t = await table('set-pass')
    const v = await view(t.gameId, t.starter)
    const passed = await post(t.starter, setupUrl(t.gameId), { step: 'pass', rev: v.rev, requestId: 'pass-1' })
    expect(passed.status).toBe(200)
    const own = await passed.json<View>()
    expect(own.you?.setup?.passed).toBe(true)
    expect(own.log.filter((entry) => entry.publicLog.endsWith('passed the turn on in setup'))).toHaveLength(1)
    // Steps stay doable
    expect((await post(t.starter, setupUrl(t.gameId), firstCapital(own))).status).toBe(200)
    // A repeat is the same revision and no second line
    const latest = await view(t.gameId, t.starter)
    const again = await post(t.starter, setupUrl(t.gameId), { step: 'pass', rev: latest.rev })
    expect((await again.json<View>()).rev).toBe(latest.rev)
    expect(latest.log.filter((entry) => entry.publicLog.endsWith('passed the turn on in setup'))).toHaveLength(1)

    // The other player: holder in the setup stage, the pass only as a public line, nothing of the setup record
    const theirs = await view(t.gameId, t.other)
    expect(theirs.activeTurn).toMatchObject({ stage: 'setup' })
    expect(theirs.you?.setup).toBeNull()
    expect(theirs.log.some((entry) => entry.publicLog.endsWith('passed the turn on in setup'))).toBe(true)
    expect(JSON.stringify(theirs.opponents)).not.toContain('passed')
    // Start of Turn is still closed to the starter
    expect((await post(t.starter, `/api/games/${t.gameId}/turns/done`, { phase: 'SOT', turnNumber: 1 })).status).toBe(409)
  })

  it('refuses a pass without a setup, and takes no fields beyond the step', async () => {
    const t = await table('set-pass-refused')
    const none = await post(t.other, setupUrl(t.gameId), { step: 'pass' })
    expect(none.status).toBe(400)
    expect(await none.json()).toMatchObject({ error: 'SETUP_REFUSED' })
    for (const body of [
      { step: 'pass', column: 1, row: 1 },
      { step: 'finish', figure: 'army' },
      { step: 'finish', undo: true },
      { step: 'pass', undo: true },
      { step: 'pass', direction: 'east' },
    ]) {
      const response = await post(t.starter, setupUrl(t.gameId), body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(await response.json()).toMatchObject({ error: 'BAD_REQUEST' })
    }
  })
})

describe('undoing the reveal while setup stands', () => {
  it('answers 409 CIV_REVEAL_SETUP_STARTED', async () => {
    const t = await table('set-reveal')
    let v = await view(t.gameId, t.starter)
    v = await (await post(t.starter, setupUrl(t.gameId), { ...firstCapital(v), rev: v.rev })).json<View>()
    const game = await repo.findGame(t.gameId)
    const reveal = game?.log.find((entry) => entry.logType === 'REVEAL' && entry.item?.kind === 'civ')
    if (reveal === undefined) throw new Error('no reveal line')
    const response = await post(t.starter, `/api/games/${t.gameId}/undo/${reveal.id}`, {})
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'CIV_REVEAL_SETUP_STARTED' })
  })
})

describe('the American great person through /actions', () => {
  const draw = (token: string, gameId: string, body: Record<string, unknown> = {}) =>
    post(token, `/api/games/${gameId}/actions`, { action: 'setupGreatPerson', requestId: 'gp-1', ...body })

  it('is refused until the policy is chosen and revealed, then draws a great person that the other player cannot name', async () => {
    const t = await table('set-gp', 'Americans')
    const early = await draw(t.starter, t.gameId)
    expect(early.status).toBe(400)
    expect(JSON.stringify(await early.json())).toContain('Choose your social policy first')

    // Pacifism, not the first of the shuffled policies: a revealed Organized Religion would draw two cards and leave a choice
    const policy = 'Pacifism'
    await post(t.starter, `/api/games/${t.gameId}/socialpolicy/choose`, { name: policy })
    const hidden = await draw(t.starter, t.gameId)
    expect(hidden.status).toBe(400)
    expect(JSON.stringify(await hidden.json())).toContain('Reveal your social policy first')
    await post(t.starter, `/api/games/${t.gameId}/socialpolicies/reveal`, { name: policy })

    // No payload belongs to it
    expect((await draw(t.starter, t.gameId, { args: {} })).status).toBe(400)
    const drawn = await draw(t.starter, t.gameId)
    expect(drawn.status).toBe(200)
    const mine = await drawn.json<View>()
    expect(stepOf(mine, 'greatPerson').status).toBe('done')

    const game = await repo.findGame(t.gameId)
    const held = game?.players.find((player) => player.playerId === t.starterId)?.items.filter((item) => item.kind === 'greatperson') ?? []
    expect(held).toHaveLength(1)
    const name = 'name' in (held[0] ?? {}) ? (held[0] as { name: string }).name : ''
    expect(name).not.toBe('')
    const theirs = await view(t.gameId, t.other)
    const { you, ...rest } = theirs as unknown as { you: Record<string, unknown> | null } & Record<string, unknown>
    const { availableActions: _buttons, playableCards: _playable, ...yours } = you ?? {}
    expect(JSON.stringify({ ...rest, you: yours })).not.toContain(name)
    // Once only
    expect((await draw(t.starter, t.gameId, { requestId: 'gp-2' })).status).toBe(409)
  })
})
