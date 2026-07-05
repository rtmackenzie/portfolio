ALTER TABLE app_settings ADD COLUMN low_risk_hold_max_mortgages INTEGER NOT NULL DEFAULT 2;
ALTER TABLE app_settings ADD COLUMN medium_risk_hold_max_mortgages INTEGER NOT NULL DEFAULT 3;
