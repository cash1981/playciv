/**
 * Creates a known test account in Mongo so the app can be checked against the
 * restored `playciv` database without an old password. Idempotent: does
 * nothing if the username already exists.
 *
 * Run with `pnpm --filter @civ/server seed:test-user`. Needs `MONGO_URL`
 * (and optionally `MONGO_DB`, default `playciv`) set in the environment.
 */

import { hashPassword, newId } from './auth.js'
import { MongoRepository } from './store/mongo.js'
import type { StoredPlayer } from './store/types.js'

const USERNAME = 'test'
const PASSWORD = 'test1234'
const EMAIL = 'test@example.com'

const mongoUrl = process.env['MONGO_URL']
if (mongoUrl === undefined) {
  console.error('MONGO_URL is not set')
  process.exit(1)
}

const dbName = process.env['MONGO_DB'] ?? 'playciv'
const repo = await MongoRepository.connect(mongoUrl, dbName)

try {
  const existing = await repo.findPlayerByUsername(USERNAME)
  if (existing !== undefined) {
    console.log(`Player "${USERNAME}" already exists (id ${existing.id}), nothing to do.`)
  } else {
    const player: StoredPlayer = {
      id: newId(),
      username: USERNAME,
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      createdAt: new Date().toISOString(),
    }
    await repo.createPlayer(player)
    console.log(`Created player "${USERNAME}" (id ${player.id}) with password "${PASSWORD}".`)
  }
} finally {
  await repo.close()
}
