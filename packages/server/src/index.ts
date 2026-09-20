/**
 * Startup. Java: `CivilizationApplication.main` with Dropwizard and
 * `config.yml`; here it is environment variables.
 *
 *   PORT           defaults to 8787 (a host such as Render sets this)
 *   HOST           defaults to 0.0.0.0 so a container host can route to it
 *   DATA_FILE      where state is mirrored, defaults to ./data/civ.json
 *                  — ignored when MONGO_URL is set
 *   MONGO_URL      a MongoDB connection string. When set, this replaces the
 *                  JSON file: `player` and `chat` are reused, new games go
 *                  into `game_state`, and `pbf` is read for highscore only.
 *   MONGO_DB       database name, defaults to "playciv"
 *   TOKEN_SECRET   HMAC secret for session tokens
 *   CORS_ORIGIN    comma separated list, defaults to everything
 *   RESEND_API_KEY Resend API key. When unset, email is a no-op (as Java was
 *                  when its SendGrid variables were missing).
 *   MAIL_FROM      from address, defaults to noreply@playciv.app
 *   APP_ORIGIN     base URL of the web app, defaults to https://playciv.app.
 *                  Used in the links inside notification email.
 *   MAIL_BROADCAST_NEW_GAMES  "true" to email every account when a game is
 *                  created (Java's behaviour). Off by default.
 *
 * For local development these can live in a gitignored `packages/server/.env`;
 * `./load-env.js` loads it. In production the host supplies them.
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
import { MongoRepository } from './store/mongo.js'
import type { Repository } from './store/types.js'

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

const mongoUrl = process.env['MONGO_URL']
let repo: Repository
let mongo: MongoRepository | undefined
let dataFile: string | undefined

if (mongoUrl !== undefined) {
  const dbName = process.env['MONGO_DB'] ?? 'playciv'
  mongo = await MongoRepository.connect(mongoUrl, dbName)
  repo = mongo
  console.log(`Storage: MongoDB (${dbName})`)
} else {
  dataFile = resolve(process.env['DATA_FILE'] ?? 'data/civ.json')
  const json = new JsonFileRepository({ filePath: dataFile })
  await json.load()
  repo = json
  console.log(`Storage: JSON file, mirrored to ${dataFile}`)
}

const appOrigin = process.env['APP_ORIGIN'] ?? DEFAULT_APP_ORIGIN
const mailFrom = process.env['MAIL_FROM'] ?? 'noreply@playciv.app'
const broadcastNewGames = process.env['MAIL_BROADCAST_NEW_GAMES'] === 'true'

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
  broadcastNewGames,
})

const server = serve({ fetch: app.fetch, port, hostname: host })

// Flush pending changes and close any open connection before the process dies
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      await repo.flush()
      await mongo?.close()
      process.exit(0)
    })()
  })
}
