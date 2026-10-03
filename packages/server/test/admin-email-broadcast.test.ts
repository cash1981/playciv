/**
 * The admin email broadcast (issue #92). Ports the old, unreachable
 * `GameAction.sendMailToAll` — one personalised mail per account with an
 * address — as an admin-only route whose Markdown body is rendered to HTML.
 *
 * No provider is contacted: a `FakeMailer` records every send.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import { MailError } from '../src/mail.js'
import {
  BROADCAST_BATCH_SIZE,
  BROADCAST_PAUSE_MS,
  BROADCAST_REQUEST_BUDGET,
  BROADCAST_TIME_BUDGET_MS,
  createNotifications,
} from '../src/notifications.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import { bearer, inject } from './helpers.js'

class FakeMailer implements Mailer {
  readonly sent: OutgoingEmail[] = []
  fail = false

  async send(email: OutgoingEmail): Promise<void> {
    if (this.fail) throw new Error('provider is down')
    this.sent.push(email)
  }
}

let app: App
let repo: JsonFileRepository
let mailer: FakeMailer

beforeEach(async () => {
  mailer = new FakeMailer()
  const created = await createTestApp({ mailer, appOrigin: 'https://playciv.app' })
  app = created.app
  repo = created.repo
})

async function register(
  username: string,
  email: string | null = `${username}@example.com`,
): Promise<{ id: string; token: string }> {
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      username,
      password: 'secret',
      email,
      // Issue #40: register now requires the old security answer.
      securityAnswer: 'writing',
    },
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { token: string; player: { id: string } }
  return { id: body.player.id, token: body.token }
}

async function makeAdmin(username: string): Promise<{ id: string; token: string }> {
  const account = await register(username)
  await repo.updatePlayer(account.id, { role: 'admin' })
  return account
}

/** The unauthenticated unsubscribe link, exactly as a mail triggers it. */
async function unsubscribe(playerId: string): Promise<void> {
  const response = await inject(app, {
    method: 'GET',
    url: `/api/admin/email/notification/${playerId}/stop`,
  })
  expect(response.status).toBe(200)
}

const broadcast = (token: string, payload: Record<string, unknown>) =>
  inject(app, {
    method: 'POST',
    url: '/api/admin/email/broadcast',
    headers: bearer(token),
    payload,
  })

