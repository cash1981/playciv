/**
 * The Resend mailer (issue #30). No network: `fetchImpl` is injected.
 */

import { describe, expect, it } from 'vitest'

import { createResendMailer } from '../src/mail.js'

describe('Resend mailer', () => {
  it('posts the Resend payload to the Resend endpoint', async () => {
    let captured: { url: string; init: RequestInit } | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      captured = { url: String(input), init: init ?? {} }
      return new Response('{"id":"test"}', { status: 200 })
    }

    const mailer = createResendMailer({
      apiKey: 're_test',
      from: 'noreply@playciv.app',
      fetchImpl,
    })
    await mailer.send({ to: 'to@example.com', subject: 'Hi', text: 'Body' })

    expect(captured?.url).toBe('https://api.resend.com/emails')
    expect(captured?.init.method).toBe('POST')
    const headers = captured?.init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer re_test')
    expect(JSON.parse(String(captured?.init.body))).toEqual({
      from: 'noreply@playciv.app',
      to: 'to@example.com',
      subject: 'Hi',
      text: 'Body',
    })
  })

  it('throws when Resend rejects the mail', async () => {
    const fetchImpl: typeof fetch = async () => new Response('bad key', { status: 401 })
    const mailer = createResendMailer({ apiKey: 're_test', from: 'a@b.c', fetchImpl })
    await expect(mailer.send({ to: 'x@y.z', subject: 's', text: 't' })).rejects.toThrow('401')
  })

  it('aborts a send that exceeds the timeout, so a hang cannot hold the request', async () => {
    // Reject only when the abort signal fires, mimicking a provider that never
    // answers. Without the timeout this promise would never settle.
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal === undefined || signal === null) {
          reject(new Error('the request carried no timeout signal'))
          return
        }
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      })

    const mailer = createResendMailer({
      apiKey: 're_test',
      from: 'a@b.c',
      timeoutMs: 5,
      fetchImpl,
    })
    await expect(mailer.send({ to: 'x@y.z', subject: 's', text: 't' })).rejects.toThrow()
  })
})
