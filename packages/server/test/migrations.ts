/**
 * Applies every committed D1 migration (in filename order) for the tests, so
 * the schema under test is exactly what `wrangler d1 migrations apply` produces
 * — including follow-up migrations like `0002_username_lower.sql`.
 */

import { readdirSync, readFileSync } from 'node:fs'

const migrationsDir = new URL('../../worker/migrations/', import.meta.url)

export function readMigrations(): string {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationsDir), 'utf8'))
    .join('\n')
}
