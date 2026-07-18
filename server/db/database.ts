import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'portfolio.db')
const SCHEMA_PATH = join(__dirname, 'schema.sql')

// A property with status='sold' is no longer owned, so it must not contribute value, rent, debt
// or count toward any *analytical* surface — portfolio KPIs, the scorecard/heatmap, concentration
// risk, or the projection engine's starting state. Without this the sold property's value and
// rent silently persist into every aggregate and every 15-year projection.
//
// Deliberately NOT applied to listing/CRUD surfaces (the Portfolio list, property detail, the
// property report): a sold property should still be visible as a record of what you owned.
//
// 'under_offer' stays included — the sale hasn't completed, so the property is still owned.
export const NOT_SOLD = "status <> 'sold'"

// For child tables (mortgages, tenants, certificates…) that carry a property_id. Excluding a sold
// property's value while still counting its mortgage would understate equity and inflate LTV, so
// analytical queries must scope the children the same way they scope the properties.
export const OWNED_PROPERTY_IDS = `(SELECT id FROM properties WHERE ${NOT_SOLD})`

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')

  const schema = readFileSync(SCHEMA_PATH, 'utf-8')
  _db.exec(schema)

  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql)
  return stmt.all(...params) as T[]
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = getDb().prepare(sql)
  return stmt.get(...params) as T | undefined
}

export function execute(sql: string, params: unknown[] = []) {
  return getDb().prepare(sql).run(...params)
}

export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)()
}
