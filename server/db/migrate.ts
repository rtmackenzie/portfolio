import { getDb } from './database.ts'
import { readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function runMigrations() {
  const db = getDb()

  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    applied_at TEXT DEFAULT (datetime('now'))
  )`)

  const applied = db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[]
  const appliedSet = new Set(applied.map(r => r.filename))

  const migrationsDir = join(__dirname, 'migrations')
  let files: string[] = []
  try {
    files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  } catch {
    // no migrations directory yet
  }

  for (const file of files) {
    if (appliedSet.has(file)) continue
    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    db.exec(sql)
    db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file)
    console.log(`[DB] Applied migration: ${file}`)
  }
}
