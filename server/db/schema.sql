PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  town TEXT NOT NULL,
  county TEXT,
  postcode TEXT NOT NULL,
  purchase_date TEXT,
  purchase_price REAL,
  current_value REAL,
  property_type TEXT CHECK(property_type IN ('house','flat','hmo','commercial','land')) DEFAULT 'house',
  bedrooms INTEGER DEFAULT 0,
  bathrooms INTEGER DEFAULT 0,
  status TEXT CHECK(status IN ('owned','under_offer','sold','vacant','let')) DEFAULT 'owned',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  rent_amount REAL NOT NULL,
  rent_due_day INTEGER DEFAULT 1,
  tenancy_start TEXT NOT NULL,
  tenancy_end TEXT,
  deposit_amount REAL,
  deposit_scheme TEXT,
  status TEXT CHECK(status IN ('active','ended','notice_given')) DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mortgages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  lender TEXT NOT NULL,
  account_number TEXT,
  original_amount REAL NOT NULL,
  current_balance REAL NOT NULL,
  interest_rate REAL NOT NULL,
  monthly_payment REAL NOT NULL,
  type TEXT CHECK(type IN ('repayment','interest_only','tracker','fixed')) DEFAULT 'fixed',
  fixed_period_end TEXT,
  renewal_date TEXT,
  start_date TEXT,
  is_active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rent_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  due_date TEXT NOT NULL,
  paid_date TEXT,
  payment_method TEXT CHECK(payment_method IN ('bank_transfer','cash','standing_order','cheque')) DEFAULT 'bank_transfer',
  reference TEXT,
  notes TEXT,
  status TEXT CHECK(status IN ('pending','paid','late','partial','missed')) DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  category TEXT CHECK(category IN (
    'mortgage','insurance','letting_agent','maintenance','utilities',
    'council_tax','ground_rent','service_charge','accountancy',
    'legal','travel','other'
  )) NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT CHECK(frequency IN ('once','monthly','quarterly','annually')) DEFAULT 'monthly',
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK(category IN (
    'plumbing','electrical','roofing','heating','appliance',
    'structural','cosmetic','garden','other'
  )) DEFAULT 'other',
  cost REAL DEFAULT 0,
  date TEXT NOT NULL,
  contractor TEXT,
  contractor_phone TEXT,
  status TEXT CHECK(status IN ('pending','in_progress','completed','cancelled')) DEFAULT 'pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN (
    'title_deed','lease','mortgage','insurance','inventory',
    'tenancy_agreement','notice','correspondence','other'
  )) DEFAULT 'other',
  file_path TEXT,
  expiry_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  type TEXT CHECK(type IN (
    'gas_safety','epc','electrical','pat','fire_risk',
    'legionella','eicr','hmo_licence','planning','other'
  )) NOT NULL,
  issue_date TEXT,
  expiry_date TEXT NOT NULL,
  issuer TEXT,
  file_path TEXT,
  notes TEXT,
  status TEXT CHECK(status IN ('valid','expired','due_soon','missing')) DEFAULT 'valid',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS property_valuations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  valuation_date TEXT NOT NULL,
  amount REAL NOT NULL,
  source TEXT CHECK(source IN ('estate_agent','surveyor','self','portal','mortgage_lender')) DEFAULT 'self',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS acquisition_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  town TEXT,
  postcode TEXT,
  stage TEXT CHECK(stage IN (
    'spotted','researching','viewing_booked','offer_made',
    'under_offer','due_diligence','exchanged','completed','rejected'
  )) DEFAULT 'spotted',
  property_type TEXT CHECK(property_type IN ('house','flat','hmo','commercial','land')) DEFAULT 'house',
  bedrooms INTEGER,
  asking_price REAL,
  estimated_value REAL,
  expected_rent REAL,
  repair_costs REAL DEFAULT 0,
  deposit_percent REAL DEFAULT 25,
  mortgage_rate REAL DEFAULT 5.5,
  notes TEXT,
  agent_name TEXT,
  agent_phone TEXT,
  agent_email TEXT,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comparable_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES acquisition_opportunities(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  sale_price REAL NOT NULL,
  sale_date TEXT,
  bedrooms INTEGER,
  property_type TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS comparable_rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER NOT NULL REFERENCES acquisition_opportunities(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  rent_amount REAL NOT NULL,
  bedrooms INTEGER,
  property_type TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  base_date TEXT NOT NULL,
  projection_years INTEGER DEFAULT 10,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenario_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  event_type TEXT CHECK(event_type IN (
    'buy_property','sell_property','remortgage','rent_change',
    'vacancy_period','major_expense','refinance','interest_rate_change'
  )) NOT NULL,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenario_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  calculated_at TEXT DEFAULT (datetime('now')),
  results_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS market_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL,
  postcode_prefix TEXT,
  data_date TEXT NOT NULL,
  avg_house_price REAL,
  avg_rent REAL,
  avg_yield REAL,
  price_growth_1yr REAL,
  source TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS financial_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL UNIQUE,
  total_value REAL DEFAULT 0,
  total_debt REAL DEFAULT 0,
  total_equity REAL DEFAULT 0,
  monthly_income REAL DEFAULT 0,
  monthly_expenses REAL DEFAULT 0,
  net_cashflow REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT CHECK(entity_type IN (
    'property','tenant','mortgage','expense','maintenance',
    'certificate','document','acquisition','scenario','payment'
  )),
  entity_id INTEGER,
  description TEXT NOT NULL,
  event_date TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_property ON tenants(property_id);
CREATE INDEX IF NOT EXISTS idx_mortgages_property ON mortgages(property_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_property ON rent_payments(property_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_due_date ON rent_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_expenses_property ON expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_property ON maintenance_records(property_id);
CREATE INDEX IF NOT EXISTS idx_certificates_property ON certificates(property_id);
CREATE INDEX IF NOT EXISTS idx_certificates_expiry ON certificates(expiry_date);
CREATE INDEX IF NOT EXISTS idx_valuations_property ON property_valuations(property_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_event_date ON activity_log(event_date);
CREATE INDEX IF NOT EXISTS idx_scenario_events_scenario ON scenario_events(scenario_id);
