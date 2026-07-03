ALTER TABLE goals ADD COLUMN ranking_mode TEXT NOT NULL DEFAULT 'fastest';
ALTER TABLE goal_pathways ADD COLUMN risk_breakdown_json TEXT;
ALTER TABLE goal_pathways ADD COLUMN shortfall REAL;
