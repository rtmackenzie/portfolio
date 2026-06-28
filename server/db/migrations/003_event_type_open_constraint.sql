-- Recreate scenario_events without the event_type CHECK constraint.
-- New event types (director_loan_in, director_loan_repay) are not in the
-- original CHECK list, and SQLite cannot ALTER a constraint in-place.
-- Application-layer validation makes the DB constraint redundant.
PRAGMA foreign_keys = OFF;

CREATE TABLE scenario_events_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id     INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  property_id     INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  date            TEXT NOT NULL,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  sort_order      INTEGER DEFAULT 0
);

INSERT INTO scenario_events_new
  SELECT id, scenario_id, event_type, property_id, date, parameters_json, sort_order
  FROM scenario_events;

DROP TABLE scenario_events;
ALTER TABLE scenario_events_new RENAME TO scenario_events;

PRAGMA foreign_keys = ON;