describe('admin email broadcast', () => {
  it('mails only opted-in accounts, with the greeting, HTML, fallback and link', async () => {
    const admin = await makeAdmin('broadcast-admin')
    const optedIn = await register('opted-in')
    const optedOut = await register('opted-out')
    await unsubscribe(optedOut.id)
    await register('no-address', null)

    const response = await broadcast(admin.token, {
      subject: 'Message from cash at playciv.app',
      markdown: '**Bold** news',
    })
    expect(response.status).toBe(200)
    // The admin and the opted-in account are sent to; the unsubscribed and the
    // address-less account are not.
    expect(await response.json()).toEqual({
      sent: 2,
      sentTo: expect.arrayContaining(['broadcast-admin@example.com', 'opted-in@example.com']),
      skipped: { noAddress: 1, unsubscribed: 1, excluded: 0 },
      failed: [],
      deferred: 0,
      stopReason: null,
    })

    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'broadcast-admin@example.com',
      'opted-in@example.com',
    ])

    const mail = mailer.sent.find((candidate) => candidate.to === 'opted-in@example.com')
    expect(mail?.subject).toBe('Message from cash at playciv.app')
    // Plain-text fallback keeps the Markdown source, after Java's single
    // newline greeting.
    expect(mail?.text).toContain('Hello opted-in\n**Bold** news')
    expect(mail?.text).toContain(`/api/admin/email/notification/${optedIn.id}/stop`)
    // HTML body renders the Markdown and carries a clickable unsubscribe link.
    expect(mail?.html).toContain('<p>Hello opted-in</p>')
    expect(mail?.html).toContain('<strong>Bold</strong>')
    expect(mail?.html).toContain(
      `<a href="https://playciv.app/api/admin/email/notification/${optedIn.id}/stop">`,
    )
  })

  it('also reaches unsubscribed players when the admin asks for it', async () => {
    const admin = await makeAdmin('include-admin')
    const optedOut = await register('include-opted-out')
    await unsubscribe(optedOut.id)

    const response = await broadcast(admin.token, {
      subject: 'Everyone',
      markdown: 'Hello everyone',
      includeUnsubscribed: true,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      sent: 2,
      sentTo: expect.arrayContaining(['include-admin@example.com', 'include-opted-out@example.com']),
      skipped: { noAddress: 0, unsubscribed: 0, excluded: 0 },
      failed: [],
      deferred: 0,
      stopReason: null,
    })
    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'include-admin@example.com',
      'include-opted-out@example.com',
    ])
  })

  it('escapes a username that contains HTML in the greeting', async () => {
    const admin = await makeAdmin('escape-admin')
    await register('<b>evil</b>', 'evil@example.com')

    const response = await broadcast(admin.token, {
      subject: 'Hi',
      markdown: 'plain',
      includeUnsubscribed: true,
    })
    expect(response.status).toBe(200)

    const mail = mailer.sent.find((candidate) => candidate.to === 'evil@example.com')
    expect(mail?.html).toContain('<p>Hello &lt;b&gt;evil&lt;/b&gt;</p>')
    expect(mail?.html).not.toContain('<p>Hello <b>evil</b></p>')
  })

  it('does not throw when sending fails, and says why instead of counting a skip', async () => {
    const admin = await makeAdmin('failure-admin')
    await register('failure-other')

    mailer.fail = true
    const response = await broadcast(admin.token, {
      subject: 'Anyone there?',
      markdown: 'Still here',
    })
    mailer.fail = false

    expect(response.status).toBe(200)
    // Both accounts were eligible, but nothing went out: the provider could not
    // be reached, so the run stopped and both are left for a rerun.
    const result = (await response.json()) as { stopReason: string }
    expect(result).toMatchObject({
      sent: 0,
      sentTo: [],
      skipped: { noAddress: 0, unsubscribed: 0, excluded: 0 },
      failed: [],
      deferred: 2,
    })
    expect(result.stopReason).toContain('provider is down')
  })

  it('answers 403 for a non-admin', async () => {
    const user = await register('not-an-admin')
    const response = await broadcast(user.token, { subject: 'Hi', markdown: 'there' })
    expect(response.status).toBe(403)
    expect(mailer.sent).toHaveLength(0)
  })

  it('answers 400 when subject or markdown is missing or blank', async () => {
    const admin = await makeAdmin('validation-admin')

    const noSubject = await broadcast(admin.token, { markdown: 'body' })
    expect(noSubject.status).toBe(400)
    const blankSubject = await broadcast(admin.token, { subject: '   ', markdown: 'body' })
    expect(blankSubject.status).toBe(400)
    const noMarkdown = await broadcast(admin.token, { subject: 'subject' })
    expect(noMarkdown.status).toBe(400)
    const blankMarkdown = await broadcast(admin.token, { subject: 'subject', markdown: ' ' })
    expect(blankMarkdown.status).toBe(400)
    expect(mailer.sent).toHaveLength(0)
  })

  it('answers 400 when includeUnsubscribed is not a boolean', async () => {
    const admin = await makeAdmin('boolean-admin')
    const response = await broadcast(admin.token, {
      subject: 'subject',
      markdown: 'body',
      includeUnsubscribed: 'yes',
    })
    expect(response.status).toBe(400)
  })

  it('answers 400 when exclude is not an array of strings, or is too long', async () => {
    const admin = await makeAdmin('exclude-admin')
    for (const exclude of ['a@b.c', [1, 2], ['a@b.c', null], new Array(5001).fill('a@b.c')]) {
      const response = await broadcast(admin.token, { subject: 's', markdown: 'b', exclude })
      expect(response.status).toBe(400)
    }
    expect(mailer.sent).toHaveLength(0)
  })

  it('answers 400 when limit is not an integer from 1 to 5000', async () => {
    const admin = await makeAdmin('limit-admin')
    for (const limit of [0, -1, 1.5, '10', 5001, null]) {
      const response = await broadcast(admin.token, { subject: 's', markdown: 'b', limit })
      expect(response.status).toBe(400)
    }
    expect(mailer.sent).toHaveLength(0)
  })

  it('passes exclude and limit on to the broadcast', async () => {
    const admin = await makeAdmin('options-admin')
    await register('options-one')
    await register('options-two')

    const response = await broadcast(admin.token, {
      subject: 's',
      markdown: 'b',
      exclude: [' OPTIONS-ONE@example.com '],
      limit: 1,
    })
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      sent: number
      skipped: { excluded: number }
      deferred: number
    }
    expect(result.skipped.excluded).toBe(1)
    expect(result.sent).toBe(1)
    expect(result.deferred).toBe(1)
    expect(mailer.sent.map((mail) => mail.to)).not.toContain('options-one@example.com')
  })
})

