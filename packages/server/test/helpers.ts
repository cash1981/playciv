/**
 * A small `fastify.inject`-shaped wrapper around `app.request`, so the tests
 * read the same as before the Hono migration.
 */

import type { App } from '../src/app.js'
import type { OutgoingEmail } from '../src/mail.js'

export interface InjectOptions {
  readonly method?: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly payload?: unknown
}

export interface InjectResponse {
  readonly status: number
  readonly body: string
  /** Response headers with lower-cased names, for asserting a redirect. */
  readonly headers: Record<string, string>
  json<T = unknown>(): Promise<T>
  text(): Promise<string>
}

export async function inject(app: App, opts: InjectOptions): Promise<InjectResponse> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
  }
  if (opts.payload !== undefined) {
    init.body = JSON.stringify(opts.payload)
  }

  const res = await app.request(opts.url, init)
  const body = await res.clone().text()
  return {
    status: res.status,
    body,
    headers: Object.fromEntries(res.headers.entries()),
    json: async <T = unknown>(): Promise<T> => JSON.parse(body) as T,
    text: async () => body,
  }
}

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
})

/** The verification link the last recorded verification mail carried. */
export function verificationLinkFrom(mails: readonly OutgoingEmail[], email: string): string {
  const mail = [...mails]
    .reverse()
    .find((candidate) => candidate.to === email && candidate.subject === 'Please verify your email address')
  const token = mail === undefined ? undefined : /\/api\/auth\/verify-email\/(\S+)/.exec(mail.text)?.[1]
  if (token === undefined) throw new Error(`no verification mail for ${email}`)
  return token
}

/**
 * Opens the verification link a live fake mailer recorded for `email` and
 * removes that mail, so a test's send count is only the mails it cares about.
 * Register helpers in the tests that pass a real `Mailer` use it; tests with
 * the default no-op mailer never receive a verification mail at all.
 */
export async function verifyRecordedEmail(
  app: App,
  mailer: { readonly sent: OutgoingEmail[] },
  email: string,
): Promise<void> {
  const token = verificationLinkFrom(mailer.sent, email)
  const response = await inject(app, { url: `/api/auth/verify-email/${token}` })
  if (response.status !== 200) throw new Error(`verification link answered ${response.status}`)
  const index = mailer.sent.findIndex(
    (mail) => mail.to === email && mail.subject === 'Please verify your email address',
  )
  if (index !== -1) mailer.sent.splice(index, 1)
}
