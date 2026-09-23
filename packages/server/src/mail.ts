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
  /**
   * True when a send really reaches a provider. The no-op mailer is false, and
   * a route that needs to know whether mail can actually go out reads
   * `Notifications.emailDeliveryEnabled`, which is this value. Registration
   * auto-verifies exactly when it is false (issue #42).
   */
  readonly enabled: boolean
  send(email: OutgoingEmail): Promise<void>
}

/**
 * Sends nothing. The default when no provider is configured, so local
 * development and tests never talk to a mail provider — Java behaved the same
 * way when the SendGrid environment variables were missing (it logged and
 * returned false rather than failing the request).
 */
export const noopMailer: Mailer = {
  enabled: false,
  async send() {
    // Intentionally empty.
  },
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/**
 * A send that hangs must not hold a game request open: the action is already
 * committed by the time we send, so a slow provider would otherwise make the
 * client time out on a request that in fact succeeded, and a retry could hit a
 * new state. Five seconds is far above Resend's normal latency.
 */
const DEFAULT_TIMEOUT_MS = 5_000

export interface ResendMailerOptions {
  readonly apiKey: string
  readonly from: string
  /** Milliseconds before the request is aborted; defaults to 5 seconds. */
  readonly timeoutMs?: number
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
  return {
    enabled: true,
    async send(email: OutgoingEmail): Promise<void> {
      const response = await doFetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from,
          to: email.to,
          subject: email.subject,
          text: email.text,
          // Resend treats an absent `html` as a plain-text mail; only add it
          // when a caller supplied one, so the existing mails are unchanged.
          ...(email.html !== undefined ? { html: email.html } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Resend rejected the email (${response.status}): ${detail}`)
      }
    },
  }
}
