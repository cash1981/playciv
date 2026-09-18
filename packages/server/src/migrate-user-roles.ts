/**
 * Adds account access fields to legacy MongoDB player documents and promotes
 * one configured account. The updates never read or write password fields.
 *
 * Run with `MONGO_URL`, optional `MONGO_DB` (default `playciv`) and optional
 * `ADMIN_USERNAME` (default `cash`). It is safe to run more than once.
 */

import './load-env.js'

import { MongoClient } from 'mongodb'

const mongoUrl = process.env['MONGO_URL']
if (mongoUrl === undefined) {
  console.error('MONGO_URL is not set')
  process.exitCode = 1
} else {
  const dbName = process.env['MONGO_DB'] ?? 'playciv'
  const adminUsername = process.env['ADMIN_USERNAME'] ?? 'cash'
  const client = new MongoClient(mongoUrl)

  try {
    await client.connect()
    const players = client.db(dbName).collection('player')
    const roleDefaults = await players.updateMany(
      { role: { $exists: false } },
      { $set: { role: 'user' } },
    )
    const disabledDefaults = await players.updateMany(
      { disabled: { $exists: false } },
      { $set: { disabled: false } },
    )
    const promoted = await players.updateOne(
      { username: adminUsername },
      { $set: { role: 'admin' } },
    )

    console.log(
      `User-role migration complete: defaulted ${roleDefaults.modifiedCount} roles, ` +
        `defaulted ${disabledDefaults.modifiedCount} disabled flags, ` +
        `promoted ${promoted.matchedCount} account(s) named "${adminUsername}".`,
    )
  } finally {
    await client.close()
  }
}
