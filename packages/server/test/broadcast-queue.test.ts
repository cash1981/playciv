/**
 * The admin broadcast queue: one message sent over several days by the daily
 * job. No provider is contacted; mailers are fakes. Storage is covered in
 * `broadcast-queue-repository.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import { MailError } from '../src/mail.js'
import { RELEASE_COOLDOWN_MS, createNotifications, runDailyBroadcast } from '../src/notifications.js'
import type { Notifications } from '../src/notifications.js'
import { D1Repository } from '../src/store/d1.js'
import { JsonFileRepository } from '../src/store/json-file.js'
import type { Repository } from '../src/store/types.js'
import { createD1Adapter } from './d1-sqlite-adapter.js'
import { bearer, inject } from './helpers.js'
import { readMigrations } from './migrations.js'

class BatchMailer implements Mailer {
  readonly requests: OutgoingEmail[][] = []
  rejects: (emails: readonly OutgoingEmail[]) => Error | undefined = () => undefined

  async send(): Promise<void> {
    throw new Error('the queue must use sendBatch')
  }

  async sendBatch(emails: readonly OutgoingEmail[]): Promise<void> {
    const error = this.rejects(emails)
    if (error !== undefined) throw error
    this.requests.push([...emails])
  }

  addresses(): string[] {
    return this.requests.flat().map((mail) => mail.to)
  }
}

const NOW = new Date('2026-10-04T17:00:00.000Z')
const message = { subject: 'News', markdown: 'Hello **all**', includeUnsubscribed: false, perRun: 50 }

async function seed(
  repo: Repository,
  count: number,
  tweak: (index: number) => { email?: string | null; disableEmail?: boolean; username?: string } = () => ({}),
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const changes = tweak(index)
    await repo.createPlayer({
      id: `p${String(index).padStart(3, '0')}`,
      username: changes.username ?? `user${index}`,
      email: changes.email === undefined ? `user${index}@example.com` : changes.email,
      passwordHash: 'x',
      createdAt: '2026-10-03T00:00:00.000Z',
      ...(changes.disableEmail === undefined ? {} : { disableEmail: changes.disableEmail }),
    })
  }
}

function notificationsFor(
  repo: Repository,
  mailer: Mailer,
  now: () => Date = () => new Date(),
): Notifications {
  return createNotifications({
    repo,
    mailer,
    appOrigin: 'https://playciv.app',
    sleep: async () => undefined,
    now,
  })
}

let repo: JsonFileRepository
let mailer: BatchMailer

beforeEach(() => {
  repo = new JsonFileRepository({ filePath: null })
  mailer = new BatchMailer()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('queueBroadcast', () => {
  it('classifies like the direct broadcast and queues only the eligible accounts', async () => {
    await seed(repo, 6, (index) => {
      if (index === 0) return { email: null }
      if (index === 1) return { disableEmail: true }
      if (index === 3) return { email: 'not-an-address' }
      return {}
    })
    const notifications = notificationsFor(repo, mailer)

    const result = await notifications.queueBroadcast({
      ...message,
      exclude: [' USER2@example.com '],
    })

    expect(result).toMatchObject({
      ok: true,
      skipped: { noAddress: 1, unsubscribed: 1, excluded: 1 },
      rejected: [{ email: 'not-an-address', reason: 'Not a valid email address' }],
    })
    if (!result.ok) return
    expect(result.queue.counts).toEqual({ pending: 2, sending: 0, sent: 0, failed: 0 })
    expect(result.queue.status).toBe('active')
    expect(mailer.requests).toHaveLength(0)
  })

  it('queues the 506 accounts left after 49 were mailed', async () => {
    await seed(repo, 555)
    const alreadyMailed = Array.from({ length: 49 }, (_, index) => `user${index}@example.com`)

    const result = await notificationsFor(repo, mailer).queueBroadcast({
      ...message,
      exclude: alreadyMailed,
    })

    expect(result.ok && result.queue.counts.pending).toBe(506)
    expect(result.ok && result.skipped.excluded).toBe(49)
  })

  it('queues unsubscribed accounts when the admin asks for it', async () => {
    await seed(repo, 3, (index) => (index === 0 ? { disableEmail: true } : {}))

    const result = await notificationsFor(repo, mailer).queueBroadcast({
      ...message,
      includeUnsubscribed: true,
    })

    expect(result.ok && result.queue.counts.pending).toBe(3)
  })

  it('refuses a second queue while one is active', async () => {
    await seed(repo, 3)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    expect(await notifications.queueBroadcast(message)).toEqual({
      ok: false,
      reason: 'ALREADY_ACTIVE',
    })
  })

  it('refuses a queue with nobody to send to', async () => {
    await seed(repo, 2, () => ({ email: null }))

    expect(await notificationsFor(repo, mailer).queueBroadcast(message)).toEqual({
      ok: false,
      reason: 'NO_RECIPIENTS',
    })
  })
})

describe('runQueuedBroadcast', () => {
  it('sends a run of 50 in one provider request and leaves the rest pending', async () => {
    await seed(repo, 120)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    const run = await notifications.runQueuedBroadcast(NOW)

    expect(mailer.requests).toHaveLength(1)
    expect(mailer.requests[0]).toHaveLength(50)
    expect(run).toEqual({
      ran: true,
      sent: 50,
      failed: 0,
      released: 0,
      indeterminate: 0,
      stopReason: null,
      finished: false,
    })
    const status = await notifications.queuedBroadcastStatus()
    expect(status?.counts).toEqual({ pending: 70, sending: 0, sent: 50, failed: 0 })
    expect(status?.status).toBe('active')
    expect(status?.lastRunAt).toBe(NOW.toISOString())
    // The first 50 accounts, in order.
    expect(mailer.addresses()[0]).toBe('user0@example.com')
    expect(mailer.addresses()[49]).toBe('user49@example.com')
  })

  it('works through the whole queue over several runs without mailing anyone twice', async () => {
    await seed(repo, 120)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    const runs = [
      await notifications.runQueuedBroadcast(NOW),
      await notifications.runQueuedBroadcast(NOW),
      await notifications.runQueuedBroadcast(NOW),
    ]

    expect(runs.map((run) => run.sent)).toEqual([50, 50, 20])
    expect(runs.map((run) => run.finished)).toEqual([false, false, true])
    expect(new Set(mailer.addresses()).size).toBe(120)
    expect((await notifications.queuedBroadcastStatus())?.status).toBe('done')
    // Finished: the next scheduled run does nothing.
    expect((await notifications.runQueuedBroadcast(NOW)).ran).toBe(false)
    expect(mailer.requests).toHaveLength(3)
  })

  it('finishes the broadcast when fewer than a full run are left', async () => {
    await seed(repo, 7)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    const run = await notifications.runQueuedBroadcast(NOW)

    expect(run).toMatchObject({ sent: 7, finished: true })
    expect((await notifications.queuedBroadcastStatus())?.status).toBe('done')
  })

  it('stops on a 429 and puts the unsent rows back to pending', async () => {
    await seed(repo, 60)
    mailer.rejects = () =>
      new MailError(
        'Resend rejected the email batch (429)',
        429,
        JSON.stringify({ message: 'Daily email quota exceeded' }),
      )
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    const run = await notifications.runQueuedBroadcast(NOW)

    expect(run).toMatchObject({ ran: true, sent: 0, released: 50, finished: false })
    expect(run.stopReason).toContain('Daily email quota exceeded')
    const status = await notifications.queuedBroadcastStatus()
    expect(status?.counts).toEqual({ pending: 60, sending: 0, sent: 0, failed: 0 })
    expect(status?.status).toBe('active')

    // Tomorrow the quota is back and the same 50 go out.
    mailer.rejects = () => undefined
    expect((await notifications.runQueuedBroadcast(NOW)).sent).toBe(50)
  })

  it('records a bad address as failed with the provider message and sends the rest', async () => {
    await seed(repo, 10)
    const bad = 'user4@example.com'
    mailer.rejects = (emails) =>
      emails.some((mail) => mail.to === bad)
        ? new MailError(
            'Resend rejected the email batch (422)',
            422,
            JSON.stringify({ message: 'Invalid `to` field.' }),
          )
        : undefined
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    const run = await notifications.runQueuedBroadcast(NOW)

    expect(run).toMatchObject({ sent: 9, failed: 1, finished: true })
    const status = await notifications.queuedBroadcastStatus()
    expect(status?.counts).toEqual({ pending: 0, sending: 0, sent: 9, failed: 1 })
    expect(status?.failed).toEqual([{ email: bad, reason: 'Invalid `to` field.' }])
  })

  it('fails, without a mail, a recipient who unsubscribed after the queue was made', async () => {
    await seed(repo, 3)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)
    await repo.updatePlayer('p001', { disableEmail: true })

    const run = await notifications.runQueuedBroadcast(NOW)

    expect(run).toMatchObject({ sent: 2, failed: 1 })
    expect(mailer.addresses()).not.toContain('user1@example.com')
    expect((await notifications.queuedBroadcastStatus())?.failed).toEqual([
      { email: 'user1@example.com', reason: 'unsubscribed since queueing' },
    ])
  })

  it('still sends to one who unsubscribed when the queue includes unsubscribed accounts', async () => {
    await seed(repo, 2)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast({ ...message, includeUnsubscribed: true })
    await repo.updatePlayer('p001', { disableEmail: true })

    const run = await notifications.runQueuedBroadcast(NOW)

    expect(run).toMatchObject({ sent: 2, failed: 0 })
  })

  it('fails a recipient whose account has been deleted', async () => {
    await seed(repo, 2)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)
    await repo.deletePlayer('p000')

    const run = await notifications.runQueuedBroadcast(NOW)

    expect(run).toMatchObject({ sent: 1, failed: 1 })
    expect(mailer.addresses()).toEqual(['user1@example.com'])
  })

  it('uses the current username and a fresh unsubscribe link at send time', async () => {
    await seed(repo, 2)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)
    await repo.updatePlayer('p000', { username: 'Renamed' })

    await notifications.runQueuedBroadcast(NOW)

    const mail = mailer.requests.flat().find((candidate) => candidate.to === 'user0@example.com')
    expect(mail?.text).toContain('Hello Renamed\nHello **all**')
    expect(mail?.html).toContain('<p>Hello Renamed</p>')
    expect(mail?.html).toContain('<strong>all</strong>')
    expect(mail?.text).toContain('/api/admin/email/notification/p000/stop')
  })

  it('never resends a row left in sending, reports it, and keeps the queue open', async () => {
    await seed(repo, 4)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)
    // A crashed run: it claimed two rows and never reported back.
    const broadcast = await repo.currentBroadcast()
    await repo.claimBroadcastRecipients(broadcast?.id ?? '', 2)

    const run = await notifications.runQueuedBroadcast(NOW)

    // The two untouched rows go out; the stuck two do not, and they keep the
    // queue active (Cancel or "release stuck rows" is the way out).
    expect(run).toMatchObject({ sent: 2, finished: false })
    expect(mailer.addresses()).toEqual(['user2@example.com', 'user3@example.com'])
    const status = await notifications.queuedBroadcastStatus()
    expect(status?.status).toBe('active')
    expect(status?.counts.sending).toBe(2)
    expect(status?.stuck).toEqual(['user0@example.com', 'user1@example.com'])

    // Tomorrow's run finds nothing to send and leaves everything as it was.
    const next = await notifications.runQueuedBroadcast(new Date('2026-10-05T17:00:00.000Z'))
    expect(next).toMatchObject({ sent: 0, finished: false })
    expect(mailer.addresses()).toHaveLength(2)
    expect((await notifications.queuedBroadcastStatus())?.lastRunAt).toBe(NOW.toISOString())
  })

  it.each([
    ['a failed fetch', () => new TypeError('fetch failed')],
    [
      'a timeout',
      () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    ],
  ])('leaves the claimed rows in sending after %s, so the next run cannot mail them again', async (_name, makeError) => {
    await seed(repo, 50)
    mailer.rejects = () => makeError()
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    const run = await notifications.runQueuedBroadcast(NOW)

    // No answer arrived, so the mail may have been delivered: nothing is released.
    expect(run).toMatchObject({
      ran: true,
      sent: 0,
      released: 0,
      indeterminate: 50,
      finished: false,
    })
    expect(run.stopReason).toContain('may still have been accepted')
    const status = await notifications.queuedBroadcastStatus()
    expect(status?.counts).toEqual({ pending: 0, sending: 50, sent: 0, failed: 0 })
    expect(status?.stuck).toHaveLength(50)
    expect(status?.status).toBe('active')

    // The provider is fine again the next day; still nobody is mailed.
    mailer.rejects = () => undefined
    const next = await notifications.runQueuedBroadcast(new Date('2026-10-05T17:00:00.000Z'))
    expect(next.sent).toBe(0)
    expect(mailer.requests).toHaveLength(0)
  })

  it('keeps the queue active while any row is still sending, even with nothing pending', async () => {
    await seed(repo, 3)
    mailer.rejects = () => new TypeError('fetch failed')
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    expect((await notifications.runQueuedBroadcast(NOW)).finished).toBe(false)
    expect((await notifications.queuedBroadcastStatus())?.status).toBe('active')
  })

  it('releases stuck rows on request, then sends them and finishes', async () => {
    await seed(repo, 4)
    let clock = NOW
    const notifications = notificationsFor(repo, mailer, () => clock)
    await notifications.queueBroadcast(message)
    const broadcast = await repo.currentBroadcast()
    await repo.claimBroadcastRecipients(broadcast?.id ?? '', 2)
    await notifications.runQueuedBroadcast(NOW)
    clock = new Date(NOW.getTime() + RELEASE_COOLDOWN_MS)

    const released = await notifications.releaseStuckQueuedRecipients()

    expect(released.ok && released.released).toBe(2)
    expect(released.ok && released.queue.counts).toEqual({ pending: 2, sending: 0, sent: 2, failed: 0 })
    expect(released.ok && released.queue.stuck).toEqual([])
    const run = await notifications.runQueuedBroadcast(clock)
    expect(run).toMatchObject({ sent: 2, finished: true })
    expect(new Set(mailer.addresses()).size).toBe(4)
  })

  it('refuses to release while a run may still be sending, and changes nothing', async () => {
    await seed(repo, 4)
    let clock = NOW
    const notifications = notificationsFor(repo, mailer, () => clock)
    await notifications.queueBroadcast(message)
    // A run is in flight: it has claimed its rows and recorded that it started.
    const broadcast = await repo.currentBroadcast()
    await repo.claimBroadcastRecipients(broadcast?.id ?? '', 4)
    await repo.recordBroadcastRun(broadcast?.id ?? '', NOW.toISOString())
    clock = new Date(NOW.getTime() + RELEASE_COOLDOWN_MS - 1)

    expect(await notifications.releaseStuckQueuedRecipients()).toEqual({
      ok: false,
      reason: 'RECENT_RUN',
    })
    expect((await notifications.queuedBroadcastStatus())?.counts).toEqual({
      pending: 0,
      sending: 4,
      sent: 0,
      failed: 0,
    })

    // Once the cooldown has passed the same call works.
    clock = new Date(NOW.getTime() + RELEASE_COOLDOWN_MS)
    const released = await notifications.releaseStuckQueuedRecipients()
    expect(released.ok && released.released).toBe(4)
  })

  it('releases at once a queue whose stuck rows were left by no recent run', async () => {
    await seed(repo, 2)
    const notifications = notificationsFor(repo, mailer, () => NOW)
    await notifications.queueBroadcast(message)
    const broadcast = await repo.currentBroadcast()
    await repo.claimBroadcastRecipients(broadcast?.id ?? '', 2)

    // `lastRunAt` is still null, so there is no run to wait for.
    const released = await notifications.releaseStuckQueuedRecipients()

    expect(released.ok && released.released).toBe(2)
  })

  it('has nothing to release when no queue is active', async () => {
    await seed(repo, 2)
    const notifications = notificationsFor(repo, mailer)
    const none = { ok: false, reason: 'NO_ACTIVE_BROADCAST' }
    expect(await notifications.releaseStuckQueuedRecipients()).toEqual(none)

    await notifications.queueBroadcast(message)
    await notifications.cancelQueuedBroadcast()
    expect(await notifications.releaseStuckQueuedRecipients()).toEqual(none)
  })

  it('does not move the last run time on a day that claimed nothing', async () => {
    await seed(repo, 2)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)
    await notifications.runQueuedBroadcast(NOW)
    await repo.createBroadcast(
      {
        id: 'second',
        subject: 's',
        markdown: 'm',
        includeUnsubscribed: false,
        perRun: 5,
        status: 'active',
        createdAt: '2026-10-05T00:00:00.000Z',
        lastRunAt: null,
      },
      [],
    )

    const run = await notifications.runQueuedBroadcast(new Date('2026-10-06T17:00:00.000Z'))

    expect(run.sent).toBe(0)
    expect((await repo.currentBroadcast())?.lastRunAt).toBeNull()
  })

  it('sends nothing after the queue is cancelled', async () => {
    await seed(repo, 5)
    const notifications = notificationsFor(repo, mailer)
    await notifications.queueBroadcast(message)

    const cancelled = await notifications.cancelQueuedBroadcast()
    const run = await notifications.runQueuedBroadcast(NOW)

    expect(cancelled?.status).toBe('cancelled')
    expect(run.ran).toBe(false)
    expect(mailer.requests).toHaveLength(0)
    expect((await notifications.queuedBroadcastStatus())?.counts.pending).toBe(5)
    // Nothing left to cancel.
    expect(await notifications.cancelQueuedBroadcast()).toBeNull()
  })

  it('does nothing quietly when no queue exists', async () => {
    await seed(repo, 3)
    const notifications = notificationsFor(repo, mailer)

    expect(await notifications.runQueuedBroadcast(NOW)).toMatchObject({ ran: false, sent: 0 })
    expect(await notifications.queuedBroadcastStatus()).toBeNull()
    expect(mailer.requests).toHaveLength(0)
  })

  it('does the same through D1', async () => {
    const adapter = await createD1Adapter(readMigrations())
    try {
      const d1 = new D1Repository(adapter.db)
      await seed(d1, 120)
      const notifications = notificationsFor(d1, mailer)
      await notifications.queueBroadcast(message)

      const first = await notifications.runQueuedBroadcast(NOW)
      await notifications.runQueuedBroadcast(NOW)
      const last = await notifications.runQueuedBroadcast(NOW)

      expect([first.sent, last.sent, last.finished]).toEqual([50, 20, true])
      expect(new Set(mailer.addresses()).size).toBe(120)
    } finally {
      adapter.close()
    }
  })
})

describe('the daily cron', () => {
  it('runs the queue once', async () => {
    const run = vi.fn(async () => ({
      ran: true,
      sent: 3,
      failed: 0,
      released: 0,
      indeterminate: 0,
      stopReason: null,
      finished: true,
    }))

    await runDailyBroadcast({ runQueuedBroadcast: run }, NOW)

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(NOW)
  })

  it('logs a thrown error with its message and swallows it', async () => {
    const run = vi.fn(async () => {
      throw new Error('D1 is unavailable')
    })

    await expect(runDailyBroadcast({ runQueuedBroadcast: run }, NOW)).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('D1 is unavailable'))
  })
})

describe('broadcast queue routes', () => {
  let app: App
  let appRepo: JsonFileRepository
  let sent: OutgoingEmail[]

  beforeEach(async () => {
    sent = []
    const created = await createTestApp({
      mailer: {
        async send(email) {
          sent.push(email)
        },
      },
      appOrigin: 'https://playciv.app',
    })
    app = created.app
    appRepo = created.repo
  })

  async function register(username: string): Promise<{ id: string; token: string }> {
    const response = await inject(app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username,
        password: 'secret',
        email: `${username}@example.com`,
        securityAnswer: 'writing',
      },
    })
    const body = (await response.json()) as { token: string; player: { id: string } }
    return { id: body.player.id, token: body.token }
  }

  async function makeAdmin(username: string): Promise<{ id: string; token: string }> {
    const account = await register(username)
    await appRepo.updatePlayer(account.id, { role: 'admin' })
    return account
  }

  const call = (token: string, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    inject(app, {
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload }),
    })

  const QUEUE = '/api/admin/email/broadcast/queue'

  it('answers 403 to a non-admin on every queue route', async () => {
    const user = await register('queue-user')
    for (const [method, url] of [
      ['POST', QUEUE],
      ['GET', QUEUE],
      ['POST', `${QUEUE}/run`],
      ['POST', `${QUEUE}/cancel`],
      ['POST', `${QUEUE}/release-stuck`],
    ] as const) {
      const response = await call(user.token, method, url, method === 'POST' ? { subject: 's', markdown: 'b' } : undefined)
      expect(response.status).toBe(403)
    }
  })

  it('answers 400 for a bad perRun, exclude, includeUnsubscribed or missing text', async () => {
    const admin = await makeAdmin('queue-validation')
    const bad: Record<string, unknown>[] = [
      { perRun: 0 },
      { perRun: 101 },
      { perRun: 2.5 },
      { perRun: '50' },
      { perRun: null },
      { exclude: 'a@b.c' },
      { exclude: [1] },
      { exclude: new Array(5001).fill('a@b.c') },
      { includeUnsubscribed: 'yes' },
      { subject: ' ' },
    ]
    for (const overrides of bad) {
      const response = await call(admin.token, 'POST', QUEUE, {
        subject: 's',
        markdown: 'b',
        ...overrides,
      })
      expect(response.status).toBe(400)
    }
    expect((await (await call(admin.token, 'GET', QUEUE)).json())).toEqual({ queue: null })
  })

  it('queues with 50 a day by default and answers the status', async () => {
    const admin = await makeAdmin('queue-admin')
    await register('queue-other')

    const response = await call(admin.token, 'POST', QUEUE, { subject: 'Hi', markdown: 'There' })

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      queue: { perRun: number; status: string; counts: { pending: number } }
      skipped: { excluded: number }
    }
    expect(body.queue).toMatchObject({ perRun: 50, status: 'active', counts: { pending: 2 } })
    expect(sent).toHaveLength(0)

    const status = (await (await call(admin.token, 'GET', QUEUE)).json()) as { queue: { id: string } }
    expect(status.queue.id).toBeTruthy()
  })

  it('answers 409 to a second queue', async () => {
    const admin = await makeAdmin('queue-twice')
    await call(admin.token, 'POST', QUEUE, { subject: 'Hi', markdown: 'There' })

    const second = await call(admin.token, 'POST', QUEUE, { subject: 'Again', markdown: 'More' })

    expect(second.status).toBe(409)
  })

  it('runs one batch now, and cancels', async () => {
    const admin = await makeAdmin('queue-run')
    await register('queue-run-other')
    await call(admin.token, 'POST', QUEUE, { subject: 'Hi', markdown: 'There', perRun: 1 })

    const run = await call(admin.token, 'POST', `${QUEUE}/run`)
    expect(run.status).toBe(200)
    const body = (await run.json()) as {
      run: { sent: number }
      queue: { counts: { sent: number; pending: number } }
    }
    expect(body.run.sent).toBe(1)
    expect(body.queue.counts).toMatchObject({ sent: 1, pending: 1 })
    expect(sent).toHaveLength(1)

    const cancel = await call(admin.token, 'POST', `${QUEUE}/cancel`)
    expect(cancel.status).toBe(200)
    expect(((await cancel.json()) as { queue: { status: string } }).queue.status).toBe('cancelled')

    // Nothing is sent after cancelling, and there is nothing left to run or cancel.
    expect((await call(admin.token, 'POST', `${QUEUE}/run`)).status).toBe(409)
    expect((await call(admin.token, 'POST', `${QUEUE}/cancel`)).status).toBe(409)
    expect(sent).toHaveLength(1)
  })

  it('releases stuck rows for an admin only, and answers 409 when no queue is active', async () => {
    const admin = await makeAdmin('queue-release')
    const user = await register('queue-release-user')
    const RELEASE = `${QUEUE}/release-stuck`

    expect((await call(user.token, 'POST', RELEASE)).status).toBe(403)
    expect((await call(admin.token, 'POST', RELEASE)).status).toBe(409)

    await call(admin.token, 'POST', QUEUE, { subject: 'Hi', markdown: 'There' })
    const queued = (await (await call(admin.token, 'GET', QUEUE)).json()) as { queue: { id: string } }
    await appRepo.claimBroadcastRecipients(queued.queue.id, 2)
    // A run started a moment ago, so it may still be sending these rows.
    await appRepo.recordBroadcastRun(queued.queue.id, new Date().toISOString())
    const tooSoon = await call(admin.token, 'POST', RELEASE)
    expect(tooSoon.status).toBe(409)
    expect(await tooSoon.json()).toMatchObject({
      error: 'RUN_IN_PROGRESS',
      message: 'A run started less than five minutes ago; wait and try again',
    })
    expect((await appRepo.broadcastCounts(queued.queue.id)).sending).toBe(2)

    await appRepo.recordBroadcastRun(queued.queue.id, '2020-01-01T00:00:00.000Z')
    const response = await call(admin.token, 'POST', RELEASE)

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      released: number
      queue: { counts: { pending: number; sending: number }; stuck: string[] }
    }
    expect(body.released).toBe(2)
    expect(body.queue.counts).toMatchObject({ pending: 2, sending: 0 })
    expect(body.queue.stuck).toEqual([])
  })

  it('answers 409 to run when nothing is queued', async () => {
    const admin = await makeAdmin('queue-empty')
    expect((await call(admin.token, 'POST', `${QUEUE}/run`)).status).toBe(409)
  })

  it('does not put a recipient address or a password hash in a non-admin response', async () => {
    const admin = await makeAdmin('queue-leak-admin')
    const user = await register('queue-leak-user')
    await call(admin.token, 'POST', QUEUE, { subject: 'Hi', markdown: 'There' })

    const response = await call(user.token, 'GET', QUEUE)

    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('@example.com')
  })
})
