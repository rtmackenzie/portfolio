ALTER TABLE app_settings ADD COLUMN capex_cycle_years REAL NOT NULL DEFAULT 10;
ALTER TABLE app_settings ADD COLUMN capex_cost_per_property REAL NOT NULL DEFAULT 3000;
ALTER TABLE app_settings ADD COLUMN arrears_pct REAL NOT NULL DEFAULT 1.5;
