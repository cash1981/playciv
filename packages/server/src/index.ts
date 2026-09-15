/**
 * Startup. Java: `CivilizationApplication.main` with Dropwizard and
 * `config.yml`; here it is environment variables.
 *
 *   PORT           defaults to 8787
 *   HOST           standard 127.0.0.1
 *   DATA_FILE      where state is mirrored, defaults to ./data/civ.json
 *   TOKEN_SECRET   HMAC secret for session tokens
 *   CORS_ORIGIN    comma separated list, defaults to everything
 */

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { createApp } from './app.js'
import { JsonFileRepository } from './store/json-file.js'

const port = Number(process.env['PORT'] ?? 8787)
const host = process.env['HOST'] ?? '127.0.0.1'
const dataFile = resolve(process.env['DATA_FILE'] ?? 'data/civ.json')

const tokenSecret = process.env['TOKEN_SECRET'] ?? randomBytes(32).toString('hex')
if (process.env['TOKEN_SECRET'] === undefined) {
  console.warn(
    'TOKEN_SECRET is not set — using a random secret. ' +
      'Every sign-in becomes invalid on restart.',
  )
}

const corsEnv = process.env['CORS_ORIGIN']
const corsOrigin = corsEnv === undefined ? true : corsEnv.split(',').map((value) => value.trim())

const repo = new JsonFileRepository({ filePath: dataFile })
await repo.load()

const app = await createApp({ repo, tokenSecret, logger: true, corsOrigin })

// Flush pending changes to disk before the process dies
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await app.close()
      await repo.flush()
      process.exit(0)
    })()
  })
}

await app.listen({ port, host })
console.log(`State is mirrored to ${dataFile}`)
