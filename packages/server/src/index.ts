/**
 * Startup. Java: `CivilizationApplication.main` with Dropwizard and
 * `config.yml`; here it is environment variables.
 *
 * The Node entry point is local development only (`pnpm dev`). Production runs
 * the same Hono app on the Cloudflare Worker against D1 (`packages/worker`), so
 * this file always uses the JSON-file repository — there is no MongoDB path any
 * more (issue #72). See `docs/agents/decisions.md`.
 *
 *   PORT           defaults to 8787
 *   HOST           defaults to 0.0.0.0 so a container host can route to it
 *   DATA_FILE      where state is mirrored, defaults to ./data/civ.json
 *   TOKEN_SECRET   HMAC secret for session tokens
 *   CORS_ORIGIN    comma separated list, defaults to everything
 *   RESEND_API_KEY Resend API key. When unset, email is a no-op (as Java was
 *                  when its SendGrid variables were missing).
 *   MAIL_FROM      from address, defaults to noreply@playciv.app
 *   APP_ORIGIN     base URL of the web app, defaults to https://playciv.app.
 *                  Used in the links inside notification email.
 *
 * For local development these can live in a gitignored `packages/server/.env`;
 * `./load-env.js` loads it.
 */

import './load-env.js'

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import type { Mailer } from './mail.js'
import { createResendMailer, noopMailer } from './mail.js'
import { DEFAULT_APP_ORIGIN } from './notifications.js'
import { JsonFileRepository } from './store/json-file.js'

const port = Number(process.env['PORT'] ?? 8787)
const host = process.env['HOST'] ?? '0.0.0.0'

const tokenSecret = process.env['TOKEN_SECRET'] ?? randomBytes(32).toString('hex')
if (process.env['TOKEN_SECRET'] === undefined) {
  console.warn(
    'TOKEN_SECRET is not set — using a random secret. ' +
      'Every sign-in becomes invalid on restart.',
  )
}

const corsEnv = process.env['CORS_ORIGIN']
const corsOrigin = corsEnv === undefined ? true : corsEnv.split(',').map((value) => value.trim())

const dataFile = resolve(process.env['DATA_FILE'] ?? 'data/civ.json')
const repo = new JsonFileRepository({ filePath: dataFile })
await repo.load()
console.log(`Storage: JSON file, mirrored to ${dataFile}`)

const appOrigin = process.env['APP_ORIGIN'] ?? DEFAULT_APP_ORIGIN
const mailFrom = process.env['MAIL_FROM'] ?? 'noreply@playciv.app'

let mailer: Mailer = noopMailer
const resendKey = process.env['RESEND_API_KEY']
if (resendKey === undefined || resendKey === '') {
  console.warn('RESEND_API_KEY is not set — email notifications are disabled.')
} else {
  mailer = createResendMailer({ apiKey: resendKey, from: mailFrom })
  console.log(`Email: Resend, from ${mailFrom}`)
}

const app = createApp({
  repo,
  tokenSecret,
  logger: true,
  corsOrigin,
  mailer,
  appOrigin,
})

const server = serve({ fetch: app.fetch, port, hostname: host })

// Flush pending changes before the process dies
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      await repo.flush()
      process.exit(0)
    })()
  })
}
