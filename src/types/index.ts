export type PropertyType = 'house' | 'flat' | 'hmo' | 'commercial' | 'land'
export type PropertyStatus = 'owned' | 'under_offer' | 'sold' | 'vacant' | 'let'

export interface Property {
  id: number
  address_line1: string
  address_line2?: string
  town: string
  county?: string
  postcode: string
  purchase_date?: string
  purchase_price?: number
  current_value?: number
  property_type: PropertyType
  bedrooms: number
  bathrooms: number
  status: PropertyStatus
  notes?: string
  created_at: string
  updated_at: string
  // Joined fields from list endpoint
  tenant_id?: number
  tenant_name?: string
  monthly_rent?: number
  tenant_status?: string
  tenancy_start?: string
  tenancy_end?: string
  mortgage_id?: number
  lender?: string
  mortgage_payment?: number
  interest_rate?: number
  mortgage_balance?: number
  renewal_date?: string
  gross_yield?: number
}

export interface PropertyDetail {
  property: Property
  tenants: Tenant[]
  mortgages: Mortgage[]
  rent_payments: RentPayment[]
  expenses: Expense[]
  maintenance: MaintenanceRecord[]
  certificates: Certificate[]
  documents: Document[]
  valuations: PropertyValuation[]
  financials: PropertyFinancials
}

export interface PropertyFinancials {
  monthly_gross_income: number
  monthly_mortgage: number
  monthly_other_expenses: number
  monthly_expenses: number
  monthly_net_cashflow: number
  gross_yield: number
  net_yield: number
  annual_roi: number
  equity: number
  ltv: number
  total_invested: number
}

export type TenantStatus = 'active' | 'ended' | 'notice_given'

export interface Tenant {
  id: number
  property_id: number
  name: string
  email?: string
  phone?: string
  rent_amount: number
  rent_due_day: number
  tenancy_start: string
  tenancy_end?: string
  deposit_amount?: number
  deposit_scheme?: string
  status: TenantStatus
  notes?: string
  created_at: string
  updated_at: string
  // Joined
  address_line1?: string
  town?: string
}

export type MortgageType = 'repayment' | 'interest_only' | 'tracker' | 'fixed'

export interface Mortgage {
  id: number
  property_id: number
  lender: string
  account_number?: string
  original_amount: number
  current_balance: number
  interest_rate: number
  monthly_payment: number
  type: MortgageType
  fixed_period_end?: string
  renewal_date?: string
  start_date?: string
  is_active: number
  notes?: string
  created_at: string
}

export type PaymentStatus = 'pending' | 'paid' | 'late' | 'partial' | 'missed'

export interface RentPayment {
  id: number
  property_id: number
  tenant_id?: number
  amount: number
  due_date: string
  paid_date?: string
  payment_method?: string
  reference?: string
  notes?: string
  status: PaymentStatus
  created_at: string
  // Joined
  tenant_name?: string
  address_line1?: string
  town?: string
}

export type ExpenseCategory =
  'mortgage' | 'insurance' | 'letting_agent' | 'maintenance' | 'utilities' |
  'council_tax' | 'ground_rent' | 'service_charge' | 'accountancy' | 'legal' | 'travel' | 'other'

export interface Expense {
  id: number
  property_id?: number
  category: ExpenseCategory
  amount: number
  frequency: 'once' | 'monthly' | 'quarterly' | 'annually'
  description?: string
  start_date?: string
  end_date?: string
  active: number
  created_at: string
  // Joined
  property_address?: string
}

export type MaintenanceStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type MaintenanceCategory = 'plumbing' | 'electrical' | 'roofing' | 'heating' | 'appliance' | 'structural' | 'cosmetic' | 'garden' | 'other'

export interface MaintenanceRecord {
  id: number
  property_id: number
  title: string
  description?: string
  category: MaintenanceCategory
  cost: number
  date: string
  contractor?: string
  contractor_phone?: string
  status: MaintenanceStatus
  notes?: string
  created_at: string
  // Joined
  address_line1?: string
  town?: string
}

export type CertificateType =
  'gas_safety' | 'epc' | 'electrical' | 'pat' | 'fire_risk' |
  'legionella' | 'eicr' | 'hmo_licence' | 'planning' | 'other'

export type CertificateStatus = 'valid' | 'expired' | 'due_soon' | 'missing'

export interface Certificate {
  id: number
  property_id: number
  type: CertificateType
  issue_date?: string
  expiry_date: string
  issuer?: string
  file_path?: string
  notes?: string
  status: CertificateStatus
  computed_status?: CertificateStatus
  created_at: string
  // Joined
  address_line1?: string
  town?: string
}

export interface PropertyValuation {
  id: number
  property_id: number
  valuation_date: string
  amount: number
  source: string
  notes?: string
  created_at: string
}

export interface Document {
  id: number
  property_id?: number
  name: string
  type: string
  file_path?: string
  expiry_date?: string
  notes?: string
  created_at: string
}

export type AcquisitionStage =
  'spotted' | 'researching' | 'viewing_booked' | 'offer_made' |
  'under_offer' | 'due_diligence' | 'exchanged' | 'completed' | 'rejected'

