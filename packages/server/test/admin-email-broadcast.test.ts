/**
 * The admin email broadcast (issue #92). Ports the old, unreachable
 * `GameAction.sendMailToAll` — one personalised mail per account with an
 * address — as an admin-only route whose Markdown body is rendered to HTML.
 *
 * No provider is contacted: a `FakeMailer` records every send.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import type { App } from '../src/app.js'
import { createTestApp } from '../src/app.js'
import type { Mailer, OutgoingEmail } from '../src/mail.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
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
    expect(await response.json()).toEqual({ sent: 2, skipped: 2 })

    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual([
      'broadcast-admin@example.com',
      'opted-in@example.com',
    ])

    const mail = mailer.sent.find((candidate) => candidate.to === 'opted-in@example.com')
    expect(mail?.subject).toBe('Message from cash at playciv.app')
    // Plain-text fallback keeps the Markdown source.
    expect(mail?.text).toContain('Hello opted-in\n\n**Bold** news')
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
    expect(await response.json()).toEqual({ sent: 2, skipped: 0 })
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

  it('swallows a failed send but keeps going and counts it as skipped', async () => {
    const admin = await makeAdmin('failure-admin')
    await register('failure-other')

    mailer.fail = true
    const response = await broadcast(admin.token, {
      subject: 'Anyone there?',
      markdown: 'Still here',
    })
    mailer.fail = false

    expect(response.status).toBe(200)
    // Both accounts were eligible, but neither send succeeded.
    expect(await response.json()).toEqual({ sent: 0, skipped: 2 })
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
})
