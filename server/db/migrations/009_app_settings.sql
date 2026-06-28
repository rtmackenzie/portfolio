CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tax_ownership TEXT NOT NULL DEFAULT 'personal',
  personal_marginal_rate_pct REAL NOT NULL DEFAULT 40,
  s24_credit_rate_pct REAL NOT NULL DEFAULT 20,
  corp_tax_rate_pct REAL NOT NULL DEFAULT 19,
  cgt_rate_pct REAL NOT NULL DEFAULT 24,
  cgt_annual_exempt REAL NOT NULL DEFAULT 3000,
  selling_costs_pct REAL NOT NULL DEFAULT 2,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (id) VALUES (1);