/** A mailer with a batch endpoint; `rejects` decides what a request answers. */
class BatchMailer implements Mailer {
  readonly requests: OutgoingEmail[][] = []
  readonly singles: OutgoingEmail[] = []
  rejects: (emails: readonly OutgoingEmail[]) => Error | undefined = () => undefined

  async send(email: OutgoingEmail): Promise<void> {
    this.singles.push(email)
  }

  async sendBatch(emails: readonly OutgoingEmail[]): Promise<void> {
    const error = this.rejects(emails)
    // A rejected request records nothing, like Resend.
    if (error !== undefined) throw error
    this.requests.push([...emails])
  }

  addresses(): string[] {
    return this.requests.flat().map((mail) => mail.to)
  }
}

/** Notifications over an in-memory repository holding `count` plain accounts. */
async function accounts(
  count: number,
  mailer: Mailer,
  tweak: (index: number) => { email?: string | null; disableEmail?: boolean; username?: string } = () => ({}),
  extra: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {},
) {
  const memory = new JsonFileRepository({ filePath: null })
  for (let index = 0; index < count; index += 1) {
    const changes = tweak(index)
    await memory.createPlayer({
      id: `p${index}`,
      username: changes.username ?? `user${index}`,
      email: changes.email === undefined ? `user${index}@example.com` : changes.email,
      passwordHash: 'x',
      createdAt: '2026-10-03T00:00:00.000Z',
      ...(changes.disableEmail === undefined ? {} : { disableEmail: changes.disableEmail }),
    })
  }
  return createNotifications({
    repo: memory,
    mailer,
    appOrigin: 'https://playciv.app',
    // Tests must not wait out the pause between provider requests.
    sleep: async () => undefined,
    ...extra,
  })
}

