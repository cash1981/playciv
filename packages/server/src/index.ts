/**
 * Startup. Java: `CivilizationApplication.main` with Dropwizard and
 * `config.yml`; here it is environment variables.
 *
 *   PORT           defaults to 8787
 *   HOST           standard 127.0.0.1
 *   DATA_FILE      where state is mirrored, defaults to ./data/civ.json
 *                  — ignored when MONGO_URL is set
 *   MONGO_URL      a MongoDB connection string. When set, this replaces the
 *                  JSON file: `player` and `chat` are reused, new games go
 *                  into `game_state`, and `pbf` is read for highscore only.
 *   MONGO_DB       database name, defaults to "playciv"
 *   TOKEN_SECRET   HMAC secret for session tokens
 *   CORS_ORIGIN    comma separated list, defaults to everything
 *
 * For local development these can live in a gitignored `packages/server/.env`;
 * `./load-env.js` loads it. In production the host supplies them.
 */

import './load-env.js'

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import { JsonFileRepository } from './store/json-file.js'
import { MongoRepository } from './store/mongo.js'
import type { Repository } from './store/types.js'

const port = Number(process.env['PORT'] ?? 8787)
const host = process.env['HOST'] ?? '127.0.0.1'

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

const app = createApp({ repo, tokenSecret, logger: true, corsOrigin })

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
