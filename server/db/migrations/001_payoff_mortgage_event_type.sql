-- Add payoff_mortgage to scenario_events event_type CHECK constraint.
-- SQLite does not support ALTER TABLE to modify constraints, so we recreate the table.
PRAGMA foreign_keys = OFF;

CREATE TABLE scenario_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  event_type TEXT CHECK(event_type IN (
    'buy_property','sell_property','remortgage','rent_change',
    'vacancy_period','major_expense','refinance','interest_rate_change',
    'payoff_mortgage'
  )) NOT NULL,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  parameters_json TEXT DEFAULT '{}',
  sort_order INTEGER DEFAULT 0
);

INSERT INTO scenario_events_new SELECT * FROM scenario_events;
DROP TABLE scenario_events;
ALTER TABLE scenario_events_new RENAME TO scenario_events;

PRAGMA foreign_keys = ON;
