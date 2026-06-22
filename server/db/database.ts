import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'portfolio.db')
const SCHEMA_PATH = join(__dirname, 'schema.sql')

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
