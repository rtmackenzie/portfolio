// LBTT bands for additional/second dwellings in Scotland (2024/25)
export function calcLBTT(price: number): number {
  if (price <= 0) return 0
  const bands = [
    { limit: 145000, rate: 0.00 },
    { limit: 250000, rate: 0.02 },
    { limit: 325000, rate: 0.05 },
    { limit: 750000, rate: 0.10 },
    { limit: Infinity, rate: 0.12 },
  ]
  let tax = 0, prev = 0
  for (const { limit, rate } of bands) {
    if (price <= prev) break
    tax += (Math.min(price, limit) - prev) * rate
    prev = limit
  }
  return Math.round(tax)
}

// ADS (Additional Dwelling Supplement) — 8% of full price for additional dwellings > £40k
export function calcADS(price: number): number {
  return price > 40000 ? Math.round(price * 0.08) : 0
}

// Total one-off acquisition costs: taxes + legal/refurb + mortgage arrangement/valuation fees
export function calcTransactionCosts(
  price: number,
  legalFees = 2000,
  refurbCosts = 0,
  arrangementFee = 0,
  valuationFee = 0
): { lbtt: number; ads: number; fees: number; total: number } {
  const lbtt = calcLBTT(price)
  const ads = calcADS(price)
  const fees = legalFees + refurbCosts + arrangementFee + valuationFee
  return { lbtt, ads, fees, total: lbtt + ads + fees }
}