export interface AcquisitionOpportunity {
  id: number
  address: string
  town?: string
  postcode?: string
  stage: AcquisitionStage
  property_type: PropertyType
  bedrooms?: number
  asking_price?: number
  estimated_value?: number
  expected_rent?: number
  repair_costs: number
  deposit_percent: number
  mortgage_rate?: number
  notes?: string
  agent_name?: string
  agent_phone?: string
  agent_email?: string
  source?: string
  created_at: string
  updated_at: string
  metrics?: {
    deposit_required: number
    mortgage_amount: number
    monthly_mortgage: number
    gross_yield: number
    net_cashflow: number
    annual_net_cashflow: number
    roi: number
    potential_equity: number
    total_invested: number
  }
}

export type GoalType = 'income' | 'count' | 'net_worth' | 'mortgage_free' | 'retirement_date'

export interface Goal {
  id: number
  name: string
  goal_type: GoalType
  target_monthly_income?: number | null
  target_property_count?: number | null
  target_equity?: number | null
  target_date?: string | null
  max_ltv_pct?: number | null
  min_dscr?: number | null
  min_annual_cashflow?: number | null
  scenario_id?: number | null
  scenario_name?: string | null
  director_loan_annual?: number | null
  director_loan_start_date?: string | null
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface ScenarioSummary {
  start_equity: number
  end_equity: number
  equity_growth: number
  equity_growth_pct: number
  total_cashflow: number
  avg_monthly_cashflow: number
  ending_monthly_cashflow: number
  total_cashflow_posttax?: number
  avg_monthly_cashflow_posttax?: number
  ending_monthly_cashflow_posttax?: number
  total_tax_paid?: number
  min_dscr: number
  months_below_dscr: number
  min_cumulative_cashflow: number
  min_cumulative_cashflow_posttax?: number
}

export interface GoalPathway {
  id: number
  goal_id: number
  scenario_id?: number | null
  scenario_name?: string | null
  template_name: string
  label: string
  feasible: number        // SQLite 0/1
  reaches_goal: number    // SQLite 0/1
  months_to_goal?: number | null
  summary?: ScenarioSummary | null
  assumptions?: PropertyAssumptions | null
  risk_score?: number | null
  binding_constraint?: string | null
  binding_detail?: string | null
  rank?: number
  recommended?: boolean
  created_at: string
}

export interface PropertyAssumptions {
  purchase_price: number
  monthly_rent: number
  monthly_expenses?: number
  deposit_percent?: number
  mortgage_rate?: number
  mortgage_term_years?: number
  projection_years?: number
}

export interface Scenario {
  id: number
  name: string
  description?: string
  base_date: string
  projection_years: number
  created_at: string
  updated_at: string
  events?: ScenarioEvent[]
  results?: ScenarioResults | null
}

export interface ScenarioEvent {
  id: number
  scenario_id: number
  event_type: string
  property_id?: number
  date: string
  parameters_json: string
  sort_order: number
}

export interface PropertyMonthSnapshot {
  date: string
  value: number
  debt: number
  equity: number
  monthly_cashflow: number
  cumulative_cashflow: number
}

export interface PropertySeries {
  property_id: number
  label: string
  months: PropertyMonthSnapshot[]
}

export interface ScenarioResults {
  months: MonthSnapshot[]
  property_series?: PropertySeries[]
  summary: ScenarioSummary
}

export type ScoreRating = 'strong' | 'fair' | 'weak'

export interface ScoreItem {
  key: string
  label: string
  value: number
  rating: ScoreRating
  detail: string
}

export interface Scorecard {
  overall: ScoreItem
  scores: ScoreItem[]
}

export interface TaxSettings {
  ownership: 'personal' | 'ltd'
  personal_marginal_rate_pct: number
  s24_credit_rate_pct: number
  corp_tax_rate_pct: number
  cgt_rate_pct: number
  cgt_annual_exempt: number
  selling_costs_pct: number
}

export interface MonthSnapshot {
  [key: string]: string | number
  date: string
  total_value: number
  total_debt: number
  total_equity: number
  monthly_cashflow: number
  cumulative_cashflow: number
  monthly_cashflow_posttax: number
  cumulative_cashflow_posttax: number
  monthly_tax: number
  property_count: number
  monthly_dscr: number
}

export interface DashboardKPIs {
  total_portfolio_value: number
  total_equity: number
  total_debt: number
  ltv_ratio: number
  monthly_gross_income: number
  monthly_expenses: number
  monthly_net_cashflow: number
  annual_gross_yield: number
  properties_count: number
  tenants_active: number
  occupancy_rate: number
  certificates_expiring_soon: number
  certificates_expired: number
  maintenance_open: number
}

export interface ActivityLogEntry {
  id: number
  event_type: string
  entity_type: string
  entity_id?: number
  description: string
  event_date: string
  created_at: string
}

export interface DashboardData {
  kpis: DashboardKPIs
  income_chart: { month: string; gross_income: number }[]
  value_chart: { valuation_date: string; total_value: number }[]
  expense_breakdown: { category: string; total: number }[]
  recent_activity: ActivityLogEntry[]
}

export interface FinancialSummary {
  ytd_income: number
  ytd_expenses_monthly_rate: number
  ytd_monthly_mortgage: number
  ytd_net: number
  expense_by_category: { category: string; total: number }[]
  income_by_property: { property_id: number; address: string; monthly_rent: number; current_value: number; gross_yield: number }[]
  monthly_chart: { month: string; income: number; expenses: number; net: number }[]
}
