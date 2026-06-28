CREATE TABLE IF NOT EXISTS goal_pathways (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id           INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  scenario_id       INTEGER REFERENCES scenarios(id) ON DELETE SET NULL,
  template_name     TEXT NOT NULL,
  label             TEXT NOT NULL,
  feasible          INTEGER NOT NULL DEFAULT 1,
  reaches_goal      INTEGER NOT NULL DEFAULT 0,
  months_to_goal    INTEGER,
  summary_json      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
