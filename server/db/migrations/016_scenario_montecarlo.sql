CREATE TABLE IF NOT EXISTS scenario_montecarlo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  seed INTEGER NOT NULL,
  runs INTEGER NOT NULL,
  target_monthly_income REAL,
  goal_probability REAL,
  bands_json TEXT NOT NULL,
  calculated_at TEXT DEFAULT (datetime('now'))
);