// Standard amortising monthly payment: P * r*(1+r)^n / ((1+r)^n - 1)
// Returns interest-only payment when termMonths is 0.
export function calcMonthlyPayment(balance: number, annualRate: number, termMonths: number): number {
  if (balance <= 0) return 0
  if (termMonths <= 0) return (balance * annualRate / 100) / 12
  const r = annualRate / 100 / 12
  if (r === 0) return balance / termMonths
  const factor = Math.pow(1 + r, termMonths)
  return balance * (r * factor) / (factor - 1)
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

export interface AcquisitionMetrics {
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

export function calculatePropertyFinancials(
  property: { purchase_price?: number | null; current_value?: number | null },
  activeTenant: { rent_amount?: number } | null,
  activeMortgage: { monthly_payment?: number; current_balance?: number; original_amount?: number } | null,
  monthlyExpenses: { amount: number; frequency: string }[]
): PropertyFinancials {
  const monthlyRent = activeTenant?.rent_amount ?? 0
  const monthlyMortgage = activeMortgage?.monthly_payment ?? 0
  const currentValue = property.current_value ?? property.purchase_price ?? 0
  const purchasePrice = property.purchase_price ?? 0
  const currentDebt = activeMortgage?.current_balance ?? 0
  const originalMortgage = activeMortgage?.original_amount ?? 0

  const monthlyOtherExpenses = monthlyExpenses.reduce((sum, e) => {
    switch (e.frequency) {
      case 'monthly': return sum + e.amount
      case 'quarterly': return sum + e.amount / 3
      case 'annually': return sum + e.amount / 12
      default: return sum
    }
  }, 0)

  const totalMonthlyExpenses = monthlyMortgage + monthlyOtherExpenses
  const netCashflow = monthlyRent - totalMonthlyExpenses

  const grossYield = currentValue > 0 ? (monthlyRent * 12 / currentValue) * 100 : 0
  const netYield = currentValue > 0 ? (netCashflow * 12 / currentValue) * 100 : 0
  const equity = currentValue - currentDebt
  const ltv = currentValue > 0 ? (currentDebt / currentValue) * 100 : 0

  // deposit paid = purchase price minus original mortgage amount
  const depositPaid = originalMortgage > 0
    ? purchasePrice - originalMortgage
    : purchasePrice * 0.25 // assume 25% deposit if no mortgage data

  const annualNetIncome = netCashflow * 12
  const roi = depositPaid > 0 ? (annualNetIncome / depositPaid) * 100 : 0

  return {
    monthly_gross_income: round(monthlyRent),
    monthly_mortgage: round(monthlyMortgage),
    monthly_other_expenses: round(monthlyOtherExpenses),
    monthly_expenses: round(totalMonthlyExpenses),
    monthly_net_cashflow: round(netCashflow),
    gross_yield: round(grossYield),
    net_yield: round(netYield),
    annual_roi: round(roi),
    equity: round(equity),
    ltv: round(ltv),
    total_invested: round(depositPaid),
  }
}

export function calculateAcquisitionMetrics(opp: {
  asking_price?: number | null
  estimated_value?: number | null
  expected_rent?: number | null
  repair_costs?: number | null
  deposit_percent?: number | null
  mortgage_rate?: number | null
}): AcquisitionMetrics {
  const purchasePrice = opp.asking_price ?? 0
  const estimatedValue = opp.estimated_value ?? purchasePrice
  const monthlyRent = opp.expected_rent ?? 0
  const repairCosts = opp.repair_costs ?? 0
  const depositPercent = opp.deposit_percent ?? 25
  const mortgageRate = opp.mortgage_rate ?? 5.5

  const depositAmount = purchasePrice * (depositPercent / 100)
  const mortgageAmount = purchasePrice - depositAmount
  const monthlyMortgagePayment = (mortgageAmount * (mortgageRate / 100)) / 12 // interest only
  const totalInvested = depositAmount + repairCosts

  const grossYield = estimatedValue > 0 ? (monthlyRent * 12 / estimatedValue) * 100 : 0
  const netCashflow = monthlyRent - monthlyMortgagePayment
  const annualNet = netCashflow * 12
  const roi = totalInvested > 0 ? (annualNet / totalInvested) * 100 : 0
  const potentialEquity = estimatedValue - purchasePrice

  return {
    deposit_required: round(depositAmount),
    mortgage_amount: round(mortgageAmount),
    monthly_mortgage: round(monthlyMortgagePayment),
    gross_yield: round(grossYield),
    net_cashflow: round(netCashflow),
    annual_net_cashflow: round(annualNet),
    roi: round(roi),
    potential_equity: round(potentialEquity),
    total_invested: round(totalInvested),
  }
}

export function calculatePortfolioKPIs(
  properties: { current_value?: number | null; purchase_price?: number | null }[],
  mortgages: { current_balance: number; monthly_payment: number; is_active: number }[],
  tenants: { rent_amount: number; status: string }[],
  expenses: { amount: number; frequency: string; active: number }[]
) {
  const totalValue = properties.reduce((s, p) => s + (p.current_value ?? p.purchase_price ?? 0), 0)
  const activeMortgages = mortgages.filter(m => m.is_active === 1)
  const totalDebt = activeMortgages.reduce((s, m) => s + m.current_balance, 0)
  const totalEquity = totalValue - totalDebt
  const ltv = totalValue > 0 ? (totalDebt / totalValue) * 100 : 0

  const activeTenants = tenants.filter(t => t.status === 'active')
  const monthlyGrossIncome = activeTenants.reduce((s, t) => s + t.rent_amount, 0)
  const totalProperties = properties.length
  const occupancyRate = totalProperties > 0 ? (activeTenants.length / totalProperties) * 100 : 0

  const monthlyMortgagePayments = activeMortgages.reduce((s, m) => s + m.monthly_payment, 0)
  const activeExpenses = expenses.filter(e => e.active === 1)
  const monthlyOtherExpenses = activeExpenses.reduce((s, e) => {
    switch (e.frequency) {
      case 'monthly': return s + e.amount
      case 'quarterly': return s + e.amount / 3
      case 'annually': return s + e.amount / 12
      default: return s
    }
  }, 0)
  const monthlyExpenses = monthlyMortgagePayments + monthlyOtherExpenses
  const netCashflow = monthlyGrossIncome - monthlyExpenses
  const annualGrossYield = totalValue > 0 ? (monthlyGrossIncome * 12 / totalValue) * 100 : 0

  return {
    total_portfolio_value: round(totalValue),
    total_equity: round(totalEquity),
    total_debt: round(totalDebt),
    ltv_ratio: round(ltv),
    monthly_gross_income: round(monthlyGrossIncome),
    monthly_expenses: round(monthlyExpenses),
    monthly_net_cashflow: round(netCashflow),
    annual_gross_yield: round(annualGrossYield),
    properties_count: totalProperties,
    tenants_active: activeTenants.length,
    occupancy_rate: round(occupancyRate),
  }
}

function round(n: number, dp = 2): number {
  return Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp)
}
