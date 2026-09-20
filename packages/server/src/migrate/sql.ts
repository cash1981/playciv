/**
 * SQL text emission for the D1 data import. Pure string work, so the test can
 * load the result into an in-memory SQLite database.
 */

export function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

/** One `INSERT` per row, keyed by the row object's own fields. */
export function insertStatement(table: string, row: object): string {
  const entries = Object.entries(row)
  const columns = entries.map(([column]) => column)
  const values = entries.map(([, value]) => sqlValue(value))
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`
}
