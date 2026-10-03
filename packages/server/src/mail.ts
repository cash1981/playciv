/**
 * Outgoing email. Java: `email/SendEmail.java`, which used SendGrid and read
 * `SENDGRID_USERNAME`/`SENDGRID_PASSWORD` from the environment. This rewrite
 * uses Resend instead (issue #30).
 *
 * The engine never sends mail: it is pure and has no clock or I/O. The server
 * owns both, so a `Mailer` is built here and injected into the app.
 */

export interface OutgoingEmail {
  readonly to: string
  readonly subject: string
  readonly text: string
  /** Optional HTML alternative; set by the admin broadcast (issue #92). */
  readonly html?: string
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>
  /**
   * Sends several mails in one provider request. Optional: a mailer without it
   * (the no-op mailer, test doubles) is driven one `send` at a time. Throws
   * `MailError` when the provider answers with a non-2xx status; the whole
   * batch is then treated as not sent.
   */
  sendBatch?(emails: readonly OutgoingEmail[]): Promise<void>
}

/**
 * The provider answered, but not with a 2xx. `status` and `detail` (the body,
 * which for Resend names the offending field) let a caller decide whether to
 * stop, split a batch or give up. A network error or a timeout is not a
 * `MailError`: no answer arrived.
 */
export class MailError extends Error {
  readonly status: number
  readonly detail: string

  constructor(message: string, status: number, detail: string) {
    super(message)
    this.name = 'MailError'
    this.status = status
    this.detail = detail
  }
}

/**
 * Sends nothing. The default when no provider is configured, so local
 * development and tests never talk to a mail provider — Java behaved the same
 * way when the SendGrid environment variables were missing (it logged and
 * returned false rather than failing the request).
 */
export const noopMailer: Mailer = {
  async send() {
    // Intentionally empty.
  },
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const RESEND_BATCH_ENDPOINT = 'https://api.resend.com/emails/batch'

/**
 * A send that hangs must not hold a game request open: the action is already
 * committed by the time we send, so a slow provider would otherwise make the
 * client time out on a request that in fact succeeded, and a retry could hit a
 * new state. Five seconds is far above Resend's normal latency.
 */
const DEFAULT_TIMEOUT_MS = 5_000

/** A batch of up to 100 mails takes Resend longer than a single one. */
const DEFAULT_BATCH_TIMEOUT_MS = 15_000

export interface ResendMailerOptions {
  readonly apiKey: string
  readonly from: string
  /** Milliseconds before the request is aborted; defaults to 5 seconds. */
  readonly timeoutMs?: number
  /** Milliseconds before a batch request is aborted; defaults to 15 seconds. */
  readonly batchTimeoutMs?: number
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch
}

/**
 * The Resend REST API the `resend` SDK wraps. Calling it directly keeps the
 * server free of a new dependency, and `fetch` is available on the Node
 * version the API runs on and on Cloudflare Workers.
 */
export function createResendMailer(options: ResendMailerOptions): Mailer {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const batchTimeoutMs = options.batchTimeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS

  const payload = (email: OutgoingEmail): Record<string, string> => ({
    from: options.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
    // Resend treats an absent `html` as a plain-text mail; only add it
    // when a caller supplied one, so the existing mails are unchanged.
    ...(email.html !== undefined ? { html: email.html } : {}),
  })

  async function post(url: string, body: unknown, timeout: number): Promise<Response> {
    return doFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
  }

  return {
    async send(email: OutgoingEmail): Promise<void> {
      const response = await post(RESEND_ENDPOINT, payload(email), timeoutMs)
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new MailError(
          `Resend rejected the email (${response.status}): ${detail}`,
          response.status,
          detail,
        )
      }
    },

    /**
     * `POST /emails/batch`: a JSON array of up to 100 mails, each with its own
     * recipient. Resend rejects the whole request when one mail fails
     * validation, which is why the caller may need to split a failed batch.
     */
    async sendBatch(emails: readonly OutgoingEmail[]): Promise<void> {
      const response = await post(RESEND_BATCH_ENDPOINT, emails.map(payload), batchTimeoutMs)
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new MailError(
          `Resend rejected the email batch (${response.status}): ${detail}`,
          response.status,
          detail,
        )
      }
    },
  }
}
