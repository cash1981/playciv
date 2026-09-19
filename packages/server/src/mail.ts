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
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>
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

export interface ResendMailerOptions {
  readonly apiKey: string
  readonly from: string
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch
}

/**
 * The Resend REST API the `resend` SDK wraps. Calling it directly keeps the
 * server free of a new dependency, and `fetch` is available on the Node
 * version the API runs on.
 */
export function createResendMailer(options: ResendMailerOptions): Mailer {
  const doFetch = options.fetchImpl ?? fetch
  return {
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
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Resend rejected the email (${response.status}): ${detail}`)
      }
    },
  }
}