const message = { subject: 'News', markdown: 'Hello **all**', includeUnsubscribed: false }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('admin email broadcast: batching', () => {
  it('sends 555 accounts in six provider requests of at most 100', async () => {
    const batch = new BatchMailer()
    const notifications = await accounts(555, batch)

    const result = await notifications.broadcast(message)

    expect(batch.requests.length).toBeLessThanOrEqual(6)
    expect(batch.requests.length).toBeLessThanOrEqual(BROADCAST_REQUEST_BUDGET)
    for (const request of batch.requests) {
      expect(request.length).toBeLessThanOrEqual(BROADCAST_BATCH_SIZE)
    }
    expect(batch.singles).toHaveLength(0)
    expect(result.sent).toBe(555)
    expect(result.sentTo).toHaveLength(555)
    expect(new Set(batch.addresses()).size).toBe(555)
    expect(result).toMatchObject({ deferred: 0, stopReason: null, failed: [] })
  })

  it('falls back to one send per recipient when the mailer has no sendBatch', async () => {
    const plain = new FakeMailer()
    const notifications = await accounts(5, plain)

    const result = await notifications.broadcast(message)

    expect(plain.sent).toHaveLength(5)
    expect(result.sent).toBe(5)
    expect(result.deferred).toBe(0)
  })

  it('leaves out excluded addresses, ignoring case and padding, and never lists them as sent', async () => {
    const batch = new BatchMailer()
    const notifications = await accounts(4, batch)

    const result = await notifications.broadcast({
      ...message,
      exclude: ['  USER1@Example.com', 'user3@example.com\n', 'nobody@example.com'],
    })

    expect(result.skipped.excluded).toBe(2)
    expect(result.sent).toBe(2)
    expect(batch.addresses().sort()).toEqual(['user0@example.com', 'user2@example.com'])
    expect(result.sentTo).not.toContain('user1@example.com')
    expect(result.sentTo).not.toContain('user3@example.com')
  })

  it('stops after the limit and counts the rest as deferred, in account order', async () => {
    const batch = new BatchMailer()
    const notifications = await accounts(10, batch)

    const result = await notifications.broadcast({ ...message, limit: 3 })

    expect(result.sent).toBe(3)
    expect(result.deferred).toBe(7)
    expect(result.sentTo).toEqual([
      'user0@example.com',
      'user1@example.com',
      'user2@example.com',
    ])
    expect(result.stopReason).toBeNull()
  })

  it('finds one bad address by splitting the batch, within the request budget', async () => {
    const batch = new BatchMailer()
    const bad = 'user37@example.com'
    batch.rejects = (emails) =>
      emails.some((mail) => mail.to === bad)
        ? new MailError(
            'Resend rejected the email batch (422)',
            422,
            JSON.stringify({ statusCode: 422, message: 'Invalid `to` field.' }),
          )
        : undefined
    const attempts = vi.spyOn(batch, 'sendBatch')
    const notifications = await accounts(100, batch)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await notifications.broadcast(message)
    errors.mockRestore()

    expect(result.sent).toBe(99)
    expect(result.sentTo).not.toContain(bad)
    expect(new Set(batch.addresses()).size).toBe(99)
    expect(result.failed).toEqual([{ email: bad, reason: 'Invalid `to` field.' }])
    expect(result.deferred).toBe(0)
    expect(result.stopReason).toBeNull()
    // One request for the batch, then two per level of the split (100 -> 1).
    expect(attempts.mock.calls.length).toBeLessThanOrEqual(16)
  })

  it('stops with a reason when splitting runs out of request budget', async () => {
    const batch = new BatchMailer()
    // Every address is bad, so every request fails and every split spends budget.
    batch.rejects = () => new MailError('Resend rejected the email batch (422)', 422, 'nope')
    const attempts = vi.spyOn(batch, 'sendBatch')
    // A clock that never moves, so only the request budget can stop the run.
    const notifications = await accounts(100, batch, () => ({}), {
      now: () => new Date(Date.UTC(2026, 9, 3)),
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await notifications.broadcast(message)
    errors.mockRestore()

    expect(attempts.mock.calls.length).toBe(BROADCAST_REQUEST_BUDGET)
    expect(result.sent).toBe(0)
    expect(result.stopReason).toContain(String(BROADCAST_REQUEST_BUDGET))
    // Nothing is lost: every account is either failed or deferred.
    expect(result.failed.length + result.deferred).toBe(100)
    expect(result.deferred).toBeGreaterThan(0)
  })

  it('reports an invalid-looking address as failed without calling the provider for it', async () => {
    const batch = new BatchMailer()
    const notifications = await accounts(3, batch, (index) =>
      index === 1 ? { email: 'not-an-address' } : {},
    )
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await notifications.broadcast(message)
    errors.mockRestore()

    expect(result.failed).toEqual([{ email: 'not-an-address', reason: 'Not a valid email address' }])
    expect(batch.addresses()).not.toContain('not-an-address')
    expect(result.sent).toBe(2)
    expect(batch.requests).toHaveLength(1)
  })

  it('stops on a 429 with the provider message and defers everything unsent', async () => {
    const batch = new BatchMailer()
    let calls = 0
    batch.rejects = () => {
      calls += 1
      return calls === 2
        ? new MailError(
            'Resend rejected the email batch (429)',
            429,
            JSON.stringify({ message: 'Daily email quota exceeded' }),
          )
        : undefined
    }
    const notifications = await accounts(250, batch)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await notifications.broadcast(message)
    errors.mockRestore()

    // The first batch of 100 went out; the second was refused and the third never tried.
    expect(result.sent).toBe(100)
    expect(result.deferred).toBe(150)
    expect(result.stopReason).toContain('Daily email quota exceeded')
    expect(calls).toBe(2)
  })

  it('stops on a thrown network error without throwing out of broadcast', async () => {
    const batch = new BatchMailer()
    batch.rejects = () => new TypeError('fetch failed')
    const notifications = await accounts(3, batch)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await notifications.broadcast(message)

    expect(result.sent).toBe(0)
    expect(result.deferred).toBe(3)
    expect(result.stopReason).toContain('fetch failed')
    // A timeout may have been accepted anyway; the reason must say so.
    expect(result.stopReason).toContain('may still have been accepted')
    // The message is in the logged string itself, not a second argument.
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('fetch failed'))
  })

  it('stops on a 5xx answer and defers the rest', async () => {
    const batch = new BatchMailer()
    batch.rejects = () => new MailError('Resend rejected the email batch (503)', 503, 'unavailable')
    const notifications = await accounts(3, batch)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await notifications.broadcast(message)
    errors.mockRestore()

    expect(result.sent).toBe(0)
    expect(result.deferred).toBe(3)
    expect(result.stopReason).toContain('503')
  })

  it('counts no-address and unsubscribed accounts apart, and includes the latter on request', async () => {
    const batch = new BatchMailer()
    const notifications = await accounts(4, batch, (index) => {
      if (index === 0) return { email: null }
      if (index === 1) return { email: '' }
      if (index === 2) return { disableEmail: true }
      return {}
    })

    const normal = await notifications.broadcast(message)
    expect(normal.skipped).toEqual({ noAddress: 2, unsubscribed: 1, excluded: 0 })
    expect(normal.sent).toBe(1)

    const everyone = await notifications.broadcast({ ...message, includeUnsubscribed: true })
    expect(everyone.skipped).toEqual({ noAddress: 2, unsubscribed: 0, excluded: 0 })
    expect(everyone.sent).toBe(2)
  })

  it('personalises every mail in a batch and escapes the greeting', async () => {
    const batch = new BatchMailer()
    const notifications = await accounts(3, batch, (index) =>
      index === 1 ? { username: '<b>evil</b>' } : {},
    )

    await notifications.broadcast(message)

    const mails = batch.requests.flat()
    expect(mails).toHaveLength(3)
    for (const [index, mail] of mails.entries()) {
      expect(mail.text).toContain(`/api/admin/email/notification/p${index}/stop`)
      expect(mail.html).toContain(`/api/admin/email/notification/p${index}/stop`)
      expect(mail.html).toContain('<strong>all</strong>')
    }
    expect(mails[0]?.text).toContain('Hello user0\nHello **all**')
    expect(mails[1]?.html).toContain('<p>Hello &lt;b&gt;evil&lt;/b&gt;</p>')
  })

  it('stops on a 401 without splitting, counting nobody as failed', async () => {
    const batch = new BatchMailer()
    batch.rejects = () =>
      new MailError('Resend rejected the email batch (401)', 401, '{"message":"API key is invalid"}')
    const attempts = vi.spyOn(batch, 'sendBatch')
    const notifications = await accounts(250, batch)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await notifications.broadcast(message)

    // About the request, not one message: splitting would only burn the budget.
    expect(attempts).toHaveBeenCalledTimes(1)
    expect(result.failed).toEqual([])
    expect(result.sent).toBe(0)
    expect(result.deferred).toBe(250)
    expect(result.stopReason).toContain('401')
    expect(result.stopReason).toContain('API key is invalid')
  })

  it('waits between provider requests, but not before the first', async () => {
    const batch = new BatchMailer()
    const events: string[] = []
    const send = batch.sendBatch.bind(batch)
    batch.sendBatch = async (emails) => {
      events.push('request')
      await send(emails)
    }
    const notifications = await accounts(250, batch, () => ({}), {
      sleep: async (ms) => {
        events.push(`pause ${ms}`)
      },
    })

    const result = await notifications.broadcast(message)

    expect(result.sent).toBe(250)
    expect(events).toEqual([
      'request',
      `pause ${BROADCAST_PAUSE_MS}`,
      'request',
      `pause ${BROADCAST_PAUSE_MS}`,
      'request',
    ])
  })

  it('stops when the wall-clock budget is used up and defers the rest', async () => {
    const batch = new BatchMailer()
    // A fake clock that only moves when the broadcast pauses, 20 s at a time.
    let elapsed = 0
    const notifications = await accounts(500, batch, () => ({}), {
      now: () => new Date(Date.UTC(2026, 9, 3) + elapsed),
      sleep: async () => {
        elapsed += 20_000
      },
    })

    const result = await notifications.broadcast(message)

    // Requests start at 0 s, 20 s and 40 s; the fourth would start at 60 s.
    expect(BROADCAST_TIME_BUDGET_MS).toBe(45_000)
    expect(batch.requests).toHaveLength(3)
    expect(result.sent).toBe(300)
    expect(result.deferred).toBe(200)
    expect(result.stopReason).toContain('45 seconds')
  })
})
