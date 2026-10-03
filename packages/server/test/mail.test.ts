/**
 * The Resend mailer (issue #30). No network: `fetchImpl` is injected.
 */

import { describe, expect, it, vi } from 'vitest'

import { createResendMailer, MailError } from '../src/mail.js'

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

  it('forwards the optional html body to Resend when one is set', async () => {
    let captured: RequestInit | undefined
    const fetchImpl: typeof fetch = async (_input, init) => {
      captured = init ?? {}
      return new Response('{"id":"test"}', { status: 200 })
    }

    const mailer = createResendMailer({ apiKey: 're_test', from: 'a@b.c', fetchImpl })
    await mailer.send({
      to: 'to@example.com',
      subject: 'Hi',
      text: '**Bold**',
      html: '<p><strong>Bold</strong></p>',
    })

    expect(JSON.parse(String(captured?.body))).toEqual({
      from: 'a@b.c',
      to: 'to@example.com',
      subject: 'Hi',
      text: '**Bold**',
      html: '<p><strong>Bold</strong></p>',
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

  it('keeps the message of a rejected single send, and carries status and detail', async () => {
    const fetchImpl: typeof fetch = async () => new Response('bad key', { status: 401 })
    const mailer = createResendMailer({ apiKey: 're_test', from: 'a@b.c', fetchImpl })
    const error = await mailer
      .send({ to: 'x@y.z', subject: 's', text: 't' })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MailError)
    expect((error as MailError).message).toBe('Resend rejected the email (401): bad key')
    expect((error as MailError).status).toBe(401)
    expect((error as MailError).detail).toBe('bad key')
  })

  describe('sendBatch', () => {
    it('posts a JSON array to the batch endpoint with the same headers', async () => {
      let captured: { url: string; init: RequestInit } | undefined
      const fetchImpl: typeof fetch = async (input, init) => {
        captured = { url: String(input), init: init ?? {} }
        return new Response('{"data":[]}', { status: 200 })
      }
      const mailer = createResendMailer({
        apiKey: 're_test',
        from: 'noreply@playciv.app',
        fetchImpl,
      })

      await mailer.sendBatch?.([
        { to: 'a@example.com', subject: 'Hi', text: 'One', html: '<p>One</p>' },
        { to: 'b@example.com', subject: 'Hi', text: 'Two' },
      ])

      expect(captured?.url).toBe('https://api.resend.com/emails/batch')
      expect(captured?.init.method).toBe('POST')
      const headers = captured?.init.headers as Record<string, string>
      expect(headers['authorization']).toBe('Bearer re_test')
      expect(headers['content-type']).toBe('application/json')
      expect(JSON.parse(String(captured?.init.body))).toEqual([
        {
          from: 'noreply@playciv.app',
          to: 'a@example.com',
          subject: 'Hi',
          text: 'One',
          html: '<p>One</p>',
        },
        { from: 'noreply@playciv.app', to: 'b@example.com', subject: 'Hi', text: 'Two' },
      ])
    })

    it('throws a MailError with the status and the body when Resend rejects the batch', async () => {
      const body = '{"message":"Invalid `to` field"}'
      const fetchImpl: typeof fetch = async () => new Response(body, { status: 422 })
      const mailer = createResendMailer({ apiKey: 're_test', from: 'a@b.c', fetchImpl })

      const error = await mailer
        .sendBatch?.([{ to: 'bad', subject: 's', text: 't' }])
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(MailError)
      expect((error as MailError).status).toBe(422)
      expect((error as MailError).detail).toBe(body)
    })

    it('gets a longer timeout than a single send by default', async () => {
      const timeouts: (number | undefined)[] = []
      const spy = vi.spyOn(AbortSignal, 'timeout')
      const fetchImpl: typeof fetch = async () => new Response('{}', { status: 200 })
      const mailer = createResendMailer({ apiKey: 're_test', from: 'a@b.c', fetchImpl })

      await mailer.send({ to: 'x@y.z', subject: 's', text: 't' })
      await mailer.sendBatch?.([{ to: 'x@y.z', subject: 's', text: 't' }])
      for (const call of spy.mock.calls) timeouts.push(call[0])
      spy.mockRestore()

      expect(timeouts).toEqual([5_000, 15_000])
    })
  })
})
