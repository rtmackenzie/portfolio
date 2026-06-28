CREATE TABLE IF NOT EXISTS goals (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT    NOT NULL,
  goal_type              TEXT    NOT NULL CHECK(goal_type IN ('income','count','net_worth','mortgage_free','retirement_date')),
  target_monthly_income  REAL,
  target_property_count  INTEGER,
  target_equity          REAL,
  target_date            TEXT,
  max_ltv_pct            REAL,
  min_dscr               REAL,
  min_annual_cashflow    REAL,
  scenario_id            INTEGER REFERENCES scenarios(id) ON DELETE SET NULL,
  notes                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
