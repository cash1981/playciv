/**
 * Oppstart. Java: `CivilizationApplication.main` med Dropwizard og
 * `config.yml`; her er det miljøvariabler.
 *
 *   PORT           standard 8787
 *   HOST           standard 127.0.0.1
 *   DATA_FILE      hvor tilstanden speiles, standard ./data/civ.json
 *   TOKEN_SECRET   HMAC-hemmelighet for sesjonstokens
 *   CORS_ORIGIN    kommaseparert liste, standard alle
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
    'TOKEN_SECRET er ikke satt — bruker en tilfeldig hemmelighet. ' +
      'Alle innlogginger blir ugyldige ved omstart.',
  )
}

const corsEnv = process.env['CORS_ORIGIN']
const corsOrigin = corsEnv === undefined ? true : corsEnv.split(',').map((value) => value.trim())

const repo = new JsonFileRepository({ filePath: dataFile })
await repo.load()

const app = await createApp({ repo, tokenSecret, logger: true, corsOrigin })

// Skriv ventende endringer til disk før prosessen dør
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
console.log(`Tilstand speiles til ${dataFile}`)
