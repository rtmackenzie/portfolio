ALTER TABLE app_settings ADD COLUMN default_completion_lag_months REAL NOT NULL DEFAULT 2;
ALTER TABLE app_settings ADD COLUMN default_onboarding_void_months REAL NOT NULL DEFAULT 1;
