/**
 * A `D1Database` backed by Node's built-in `node:sqlite`, for tests only.
 *
 * The real D1 binding only exists inside workerd, which CI (and this Windows
 * machine) cannot run, so `D1Repository` is exercised against a real SQLite
 * engine through the same prepared-statement API D1 exposes. `batch()` is
 * wrapped in a transaction that never yields, matching D1's atomicity — the
 * guarded compare-and-set writes rely on that.
 *
 * `node:sqlite` is available without a flag from Node 24, which the root
 * `engines` field now requires; a runtime without it fails the suite loudly
 * rather than skipping the D1 coverage.
 */

import type { D1Database, D1PreparedStatement, D1Result } from '../src/store/d1.js'

type SqliteModule = typeof import('node:sqlite')

let sqliteModule: SqliteModule | undefined

async function loadSqlite(): Promise<SqliteModule> {
  if (sqliteModule === undefined) sqliteModule = await import('node:sqlite')
  return sqliteModule
}

export interface D1Adapter {
  readonly db: D1Database
  /** Closes the in-memory database. */
  close(): void
}

export async function createD1Adapter(schema: string): Promise<D1Adapter> {
  const { DatabaseSync } = await loadSqlite()
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(schema)

  /** What `run()` does, without the `async`: a batch must not yield between its statements. */
  const runSync = (query: string, bound: readonly unknown[]): D1Result => {
    const info = sqlite.prepare(query).run(...(bound as never[]))
    return { results: [], success: true, meta: { changes: Number(info.changes) } }
  }

  const makeStatement = (query: string, bound: readonly unknown[]): D1PreparedStatement => {
    const statement = {
      runSync: () => runSync(query, bound),
      bind: (...values: unknown[]): D1PreparedStatement => makeStatement(query, values),
      async first(colName?: string): Promise<unknown> {
        const row = sqlite.prepare(query).get(...(bound as never[]))
        if (row === undefined) return null
        if (colName !== undefined) return (row as Record<string, unknown>)[colName] ?? null
        return row
      },
      async all(): Promise<D1Result> {
        const results = sqlite.prepare(query).all(...(bound as never[]))
        return { results, success: true, meta: { changes: 0 } }
      },
      async run(): Promise<D1Result> {
        return runSync(query, bound)
      },
    }
    return statement as unknown as D1PreparedStatement
  }

  const db = {
    prepare: (query: string): D1PreparedStatement => makeStatement(query, []),
    async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
      // No `await` between BEGIN and COMMIT: D1 runs a batch as one atomic unit, so
      // another request's statements must not slip in between (they would, on a
      // single connection, if this yielded).
      sqlite.exec('BEGIN')
      const results: D1Result[] = []
      try {
        for (const statement of statements) {
          results.push((statement as unknown as { runSync(): D1Result }).runSync())
        }
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }

  return {
    db: db as unknown as D1Database,
    close: () => {
      sqlite.close()
    },
  }
}
